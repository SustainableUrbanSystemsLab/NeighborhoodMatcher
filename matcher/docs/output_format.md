# Output Format

`coordinator(...)` writes four CSVs per run:

1. The **linked dataset** at `output`.
2. A **per-row detail file** at `<output_basename>_detail.csv`.
3. A **per-variable diagnostics file** at `<output_basename>_variables.csv`
   (missingness per side, definition-shift check, share of match distance —
   see [signals/variable_report.md](signals/variable_report.md)).
4. A **run-provenance file** at `<output_basename>_run_info.csv` — `key,value`
   rows naming the tool, its version, the authors, the repository, the run
   timestamp (UTC and local), and the settings this run used (linked
   variables, NNDR threshold, distance cutoff, minimum-confidence filter).
   Input files are recorded by name only, never by path, so a results folder
   can be shared without leaking a directory tree. Written on every run —
   provenance is not optional: months later it is the only thing that says
   which version produced these numbers.

With `ablation=True` it additionally writes
`<output_basename>_ablation.csv` — the leave-one-variable-out quality
report ([signals/ablation.md](signals/ablation.md)).

`coordinate_in_memory(...)` returns the same data as a Python dict; the browser
frontend serializes it to JS via Pyodide.

## Linked dataset (`<output>.csv`)

Each row corresponds to one target row, joined to its best supplemental match.

| Columns | Source |
|---------|--------|
| All target headers | from the target CSV, unchanged (except filled missing cells — see below) |
| Non-shared supplemental headers | appended in original order |
| `euc_distance` | float — standardized Euclidean distance to the matched row |
| `repeats` | int — supplemental rows tied at the minimum distance, **including the chosen match** (1 = unique winner; ties are broken deterministically by lowest row index, i.e. first in file order) |
| `nndr` | float — best/second-best distance ratio, rounded to 4 dp |
| `near_miss_count` | int — supplemental rows where `d1/di >= threshold` |
| `mnn_confirmed` | int (0/1) — whether the match is symmetric in the reverse search |
| `features_used` | int — shared features observed on **both** sides of the matched pair (the dims that actually contributed comparisons; 0 for no-match rows) |
| `exact_on_observed` | int (0/1) — 1 when the matched pair agrees exactly on every jointly-observed feature (blank for no-match rows) |
| `filled_from_match` | string — `; `-joined names of shared columns whose missing target value was filled from the matched row (empty when nothing was filled) |
| `confidence` | string — `High` / `Medium` / `Low` / `No match` (see rule table below); a row withheld by the minimum-confidence filter shows its true tier annotated, e.g. `Low (withheld)` |
| `flags` | string — pipe-separated plain-English warnings (empty if clean) |

Shared columns appear once. The target's value is kept verbatim — **unless it
is missing and the matched supplemental row has a value, in which case the
supplemental raw value is written in its place and the column name is
recorded in `filled_from_match`**. This is output completion only: matching
itself never imputes, and no-match / rejected rows are never filled.

**Missing data.** Missing cells (blank, `NA`, `N/A`, `null`, `none`, `-`, `.`,
`NaN`, `#N/A` — case-insensitive) are never imputed for matching. Distances
are computed over the feature dimensions observed on both sides; each missing
dimension contributes a fixed expected-difference penalty instead (see
`matcher.distance.MISSING_PENALTY`). Rows with missing shared features carry a
`missing k of n` flag. A target row that shares **no** observed feature with
any supplemental row is written as a **no-match row**: supplemental cells,
`euc_distance` and `nndr` are blank, and `flags` starts with
`WARNING: no valid match`.

**Optional max-distance cutoff.** When `max_distance` is set (CLI
`coordinator(..., max_distance=...)`, web UI "Reject matches beyond a
distance cutoff"), a match whose `best_distance / sqrt(features_used)`
exceeds the cutoff (strictly) is **rejected**: the linked row is written like
a no-match row (blank supplemental cells, no fill) with the flag
`WARNING: no match — nearest supplemental row exceeded the distance cutoff`,
while the detail file and `per_target` keep the rejected nearest row's full
diagnostics (distance, NNDR, contributions, `nearest_idx`) for review. Note
the numerator still carries the missing-dim penalty, so rows with many
missing features are rejected more aggressively — deliberate and
conservative. Default: off (`None`), which is byte-identical to the previous
behavior.

**Optional minimum-confidence filter.** When `min_confidence` is set
(`"medium"` or `"high"`; CLI `coordinator(..., min_confidence=...)`, web UI
"Minimum confidence to report a link"), a row whose tier falls below the
minimum is **withheld**: the linked row is written unlinked (blank
supplemental cells, no fill) with the flag
`link withheld — confidence {tier} is below your minimum ({min_tier})`
*prepended* to its normal flags, and its confidence cell annotated
(`Low (withheld)`). The detail file and `per_target` keep the nearest row's
full diagnostics. This is **purely a reporting filter**: it never changes
which matches are found, the SMD, tier counts, or any other row — a
withheld row's diagnostics are byte-identical to the same row with the
filter off. Precedence: zero-overlap no-match → cutoff rejection →
withholding (a cutoff-rejected row is `No match`, never also withheld).
`"low"` is rejected as a value — it would withhold nothing. Default: off
(`None`), which is byte-identical to the previous behavior.

## Confidence tier (`confidence` column)

One plain verdict per row, computed by `matcher.signals.confidence_tier`.
First matching rule wins, top to bottom:

| Tier | Condition |
|------|-----------|
| `No match` | no match possible (zero shared observed features) OR nearest row rejected by the max-distance cutoff |
| `Low` | exact-distance tie at the minimum (`repeats > 1`), OR MNN not confirmed, OR `nndr >= threshold`, OR the match rests on a single feature when more were linked (`features_used == 1` and `n_features > 1`) |
| `Medium` | competitors within the near-miss cutoff (`near_miss_count > 0`), OR at least one linked feature missing on either side of the pair (`features_used < n_features`) |
| `High` | otherwise — unique minimum, MNN confirmed, no near misses, NNDR below threshold, all linked features observed on both sides |

`exact_on_observed` is deliberately not a tier input: a full-coverage exact
match is already High, and an exact match on 1 of 4 features must stay Low.
The UI uses it to explain rows ("agrees exactly on every observed variable").

## Detail file (`<output>_detail.csv`)

One row per target row. Wider; intended for audit and per-match inspection
rather than day-to-day analysis.

| Column | Meaning |
|--------|---------|
| `target_index` | int — row index into the original target CSV |
| `euc_distance` | best-match distance (same as linked file) |
| `nndr` | NNDR ratio |
| `near_miss_count` | near-miss count |
| `mnn_confirmed` | 0/1 |
| `target_missing` | int — missing shared features in the target row |
| `match_missing` | int — missing shared features in the matched supplemental row (blank for no-match rows) |
| `features_used` | int — shared features observed on both sides of the pair (kept for cutoff-rejected rows; 0 for zero-overlap no-match rows) |
| `exact_on_observed` | 0/1 — pair agrees exactly on every jointly-observed feature (blank for zero-overlap no-match rows) |
| `contrib_<feature>` (one per shared feature) | float — per-feature share of squared distance for this match (sums to 1.0, or all 0 if the match is exact) |
| `confidence` | `High` / `Medium` / `Low` / `No match` |
| `flags` | pipe-separated warnings (same content as the linked file) |

Unlike the linked file, a cutoff-rejected row keeps its diagnostics here
(`euc_distance`, `nndr`, contributions, `features_used`) so the rejected
nearest row can be audited.

The contribution columns let a researcher answer "which feature drove this
match's distance?" — useful when investigating a flagged row.

## In-memory dict (web_api)

`coordinate_in_memory(...)` returns:

```python
{
    "feature_names":  [...],          # shared column names, in match order
    "smd":            [...],          # dataset-level SMD per feature
    "threshold":      0.8,            # NNDR threshold used in this run — must be in (0, 1]
    "warnings":       [...],          # dataset-level warnings (scale mismatch, definition shift, ...)
    "provenance":     {...},          # engine identity: tool, version, authors,
                                      # authors_line, organization, repo_url,
                                      # site_url (matcher.about.provenance).
                                      # No timestamp — the caller stamps the
                                      # run time in its own timezone.
    "variables":      [...],          # per-variable report incl. distance_share
                                      # (see signals/variable_report.md), feature order
    "linked_headers": [...],          # list[str]
    "linked_rows":    [[str, ...]],   # CSV-ready
    "detail_headers": [...],
    "detail_rows":    [[str, ...]],
    "per_target":     [
        {
            "target_idx":        int,
            "match_idx":         int,     # None for a no-match / rejected row
            "nearest_idx":       int,     # nearest row even when rejected; None for zero-overlap no-match
            "no_match":          bool,    # True for zero-overlap AND cutoff-rejected rows
            "rejected":          bool,    # True only for cutoff-rejected rows
            "withheld":          bool,    # True only for rows below the minimum-confidence filter
            "best_distance":     float,   # None for a zero-overlap no-match row (kept for rejected)
            "second_distance":   float,   # None when no second candidate exists
            "nndr":              float,   # None for a zero-overlap no-match row (kept for rejected)
            "near_miss":         int,
            "mnn_confirmed":     bool,
            "repeats":           int,     # rows tied at the minimum incl. the winner; 1 = unique
            "target_missing":    int,
            "match_missing":     int,     # None for a zero-overlap no-match row
            "features_used":     int,     # shared features observed on both sides of the pair
            "exact_on_observed": bool,    # exact agreement on every jointly-observed feature
            "filled_from_match": [str, ...],  # shared columns filled from the matched row
            "confidence":        str,     # "High" | "Medium" | "Low" | "No match" —
                                          # always the TRUE tier, even when withheld
                                          # (the CSV cell carries the "(withheld)" suffix)
            "contributions":     [float, ...],
            "flags":             str,
            "hist_counts":       [int, ...],   # distance histogram
            "hist_edges":        [float, ...],
            "top_k_distances":   [float, ...], # nearest k for the near-miss cluster
        },
        ...
    ],
    "summary": {
        "total":              int,
        "flagged":            int,
        "mnn_confirmed":      int,
        "no_match":           int,     # rows without an ACCEPTED match (incl. rejected)
        "rejected":           int,     # subset of no_match discarded by the cutoff
        "withheld":           int,     # rows below the minimum-confidence filter (NOT part of no_match)
        "max_distance":       float,   # None when the cutoff is off
        "min_confidence":     str,     # "Medium" | "High" | None when the filter is off
        "tiers":              {"High": int, "Medium": int, "Low": int, "No match": int},
                                       # tier counts always reflect TRUE tiers — withholding never moves them
        "mean_nndr":          float,   # over accepted matched rows only
        "mean_best_distance": float,
        "threshold":          float,
    },
}
```

The `per_target` list is the source of the per-row drill-down on the Results
UI: a full-population distance histogram, a rank plot of the top-k closest
supplementals, and per-feature contribution bars.

## Flags column — what users see

The `flags` column is the primary interface for non-technical researchers. It's
empty when no concerns are raised. When concerns exist, they appear as
plain-English messages joined by ` | `:

```
ambiguous match — NNDR 0.92 (>= 0.80) | 3 near-miss row(s) within distance ratio threshold | feature imbalance — pct_college (|SMD| > 0.10)
```

See [signals/flags.md](signals/flags.md) for the full list of triggers and their
exact messages.