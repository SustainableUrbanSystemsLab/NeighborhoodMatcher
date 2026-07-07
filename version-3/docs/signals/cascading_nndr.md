# Cascading NNDR

## Definition

Implemented in `matcher.signals.cascading_nndr`. Returns
`(nndr, near_miss_count)`:

- **`nndr` = `d1 / d2`** — best-match distance over second-best-match
  distance, on sorted distances. Originates from Lowe's SIFT feature
  matching (Lowe, IJCV 2004).
  - Near 0 → confident match.
  - Near 1 → ambiguous (best and runner-up are roughly tied).
- **`near_miss_count`** — the count of supplemental rows `i ≥ 2` such that
  `d1 / d_i ≥ threshold`, walking the sorted distances in order and
  stopping at the first row that falls below threshold ("cascading").

The cascading extension turns the single ratio into a count, removing the
need for a separate near-miss distance threshold.

## What it tells you

NNDR captures how decisively the best match wins over the next best
candidate. The count generalizes that to a cluster: how many supplemental
rows are nearly as close as the best match.

This is the **primary ambiguity signal** in the system. It's the only
match-quality signal that is genuinely scale-invariant — adding a feature or
changing units does not change the ratio in a systematic way.

## Threshold

Default `0.8`, taken from Lowe's empirical recommendation in computer vision.
**This default has not been calibrated on tabular ACS-type data.** A
calibration pass is described in
[../old-planning/match_quality_brainstorm.md](../old-planning/match_quality_brainstorm.md)
under "Calibration Status"; both available test datasets contain exact
matches and so cannot drive a real calibration. The frontend is expected to
communicate this to users.

`threshold` is run-configurable; the value used is also the value reported in
flag messages, so the threshold the run was scored against is always visible
on every row.

## Reported as

- `nndr` and `near_miss_count` columns in both the linked dataset and the
  detail file.
- `nndr ≥ threshold` raises the `ambiguous match` flag.
- `near_miss_count > 0` raises the `near-miss row(s) within distance ratio
  threshold` flag.

## Edge cases

- **Empty distance vector** → `(0.0, 0)`.
- **Single supplemental row** (no `d2`) → `(0.0, 0)`. No ambiguity is
  computable.
- **Unique exact match** (`d1 == 0 < d2`) → `(0.0, 0)`. A perfect match with
  no competitor at the same distance is maximally confident.
- **Tied exact matches** (`d1 == d2 == 0`) → `(1.0, k)` where `k` is the
  number of zero-distance runners-up. Several rows match perfectly — the
  matcher cannot tell them apart, so the row is maximally *ambiguous*, not
  maximally confident. (Before this contract, a 771-way tie of blank
  Census-suppressed rows reported NNDR 0.0.)
- **No valid match** (`d1 == inf`, no overlapping observed features) →
  `(1.0, 0)`. The pipeline additionally writes an explicit
  `WARNING: no valid match` flag and blanks the match columns.
- **Threshold boundary is inclusive.** `nndr == threshold` raises the flag,
  matching the test in `tests/signals/test_build_flags.py`.

## Related

- [mnn_confirmed.md](mnn_confirmed.md) — a separate ambiguity check on the
  reverse direction. Low NNDR + failed MNN is a known failure mode (the
  match was clear in one direction but not the other).
- [flags.md](flags.md) — exact messages emitted by NNDR-related conditions.
