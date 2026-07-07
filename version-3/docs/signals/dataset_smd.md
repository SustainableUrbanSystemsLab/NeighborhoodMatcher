# Dataset Standardized Mean Difference (SMD)

## Definition

Implemented in `matcher.signals.dataset_smd`. For each feature `f`, computes:

```
SMD_f = | mean( target_f )  −  mean( matched_f ) |  /  pooled_SD_f

pooled_SD_f = sqrt( ( var(target_f) + var(matched_f) ) / 2 )
```

where `target_f` is the standardized target column across all rows and
`matched_f` is the column of *the supplemental rows actually selected as
best matches*, in the same order. Variance uses sample variance (`ddof=1`).

Returns a 1-D array, one value per shared feature. Constant features
(`pooled_SD == 0`) return 0.0 — SMD is undefined there but reporting `nan`
or `inf` would propagate into flags.

## What it tells you

How **systemically misaligned** the matched dataset is from the target
dataset on each feature, in pooled-SD units. This is a run-wide diagnostic,
not a per-row signal — one SMD value per feature describes the whole match
output.

Common interpretation:

| `|SMD|` | Meaning |
|---------|---------|
| ≤ 0.10 | Acceptable balance |
| 0.10 – 0.25 | Imbalance worth noting |
| > 0.25 | Poor balance on that feature |

Thresholds are from Austin's covariate-balance work in causal inference
(*Statistics in Medicine*, 2009; PMC3472075) and are conventional in the
matching literature. They are hard-coded (`_FLAG_RULES["smd_warn"]`,
`_FLAG_RULES["smd_poor"]`) because they are literature-fixed; only the NNDR
threshold is user-configurable.

## Reported as

The same SMD vector is used to flag *every* row in the run — if feature `X`
has a poor SMD, every row gets that warning in its `flags` column. This
intentionally surfaces run-wide problems on every record, since a researcher
inspecting any single match should know about systemic imbalance.

Flags emitted:

- `feature imbalance — <names> (|SMD| > 0.10)` — features with
  `0.10 < SMD ≤ 0.25`.
- `poor feature balance — <names> (|SMD| > 0.25)` — features with
  `SMD > 0.25`. Features in this band are excluded from the warn list to
  avoid double-flagging.

## Edge cases

- **Single matched pair** (`n < 2`) → returns all zeros. Sample variance is
  undefined for `n = 1`. The explanatory scenarios all hit this case (one
  target row each) and report SMD as 0 in their PDFs.
- **Constant feature** (`pooled_SD == 0`) → 0.0 for that feature. Distinct
  values can't separate, but the signal also can't fire.
- **Direction is dropped** — SMD is taken as an absolute value, so a matched
  group running consistently above or below the target gives the same SMD.

## Related

- [per_row_feature_contribution.md](per_row_feature_contribution.md) — the
  per-row complement. Ask SMD "what is wrong on average?"; ask
  per-row contribution "what is wrong on this specific match?".
- [flags.md](flags.md) — exact flag wording.
