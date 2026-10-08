# Per-Variable Report (input diagnostics)

## Definition

Pre-matching diagnostics computed for every linked variable, on the raw
parsed values of both files — before joint standardization can absorb a
systematic difference between them. Implemented in
`matcher.signals.variable_report`; dataset-level warnings derived from it in
`matcher.signals.variable_warnings`.

Per variable:

| Field | Meaning |
|-------|---------|
| `target_missing_pct` / `supp_missing_pct` | Missing cells as % of rows, per side. |
| `target_mean` / `supp_mean`, `target_std` / `supp_std` | Observed-value stats per side. The SDs use the scale check's convention (population SD; float rounding dust counts as constant, i.e. exactly 0) so `spread_ratio` is literally `target_std / supp_std`. |
| `offset_smd` | `abs(target_mean − supp_mean) / pooled SD` — the definition-shift check (below). The pooled SD is the sample SD (ddof = 1), mirroring `dataset_smd`. |
| `spread_ratio` | `target_std / supp_std` (`None` when either is 0 or not finite). |
| `distance_share` | Share of the run's total squared match distance attributable to this variable, aggregated over accepted matches: `Σ contrib_f · d1² / Σ d1²`. Answers "which variable drove the matching overall?" |
| `notes` | Short pre-rendered observations (`""` when clean) — identical wording in the CLI CSV, the webapp panel, and the results zip. |

## What it catches

**Definition/coding differences.** A column that measures the same-named
quantity *differently* in the two files — e.g. a poverty rate computed
against 100% of the federal poverty line in one file and 180% in the other —
has a similar spread but a systematically shifted mean. The spread-ratio
scale check (`scale_compatibility_warnings`) cannot see it, and joint
z-scoring silently absorbs it into a constant between-file offset on that
dimension, inflating every distance and degrading matches. `offset_smd`
measures exactly this shift, in pooled standard deviations (the same scale
convention as the post-match dataset SMD).

**High missingness.** Missing values are never imputed; each missing
dimension charges the fixed distance penalty instead
(`matcher.distance.MISSING_PENALTY`). A variable that is mostly missing
therefore contributes mostly penalty — noise that can dominate both d1 and
d2 and scramble winners. Real-use report: adding one high-missingness
variable to an otherwise clean run collapsed MNN confirmation from 99.9% to
28.2%. The report surfaces per-side missingness next to the other checks;
the [ablation signal](ablation.md) measures the actual damage.

## Thresholds (heuristics, not literature-fixed)

- `OFFSET_SMD_WARN = 0.5` — notes and dataset warnings fire at half a pooled
  SD of systematic shift.
- `VARIABLE_WARN_MIN_OBSERVED = 30` — a dataset-level warning fires only
  when **both** sides have at least 30 observed values; below that, means
  differ by chance and the warning would be noise.
- High-missingness note at > 50% (matches the upload UI's red badge);
  scale-mismatch note outside spread ratio [1/50, 50], and a
  constant-on-one-side note. Both use `standardize.SCALE_RATIO_LIMIT` and
  `standardize.observed_column_std` — the same helper and limit as the
  dataset-level `scale_compatibility_warnings` — so the per-variable note and
  the dataset warning fire together or not at all (pinned by test).

Unlike the SMD flag thresholds (Austin), these are pragmatic defaults —
revisit them if they prove noisy or blind on real data.

## Reported as

- `variables` key of the `web_api` result dict (feature order), rendered as
  the results-page variable panel and `diagnostics/variable_diagnostics.csv`
  in the zip.
- `<output_base>_variables.csv` written by `pipeline.coordinator` next to
  the linked and detail files.
- Dataset-level warnings from `variable_warnings` join the run's `warnings`
  list (stderr on the CLI, warnings box in the webapp).

## Edge cases

- A side with zero observed values: means are `None`, `offset_smd` is `None`.
- Both sides constant with **equal** values: `offset_smd` 0.0, clean.
- Both sides constant with **different** values: the shift is real but has
  no scale to express it in — `offset_smd` is `None` and a dedicated note
  fires instead.
- `distance_share` is all zeros when no match was accepted or every accepted
  match is exact (total squared distance 0).

## Related

- [dataset_smd.md](dataset_smd.md) — the *post-match* balance check, over
  matched pairs; this report is its *pre-match* sibling over the raw inputs.
- [ablation.md](ablation.md) — measures each variable's actual effect on
  linkage quality by re-matching without it.
- [per_row_feature_contribution.md](per_row_feature_contribution.md) — the
  per-match decomposition that `distance_share` aggregates.
