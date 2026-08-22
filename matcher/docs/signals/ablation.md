# Ablation (leave-one-variable-out)

## Definition

For each linked variable, re-run the matching with that variable left out
and compare run-level quality against the baseline (all variables) on the
same target rows. Implemented in `matcher.ablation`; browser entry points
`web_api.ablation_variant` / `web_api.assemble_ablation`; CLI via
`coordinator(..., ablation=True)`.

Per variable, the report carries the variant's run metrics and two deltas
(variant − baseline, so **positive = the run got better without it**):

- `delta_mnn_pct` — percentage points of MNN-confirmed rows gained/lost
- `delta_high_pct` — percentage points of High-confidence rows gained/lost

and a verdict:

| Verdict | Rule |
|---------|------|
| `consider_excluding` | removal improves MNN% or High% by ≥ 10 points, with no counter-signal at or beyond 10 points |
| `load_bearing` | removal hurts MNN% or High% by ≥ 10 points |
| `neutral` | neither |
| `insufficient_rows` | fewer than 50 rows in the sample — deltas reported, no call made |

## What it catches

**More matching variables are not automatically better.** Two failure modes
reported from real researcher use:

1. **A variable with substantial missingness.** Missing dimensions charge a
   fixed penalty instead of being imputed, so a mostly-missing variable
   contributes mostly penalty. In the motivating case, adding one such
   variable collapsed MNN confirmation from 99.9% to 28.2%: targets that
   were missing the variable lost every reverse search to targets that had
   it observed. Dropping the variable restores the linkage — which is
   exactly what the ablation measures.
2. **A variable defined or coded differently in the two files** (see
   [variable_report.md](variable_report.md) for the cheap pre-match check).
   The systematic offset inflates distances and flips winners; removal
   improves quality and the ablation flags it.

The inverse signal is also useful: a `load_bearing` variable is doing real
discriminating work — removing it would collapse the linkage.

## Method notes

- **Re-slice ≡ re-run.** Joint z-scoring is per-column, so dropping a
  column of the already-standardized arrays is equivalent to a fresh run
  with that link excluded (pinned by `tests/test_ablation.py`). The suite
  is d+1 matching passes over the prepared arrays — brute force preserved.
- **Deterministic subsampling.** Above a compute budget (~t·M·d·(d+1)
  element-ops ≈ 6e9, roughly 15 s single-core), targets are subsampled
  evenly from row 0 (200–2,000 rows, no RNG). Run-level percentages are
  statistics, so the sample answers the question; determinism keeps reruns
  identical.
- **Restricted-run MNN.** On a sampled run the reverse search sees only the
  sampled targets, so absolute percentages can differ from the full run's.
  Deltas stay valid: the baseline is computed on the same sample.
- **Reporting filters ignored.** Ablation diagnoses the raw matching
  geometry; `max_distance` and `min_confidence` do not apply inside it.
- **Tiers inside a variant** are computed with `n_features = d − 1` — each
  variant is judged as the run a researcher would get after excluding that
  link.
- Needs at least two linked variables (removing the only one would leave
  nothing to match on).

## Thresholds (heuristics, not literature-fixed)

10-point margin, 50-row floor. At n = 50 the worst-case binomial standard
error of a percentage is ~7.1 points, so 10 points is ~1.4 SE — a pragmatic
floor; from n ≈ 200 (the sampling floor) it exceeds 3 SE. A baseline near
100% cannot improve by 10 points, so already-clean runs never flag
anything. Revisit if the rule proves noisy or blind on real data.

## Reported as

- Webapp: the variable panel on the results page (runs automatically after
  results when the budget allows, otherwise on demand), with an
  "exclude and adjust" shortcut back to the Link step; also
  `diagnostics/variable_diagnostics.csv` in the results zip.
- CLI: a per-variable table on stdout and `<output_base>_ablation.csv`,
  when `ablation=True`.

## Literature

Harm-detection inverse of permutation feature importance: Breiman (2001);
Fisher, Rudin & Dominici (2019) "model reliance"; Parikh et al. (2023)
Variable Importance Matching ([arXiv:2302.11715](https://arxiv.org/abs/2302.11715));
ReliefF (Kononenko 1994; Urbanowicz et al. 2018). Those measure how much
quality *degrades* when an informative feature is removed; this signal
looks for variables whose removal *improves* quality. Design history:
[../old-planning/match_quality_brainstorm.md](../old-planning/match_quality_brainstorm.md).

## Related

- [variable_report.md](variable_report.md) — the always-on, cheap
  per-variable input check (missingness, offset SMD); ablation measures the
  damage it can only suspect.
- [mnn_confirmed.md](mnn_confirmed.md), [cascading_nndr.md](cascading_nndr.md)
  — the run-level quality metrics the deltas are built from.
