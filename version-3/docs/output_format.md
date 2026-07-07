# Output Format

`coordinator(...)` writes two CSVs per run:

1. The **linked dataset** at `output`.
2. A **per-row detail file** at `<output_basename>_detail.csv`.

`coordinate_in_memory(...)` returns the same data as a Python dict; the browser
frontend serializes it to JS via Pyodide.

## Linked dataset (`<output>.csv`)

Each row corresponds to one target row, joined to its best supplemental match.

| Columns | Source |
|---------|--------|
| All target headers | from the target CSV, unchanged |
| Non-shared supplemental headers | appended in original order |
| `euc_distance` | float — standardized Euclidean distance to the matched row |
| `repeats` | int — number of supplemental rows tied at the minimum distance |
| `nndr` | float — best/second-best distance ratio, rounded to 4 dp |
| `near_miss_count` | int — supplemental rows where `d1/di >= threshold` |
| `mnn_confirmed` | int (0/1) — whether the match is symmetric in the reverse search |
| `flags` | string — pipe-separated plain-English warnings (empty if clean) |

Shared columns appear once (target's value is kept; the supplemental copy is
dropped on merge — see `matcher.merge.row_merge`).

**Missing data.** Missing cells (blank, `NA`, `N/A`, `null`, `none`, `-`, `.`,
`NaN`, `#N/A` — case-insensitive) are never imputed. Distances are computed
over the feature dimensions observed on both sides; each missing dimension
contributes a fixed expected-difference penalty instead (see
`matcher.distance.MISSING_PENALTY`). Rows with missing shared features carry a
`missing k of n` flag. A target row that shares **no** observed feature with
any supplemental row is written as a **no-match row**: supplemental cells,
`euc_distance` and `nndr` are blank, and `flags` starts with
`WARNING: no valid match`.

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
| `contrib_<feature>` (one per shared feature) | float — per-feature share of squared distance for this match (sums to 1.0, or all 0 if the match is exact) |
| `flags` | pipe-separated warnings (same content as the linked file) |

The contribution columns let a researcher answer "which feature drove this
match's distance?" — useful when investigating a flagged row.

## In-memory dict (web_api)

`coordinate_in_memory(...)` returns:

```python
{
    "feature_names":  [...],          # shared column names, in match order
    "smd":            [...],          # dataset-level SMD per feature
    "threshold":      0.8,            # NNDR threshold used in this run
    "warnings":       [...],          # dataset-level warnings (e.g. scale mismatch)
    "linked_headers": [...],          # list[str]
    "linked_rows":    [[str, ...]],   # CSV-ready
    "detail_headers": [...],
    "detail_rows":    [[str, ...]],
    "per_target":     [
        {
            "target_idx":       int,
            "match_idx":        int,     # None for a no-match row
            "no_match":         bool,
            "best_distance":    float,   # None for a no-match row
            "second_distance":  float,
            "nndr":             float,   # None for a no-match row
            "near_miss":        int,
            "mnn_confirmed":    bool,
            "repeats":          int,
            "target_missing":   int,
            "match_missing":    int,     # None for a no-match row
            "contributions":    [float, ...],
            "flags":            str,
            "hist_counts":      [int, ...],   # distance histogram
            "hist_edges":       [float, ...],
            "top_k_distances":  [float, ...], # nearest k for the near-miss cluster
        },
        ...
    ],
    "summary": {
        "total":              int,
        "flagged":            int,
        "mnn_confirmed":      int,
        "no_match":           int,
        "mean_nndr":          float,   # over matched rows only
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