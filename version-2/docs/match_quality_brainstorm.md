# Match Quality Statistic — Design Notes

## Context
Backend tool for **non-technical researchers**. Goal: give researchers honest, interpretable signals about how confidently a target row uniquely matched to a supplemental row.

---

## Guiding Principle
> "How can we ensure the highest match confidence and **honestly report** the confidence?"

All design choices should serve honest, transparent reporting — not optimistic presentation.

---

## Signals Under Consideration (develop separately, unify later)

### 1. Raw Distance (`euc_distance`)
- Already captured.
- Hard to interpret in isolation, but useful as a foundation.

### 2. Cascading NNDR — `nndr` + `near_miss_count`
- Compute `d1/d2`, `d1/d3`, `d1/d4` ... `d1/dn`, stopping when ratio first exceeds threshold.
- The count of ratios below threshold = `near_miss_count`. This resolves the near-miss count threshold question — no separate threshold needed.
- `nndr` (the `d1/d2` ratio) is also reported as a standalone signal.
- Ratio near 1.0 = high ambiguity; ratio near 0 = confident match. Unit-free and scale-invariant.
- **Default threshold: 0.8** (Lowe 2004 empirical value). User-configurable.
- **Frontend note required:** threshold of 0.8 is a starting point from computer vision literature and must be calibrated on real ACS-type tabular data before treating it as authoritative. Different defaults may emerge per dataset type from empirical testing.
- Since distances are already sorted in the brute-force pass, cascading is nearly free to compute.
- **Literature:** Lowe, IJCV 2004.
- **Decision:** Primary near-miss signal. Replaces / formalizes the earlier best-vs-second margin idea.

### 3. Mutual Nearest Neighbor (MNN) Flag — `mnn_confirmed`
- Run matching in both directions (target→supplemental and supplemental→target).
- Flag: does target row T's best match S also have T as its best match?
- One-directional matches are flagged as lower confidence.
- **Literature:** Muja & Lowe 2009 (FLANN).
- **Decision:** Implement as a binary flag. Simple to add to the existing brute-force pass.

### 4. Near-Miss Count / Distribution
- Capture the **full distance distribution** for each target row (cheap since we brute-force anyway).
- Enables: histogram visualization per participant, count of rows within a given distance threshold.
- Threshold for "near miss" TBD — see Open Questions.
- **Decision:** Store all distances per row; expose histogram as an optional output.

### 5. SMD — Two Distinct Uses
**Literature:** Austin (PMC3472075). Benchmarks: |SMD| > 0.10 = imbalance; |SMD| > 0.25 = poor match quality.

#### 5a. Dataset-Level SMD (run diagnostic)
- For each feature, across all matched pairs: `|mean(target_col) - mean(matched_col)| / pooled_SD`
- Detects systemic bias — e.g., if `median_income` SMD = 0.30, the matched dataset is on average misaligned on income across the whole run. Likely indicates poor supplemental coverage on that feature, or the feature is being dominated by others in the distance calculation.
- Reported in the summary statistics document.

#### 5b. Per-Row Feature Contribution (heat map)
- Since data is z-score normalized before matching, for each matched pair:
  `contribution of feature f = (z_target_f - z_matched_f)² / total_euclidean_distance²`
- Proportion of total distance attributable to each feature for that specific match.
- Tells the researcher: "this match was poor primarily because of `pct_college`."
- Reported in the high-resolution match detail file; visualized as a heat map.

**Decision:** Both computed. Dataset-level SMD → summary stats. Per-row contribution → detail file + heat map.

### 6. Ties (`repeats`)
- Already captured.
- Exact-distance ties kept as a separate signal for now.

---

## Deferred Signals — Future Revisions

### Per Feature Match Contribution by Measuring Degraded Match Quality through Systematic Ablation Methodology

**Status:** Tabled 2026-04-18. Design captured; implementation deferred to a future software revision.

**Motivation.** The existing per-row feature contribution signal (§5b) measures how much each feature contributed to the **distance** of a specific match. A complementary question — unaddressed by current signals — is how much each feature contributed to the **selection** of that match over alternatives.

A feature can have zero contribution to distance (perfect agreement between target and matched row) while having zero discriminating power (if every supplemental row also agreed on that feature, no selection work was done). The distance-based view marks such a feature as "perfect match"; the selection-based view marks it as "uninformative." Both are truthful about different properties — hence a distinct signal.

**Proposed methodology — leave-one-feature-out ablation.**

1. Compute a composite match quality score for the actual match.
2. For each feature `i`: remove feature `i`, re-run the matching pipeline, compute the composite score for the new best match.
3. Per-feature importance = degradation in composite score when `i` is removed.
4. Aggregation across all target rows yields a run-wide feature importance vector — identifies features that are broadly useful vs. features that carry little weight in the matching process.

**Literature grounding.**
- **Breiman (2001)** — original permutation feature importance, for random forests. Shuffle a feature, measure increase in prediction error.
- **Fisher, Rudin, Dominici (2019)** — *"model reliance,"* the model-agnostic generalization of Breiman. Directly applicable to non-model settings like matching.
- **Parikh et al. (2023) — Variable Importance Matching (VIM) / Model-to-Match framework** ([arXiv:2302.11715](https://arxiv.org/html/2302.11715)). Uses backward elimination and permutation importance to construct distance metrics for causal matching. Closest matching-specific analog, though VIM applies importance as global weights rather than per-match.
- **Kononenko (1994); Urbanowicz et al. (2018) — ReliefF family.** Feature weighting designed for nearest-neighbor settings. Also aggregate, not per-match.
- **Greifer; Ho, Imai, King, Stuart — `cobalt` / `MatchIt` R packages.** Standard matching diagnostics (eCDF, density, Love plots) operate at aggregate distributional level, not per-match feature importance. Our per-match importance appears to be a natural extension of permutation importance rather than a named method.

**Open design questions to resolve before implementation.**

1. **Composite score definition.** Which metric to degrade against? Candidates:
   - Raw Euclidean distance (simplest, most interpretable)
   - Cascading NNDR (aligns with existing ambiguity signal)
   - A weighted composite of existing signals
2. **Match-change handling.** When ablating feature `i` changes which supplemental row wins, is the importance measured as (a) the quality degradation of the new match, or (b) a binary flag that feature `i` was decisive? Recommendation: (a) keeps the signal on one interpretable scale; match-change is implicitly captured by larger degradation values.
3. **Computational scope.** Per-target-row ablation is `O(d)` matching passes per row — roughly `d×` cost of the current pipeline. For `d ≈ 20` features and `N ≈ 10³` targets this is tractable but non-trivial; caching the `N × M` distance matrix from the main pass would let ablation reuse it.
4. **Complementary visualization — distribution position** (not an importance measure). For each feature, plot the distribution of supplemental values and mark the target's position. Captures the intuition that low-variance features can't discriminate. Implementable independently of the ablation signal; belongs as an output artifact, not a signal.

**Rationale for deferral.** The current MVP signal set (NNDR, MNN, per-row contribution, dataset SMD, flags) covers the core honest-reporting goal. Ablation-based importance adds methodological depth but increases compute cost and output complexity; appropriate for a later revision once the base tool has been validated on real researcher workflows.

---

## Key Design Decisions

### On Absolute vs. Relative Quality
- **Concern with relative scores:** If 5 supplemental rows are near-misses, that is equally concerning whether the supplemental dataset has 10 rows or 10,000. A percentile rank would mask this — a target row with 5 near-misses in a large dataset would score higher than it should.
- **Decision:** Prefer **absolute** signals (raw distances, margins, counts within threshold) over relative/percentile rankings.

### On Dimension Count Sensitivity
- Euclidean distance grows naturally with the number of features.
- If two target rows matched using different column counts, the raw distance is not directly comparable.
- **Partial resolution:** NNDR (Signal 2) is a ratio and therefore scale/dimension-invariant — it remains comparable across runs with different feature counts. Raw `euc_distance` is not.
- **Decision:** NNDR is the primary signal for cross-run comparisons. `euc_distance` is reported but should not be compared across runs with different column sets. Flag column count in summary stats.

### On Unified Score
- **Decision:** Develop individual signals first. A unified composite score is a future consideration, not a current goal.

---

## Downstream-Aware Matching — Architecture (Three Tiers)

### Tier 1: MVP — Researcher-Declared Correlations (Upfront Parameter)
- Researcher specifies expected relationships before running (e.g., "income and property value should correlate positively").
- Tool uses these to **flag/warn** when the best-distance match violates a declared expectation.
- Does not alter the match — purely a diagnostic signal.
- Keeps transparency high; researcher retains full control.

### Tier 2 (Medium-Term): Preprocessing Layer
Between data upload and matching. Purpose: predict match quality and surface problems before committing to a run.
- **Column linkage suggestion** — propose links beyond exact header name matches (e.g., semantic similarity, shared distributions).
- **Incorrect linkage warning** — flag columns that are linked but appear to measure different things.
- **Coverage sufficiency warning** — flag when the number or quality of shared columns is likely insufficient for confident matching.
- Researcher approves/rejects suggestions before matching proceeds.

### Tier 3 (Long-Term): Unified Statistical Suite with Backdriving
- Downstream analysis methods are integrated into the tool.
- Results of downstream analysis can increase confidence in existing matches or trigger re-matching for specific rows.
- Essentially a closed-loop: match → analyze → validate/adjust → re-match if needed.

#### Ethical Requirement for Tier 3 (non-negotiable)
- **Circular reasoning risk:** If downstream analysis backdrives matching, and the matched dataset is then used for that same analysis, the system risks confirming hypotheses by construction.
- **Hard requirement:** Expected correlations used to backdriven matching must be **pre-registered or theoretically grounded before any analysis of the data**. They cannot be derived empirically from the same dataset being matched.
- This constraint must be enforced by design (e.g., correlations locked in before data is loaded), not left to researcher discipline.
- All backdrive decisions must be logged and reportable for methodological transparency.

---

---

## Output Format — MVP Deliverable (Zip Package)

Researcher receives a single zip file upon completion. Re-importable sessions are post-MVP.

### Files in Zip

#### 1. Linked Dataset (`linked_dataset.csv`)
- Target rows + appended supplemental columns (non-shared only).
- Per-row quality signal columns (e.g., `euc_distance`, `best_vs_second_margin`, `near_miss_count`, `repeats`).
- **`flags` column** — human-readable summary of all warnings raised for that row (e.g., `"near miss: 3 rows within 5% of best distance | low uniqueness margin"`). Primary interface for non-technical researchers.

#### 2. Summary Statistics Document
- **Data-level:** descriptive stats on source columns (mean, std, range, missingness) for both datasets.
- **Match-level:** aggregate matching process stats (e.g., % rows flagged, distribution of `euc_distance` across all matches, % with near misses, % ties).

#### 3. High-Resolution Match Detail File (`match_detail.csv` or similar)
- One row per target row, but wide/verbose — intended for deep investigation, not routine use.
- Candidate contents:
  - Full distance to every supplemental row (or top-N candidates).
  - Per-feature contribution to the final match distance.
  - All near-miss candidates with distances and identifiers.
  - Any declared-correlation violations (Tier 1 signals).
- Transparent audit trail: researcher or reviewer can reconstruct any matching decision.

#### 4. Original Datasets
- Unmodified source files included for reproducibility.

#### 5. Use Agreement + Contact Information

### Visual Layer
- Likely surfaces in the existing React app (`apps/dataset-merge/`).
- Exact scope TBD — at minimum, a run results screen; potentially includes histogram per row, heat map of feature contributions.

---

---

## Literature Reference

| Method | Signal | Threshold | Source |
|--------|--------|-----------|--------|
| Nearest Neighbor Distance Ratio (NNDR) | `d1/d2` — ratio near 1 = ambiguous | 0.8 empirical (recalibrate) | Lowe, IJCV 2004 |
| Mutual Nearest Neighbor (MNN) | Symmetric match confirmation | Binary | Muja & Lowe, FLANN 2009 |
| Caliper matching | Hard reject if `d1 > caliper` | 0.2 SD of distance distribution | Austin, Pharm. Stat. 2011 |
| Standardized Mean Difference (SMD) | Per-feature imbalance | \|SMD\| > 0.10 flag; > 0.25 poor | Austin, PMC3472075 |
| Fellegi-Sunter three-zone model | Probabilistic match weight | EM-estimated (match/non-match distributions) | Fellegi & Sunter, JASA 1969; Winkler 1988 |
| Gap / elbow detection | Inflection in sorted distance curve | Kneedle algorithm (Satopaa et al. 2011) | No single canonical paper; related to OPTICS |
| EVT on NNDR | Tail excess of distance ratio | Pareto fit to ratio tail | Steyn et al., JCGS 2023 |
| Permutation feature importance | Feature ranking by loss degradation under perturbation | Model-agnostic | Breiman 2001; Fisher, Rudin, Dominici 2019 |
| Variable Importance Matching (VIM / Model-to-Match) | Global feature weights for matching via importance scoring | Aggregate per run | Parikh et al. 2023 (arXiv:2302.11715) |
| ReliefF | Feature weighting for nearest-neighbor settings | k-neighbor based | Kononenko 1994; Urbanowicz et al. 2018 |

**Splink** — open-source Python library implementing Fellegi-Sunter at scale (UK Ministry of Justice). Relevant for long-term Tier 3 direction.

**`cobalt` / `MatchIt`** (Greifer; Ho, Imai, King, Stuart) — R packages providing standard matching diagnostics (eCDF, density, Love plots). Aggregate distributional views; no per-match feature importance primitives.

---

## Calibration Status

- **2026-04-06:** Calibration attempted on `acs-test` and `dexter-test` datasets. Both contain exact matches (target rows exist verbatim in supplemental). Not suitable for NNDR calibration.
- **2026-04-08 (PM feedback):** Moving forward with **artificial manipulation** of the two large sample datasets (dexter-test) to produce a rough NNDR threshold estimate. A better calibration dataset (genuinely different populations) remains a longer-term need.

---

## Testing and Explanatory Datasets

### Unit Tests (PM requirement, 2026-04-08)
- Required for all core functions and quality signals
- Must include edge cases
- Must include small sample size tests that a researcher could follow manually

### No-Match Case
- **Decision:** Soft-flag only — always return the best available match, populate `flags` with a clear warning (e.g., `"WARNING: no confident match found — best distance 2.4 SD, NNDR 0.91"`). Researcher decides whether to use the row.
- Hard-reject (caliper-based row exclusion) is a future consideration only — not planned for any current tier.
- Rationale: hard-reject is a substantive scientific decision (drops a participant); the tool should not make that call.

### Explanatory Sample Datasets
Small, purpose-built datasets for user education. Goals:
- Show how matching works step-by-step
- Demonstrate what each quality signal means in practice
- Transparently demonstrate edge cases:
  - Rounded data (matching when values are rounded to different precisions)
  - Distortion by X% (what happens when feature values are systematically off)
  - Other edge cases TBD

---

## Open Questions
- ~~How to handle dimension-count sensitivity?~~ **Resolved:** NNDR is scale-invariant; `euc_distance` flagged as not cross-run comparable.
- ~~What distance threshold constitutes a "near miss"?~~ **Resolved:** Cascading NNDR — `near_miss_count` is the number of supplemental rows with `d1/di >= threshold`. No separate threshold needed.
- NNDR threshold default is 0.8 (Lowe 2004). **In progress:** artificial manipulation experiment on dexter data. Different defaults may apply per dataset type. Frontend must communicate this to users.
- What is the exact scope of the visual layer for MVP?
- For Tier 2 preprocessing: what method for column linkage suggestion — fuzzy name matching, distribution comparison, or both?
- For Tier 3: what mechanism enforces pre-registration of expected correlations?
- What edge cases should the explanatory datasets cover beyond rounding and distortion?
- What size should the explanatory datasets be? (Proposed: 5–8 target rows, 15–20 supplemental, 3–4 features)

---

## Change Log
| Date | Note |
|------|------|
| 2026-04-06 | Initial brainstorm — T.S. + Claude |
| 2026-04-06 | Added downstream-aware matching architecture (3 tiers) + ethical constraint for Tier 3 |
| 2026-04-06 | Defined MVP output format: zip with linked dataset, summary stats, high-res detail file, originals, use agreement |
| 2026-04-06 | Added literature review; formalized signals as NNDR, MNN, SMD; partially resolved dimension-count question |
| 2026-04-06 | Extended NNDR to cascading (d1/d2, d1/d3... until threshold); resolves near-miss count question. Split SMD into dataset-level and per-row uses. |
| 2026-04-06 | Calibration attempted on acs-test and dexter-test — exact matches in both; not suitable for NNDR calibration |
| 2026-04-08 | PM feedback: proceed with artificial manipulation for rough NNDR calibration. Add unit tests (including edge cases + small researcher-followable tests). Develop explanatory sample datasets for user education. |
| 2026-04-18 | Researched feature-importance literature (Breiman 2001; Fisher/Rudin/Dominici 2019; Parikh et al. 2023 VIM; Kononenko 1994 ReliefF; `cobalt` / `MatchIt`). Documented ablation-based "Per Feature Match Contribution by Measuring Degraded Match Quality through Systematic Ablation Methodology" as a deferred signal — tabled for a future revision. |