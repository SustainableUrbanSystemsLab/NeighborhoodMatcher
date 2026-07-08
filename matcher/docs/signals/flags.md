# Flags

## What the column is

The `flags` column on each row of the linked dataset (and detail file) is a
plain-English summary of every concern raised about that match. It's built
by `matcher.signals.build_flags` from the other signals.

- Empty string (`""`) when no flag fires.
- Otherwise, ` | `-joined messages.

Designed so a non-technical researcher can read a row top-to-bottom in
Excel and immediately see what (if anything) is wrong with it, without
needing to know what NNDR or SMD mean.

## Triggers and messages

Order shown matches the order they appear in the joined string.

| Trigger | Message format |
|---------|----------------|
| no valid match (all distances inf) | `WARNING: no valid match — target shares no observed features with any supplemental row` |
| `nndr ≥ threshold` | `ambiguous match — NNDR {nndr:.2f} (>= {threshold:.2f})` |
| `near_miss_count > 0` | `{n} near-miss row(s) within distance ratio threshold` |
| `repeat_count > 1` | `{n} exact-distance tie(s)` |
| `mnn_confirmed=False` | `MNN not confirmed — supplemental row is closer to a different target; this record may have no valid match` |
| `target_missing > 0` | `target row missing {k} of {n} shared feature(s); match uses observed features only` |
| `match_missing > 0` | `matched supplemental row missing {k} of {n} shared feature(s)` |
| `SMD > 0.25` for any feature | `poor feature balance — {features} (|SMD| > 0.25)` |
| `0.10 < SMD ≤ 0.25` for any feature | `feature imbalance — {features} (|SMD| > 0.10)` |

A no-match row reports only the no-match warning (plus its missing-feature
count) — the per-match flags would be meaningless without a match.

Boundaries:

- NNDR is **inclusive** at the threshold (`nndr == threshold` flags).
- SMD warn band is `(0.10, 0.25]`. Exactly 0.10 does not flag.
- SMD poor band is `> 0.25`. A feature in the poor band is **not** also
  listed in the warn band — they are mutually exclusive.

## Why the threshold is reported in the message

The threshold used for an individual run is part of the flag text
(e.g. `(>= 0.80)`). This means a downstream reader can always see what
threshold the run was scored against without having to know the run config.

## Why SMD lists every feature in the band

SMD is run-wide — one value per feature for the whole match output. When a
feature's SMD is high, *every* row in the run gets the SMD flag in its
`flags` column. A single researcher inspecting one match should know about
systemic imbalance even if their specific row otherwise looks clean.

## Adding a new flag

Add an entry to `_FLAG_RULES` in `matcher.signals` with `message` (and
optionally `threshold`), then extend `build_flags` to evaluate the new
condition and append the formatted message. Keep messages plain-English —
this is the only column non-technical users read.

## Related

- [cascading_nndr.md](cascading_nndr.md), [mnn_confirmed.md](mnn_confirmed.md),
  [dataset_smd.md](dataset_smd.md) — sources of individual flags.
- [../output_format.md](../output_format.md) — where the column lives in the
  file format.
