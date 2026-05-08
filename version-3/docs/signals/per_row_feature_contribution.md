# Per-Row Feature Contribution

## Definition

Implemented in `matcher.signals.per_row_feature_contribution`. For one matched
target/supplemental pair, decomposes the squared Euclidean distance into a
per-feature share:

```
contribution_i = (z_target_i − z_matched_i)² / Σ_j (z_target_j − z_matched_j)²
```

Returns a 1-D array, same length as the feature vector, with values that
sum to 1.0.

When the squared distance is zero (exact match), returns an all-zeros array
of the correct length — there's no distance to attribute.

## What it tells you

For a single match, **which features drove the distance**. A feature with a
high contribution is the one most responsible for the gap between the target
and its best match.

Useful when investigating a flagged row: a row flagged for high NNDR with one
feature accounting for 90% of its distance is a different problem than a
row whose distance is spread evenly across all features.

The `scale_mismatch` explanatory scenario uses this signal as its primary
diagnostic: a unit-error feature dominates the contribution table.

## Reported as

- One column per shared feature in the detail file: `contrib_<feature>`,
  rounded to 6 dp.
- The `web_api` returns the raw contributions per target row; the Results UI
  renders them as per-feature bars in the row drill-down.
- Not used to raise flags directly — interpretation depends on context (a
  100% contribution from one feature is suspicious if total distance is
  large, fine if total distance is tiny).

## Edge cases

- **Exact match** → all zeros, same length as the input. No NaN, no
  divide-by-zero warning.
- **Single feature** that differs from a constant → contribution `[1.0]`.
  Useful but uninformative on its own; pair with absolute distance.
- **Sign invariance** — squaring means `+x` and `−x` contribute equally.

## Caveat — distance vs. selection contribution

This signal measures how much each feature contributed to the *distance* of
the chosen match. It does **not** measure how much each feature contributed
to *selecting* this match over alternatives. A feature can have zero
distance contribution (perfect agreement) while having zero discriminating
power (every supplemental row also agreed on it). Both views are truthful
about different properties.

A selection-based signal (leave-one-feature-out ablation) is designed but
deferred — see [../old-planning/match_quality_brainstorm.md](../old-planning/match_quality_brainstorm.md)
under "Per Feature Match Contribution by Measuring Degraded Match Quality
through Systematic Ablation Methodology".

## Related

- [euc_distance.md](euc_distance.md) — the value being decomposed.
- [dataset_smd.md](dataset_smd.md) — run-wide complement: which features are
  imbalanced *across all matches*, not just one.
