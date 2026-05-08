# Euclidean Distance

## Definition

Standardized Euclidean distance between a target row and a supplemental row:

```
d(t, s) = sqrt( Σ_i ( z_t,i − z_s,i )² )
```

where `z` is the joint z-score from `dual_standardize` (means and SDs computed
across both datasets together). Implemented in
`matcher.distance.euclidean_distance` and `compute_sorted_distances`.

## What it tells you

How close the match is in the joint feature space, in units of standard
deviations. A distance of 0 means the two rows are identical on every shared
feature; larger values mean a worse match.

## Reported as

- `euc_distance` in the linked dataset and detail file (one number per row).
- The full sorted distance vector is computed internally and feeds NNDR,
  near-miss counting, and the per-target histograms returned by `web_api`.

## Edge cases

- **Constant column** — `dual_standardize` guards against a feature whose SD
  is zero across both datasets (replaces the SD with 1 before dividing). Such
  a column contributes 0 to every distance.
- **Empty / NA values** — replaced with `"0"` upstream by `clean_val` before
  standardization. This is a conservative default; future revisions may
  prefer mean imputation or an explicit missing-value flag.

## Important caveat

`euc_distance` is **not directly comparable across runs with different feature
counts**. Adding a feature generally adds a positive squared term, inflating
distances. Use NNDR (a ratio) for cross-run comparisons. This caveat is also
flagged in the brainstorm document under "Dimension Count Sensitivity".

## Related

- [cascading_nndr.md](cascading_nndr.md) — turns the sorted distance vector
  into a scale-invariant ambiguity score.
- [per_row_feature_contribution.md](per_row_feature_contribution.md) —
  decomposes a single match's distance into per-feature shares.