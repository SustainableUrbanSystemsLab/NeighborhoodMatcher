# Signals

Each match-quality signal lives in its own document. They share the same
shape: definition, what it catches, edge cases, and how it appears in
`flags`.

| Signal | Function | What it catches |
|--------|----------|-----------------|
| [Euclidean distance](euc_distance.md) | `compute_sorted_distances` | Raw match closeness in standardized space. |
| [Cascading NNDR](cascading_nndr.md) | `cascading_nndr` | Ambiguity: how clearly the best match stands apart from the runners-up. |
| [Mutual nearest neighbor](mnn_confirmed.md) | `mnn_confirmed` | Asymmetric matches — best match "belongs" to a different target row. |
| [Per-row feature contribution](per_row_feature_contribution.md) | `per_row_feature_contribution` | Which features drove this specific match's distance. |
| [Dataset SMD](dataset_smd.md) | `dataset_smd` | Run-wide imbalance on each feature across all matched pairs. |
| [Flags](flags.md) | `build_flags` | The plain-English summary written to the `flags` column. |

The signals are independent — each measures a different aspect of confidence.
A match can be clean on one and flagged on another (e.g., low NNDR but
MNN not confirmed). See [flags.md](flags.md) for how individual signals
combine into the `flags` column.

## Quick literature pointers

| Signal | Source |
|--------|--------|
| NNDR (`d1/d2`) and the cascading extension | Lowe, IJCV 2004 (extended to a near-miss count) |
| MNN | Muja & Lowe, FLANN 2009 |
| SMD and the 0.10 / 0.25 thresholds | Austin, *Statistics in Medicine* 2009 (PMC3472075) |

The full literature review (Fellegi-Sunter, caliper matching, ReliefF, VIM,
etc.) is preserved in [../old-planning/match_quality_brainstorm.md](../old-planning/match_quality_brainstorm.md).
