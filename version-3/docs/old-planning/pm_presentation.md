# Neighborhood Matcher — Match Quality Development Update

**Audience:** Project manager / future end user | **Stats background assumed**
**Estimated read time:** 5–10 minutes

---

## 1. What This Tool Does

- Takes two datasets of census tracts (or similar neighborhood-level units) and finds the best match for each row in the target dataset from a larger supplemental pool
- Matching is done using **standardized Euclidean distance** — features are z-score normalized across both datasets, then distance is computed across all shared columns
- Currently produces a merged output with the best match appended to each target row, plus a raw distance and tie count
- **The work described here is designing the next layer: telling researchers how much to trust each match**

---

## 2. Guiding Principles

These principles drive every design decision and are non-negotiable:

- **Honest over optimistic** — signals must reflect genuine uncertainty, not reassure researchers into false confidence
- **Absolute over relative** — a target row with 5 near-miss candidates is equally concerning in a pool of 100 or 100,000; percentile ranks would hide this
- **Transparent audit trail** — every matching decision must be reconstructable by a reviewer
- **Researcher in control** — the tool flags and informs; it does not silently alter results
- **Separate signals before unifying** — develop individual quality metrics first; a single composite score comes later, if at all

---

## 3. Match Quality Signals Being Developed

Five distinct signals, each measuring a different aspect of confidence:

- **Raw distance (`euc_distance`)** — already captured; hard to interpret alone but foundational
- **Cascading NNDR (`nndr`, `near_miss_count`)** — the primary signal *(see Literature below)*; measures how uniquely the best match stands apart from runners-up
- **Mutual Nearest Neighbor flag (`mnn_confirmed`)** — binary check: does the matched supplemental row also point back to the target row as its best match? One-directional matches are lower confidence
- **Dataset-level SMD** — across all matched pairs, how imbalanced is each feature on average? Detects systemic bias in a run *(see Literature below)*
- **Per-row feature contribution** — for each match, which columns drove the distance? Enables a heat map view of why a specific match is good or bad

All signals are computed from the brute-force pass already being run — no additional algorithmic cost.

---

## 4. Output Format — What Researchers Will Receive

A single **zip package** upon run completion, containing:

| File | Contents | Primary audience |
|------|----------|-----------------|
| `linked_dataset.csv` | Original target rows + matched supplemental columns + all quality signal columns + a plain-English **`flags`** column summarizing every warning for that row | Non-technical researcher, day-to-day use |
| Summary statistics document | Descriptive stats on both source datasets + run-level match quality stats (% flagged, distance distribution, SMD per feature) | PI review, methods reporting |
| `match_detail.csv` | Full distance distribution per target row, per-feature contributions, near-miss candidates with identifiers | Deep audit, methodologist review |
| Original datasets | Unmodified source files | Reproducibility |
| Use agreement + contact info | — | All users |

The **`flags` column** is the primary interface for non-technical users — e.g., `"near miss: 4 rows within threshold | low uniqueness margin"`.

---

## 5. Literature Grounding — Why It Matters

These methods are not invented here. They give us citable, principled defaults.

- **Lowe's Nearest Neighbor Distance Ratio (NNDR)** *(Lowe, IJCV 2004)*
  - Originally from computer vision (SIFT feature matching); transfers directly to tabular Euclidean distance
  - Compute `d1/d2` (best match distance / second-best distance). Ratio near 1.0 = ambiguous; ratio near 0 = confident
  - We extend this **cascading**: compute `d1/d2`, `d1/d3` ... stopping when ratio drops below threshold — giving a **near-miss count** with no separate threshold decision required
  - Default threshold: **0.8** (Lowe's empirical value). Must be recalibrated on ACS-type data before treating as authoritative
  - Matters because: provides a **unit-free, scale-invariant** ambiguity measure — solves the problem that raw distance is not comparable across runs with different numbers of features

- **Fellegi-Sunter probabilistic record linkage** *(Fellegi & Sunter, JASA 1969; Winkler 1988)*
  - Standard framework for probabilistic record linkage; uses a three-zone decision rule: definite match, possible match (ambiguous zone), definite non-match
  - The "possible link" zone is the formal equivalent of our near-miss flag
  - Implemented at scale in the open-source **Splink** library (UK Ministry of Justice)
  - Matters because: establishes that **ambiguous matches requiring human review are a normal, expected output** — not a tool failure

- **Caliper matching** *(Austin, Pharm. Statistics 2011)*
  - Standard in causal inference matching; hard-rejects any match where distance exceeds a threshold (default: 0.2 SD of the distance distribution)
  - Informs how we define "too far to match" — rows beyond the caliper should be flagged as unmatched rather than accepted as poor matches
  - Matters because: gives a principled, citable basis for **when not to match at all**

- **Standardized Mean Difference (SMD)** *(Austin, PMC3472075)*
  - Measures covariate balance after matching: `|mean(target feature) − mean(matched feature)| / pooled SD`
  - Benchmarks: |SMD| > 0.10 = worth noting; |SMD| > 0.25 = poor balance on that feature
  - Used at two levels: **run-level** (systemic bias across all matches) and **row-level** (which features drove a specific match)
  - Matters because: provides a **per-feature quality signal with an established, published threshold** — researchers can cite this in their methods

- **Mutual Nearest Neighbor (MNN)** *(Muja & Lowe, FLANN 2009)*
  - Matches confirmed in both directions (A→B and B→A) are substantially more reliable than one-directional matches
  - Simple to implement on top of the existing brute-force pass
  - Matters because: **asymmetric matches are a known failure mode** that raw distance alone does not detect

---

## 6. Longer-Term Architecture

Three tiers, in priority order:

**Tier 1 — MVP:** Researcher declares expected variable relationships upfront (e.g., "income and property value should correlate positively"). Tool flags matches that violate these — diagnostic only, does not alter results.

**Tier 2 — Preprocessing layer:** Before matching runs, the tool predicts match quality and surfaces issues:
  - Suggests column linkages beyond exact header name matches
  - Warns about likely incorrect linkages
  - Flags runs where shared features are insufficient for confident matching

**Tier 3 — Unified statistical suite (long-term):** Downstream analysis methods integrated into the tool; results can back-inform matching decisions.
  - **Hard ethical requirement:** any correlations used to influence matching must be pre-registered before data is loaded — not derived from the data being matched. Circular reasoning risk is real and must be enforced by design, not researcher discipline.

---

## 7. Calibration Status — What We Found

- A calibration experiment was run on the two provided datasets using the NNDR analysis script (`version-2/analysis/nndr_calibration.py`)
- **Finding:** Both datasets produce exact matches (distance = 0) for nearly all rows — the target data was extracted directly from the supplemental ACS dataset, so rows exist verbatim in both files
- This is the correct behavior for the **matching pipeline** (it correctly finds the right row), but it means these datasets **cannot calibrate the NNDR threshold** — with all exact matches, no near-miss signal is ever produced
- One exception: one manually perturbed row in the ACS test set produced NNDR = 0.77 with 7 near misses at threshold 0.7 — a useful proof-of-concept but not statistically meaningful
- A bug in the near-miss count logic (inverted comparison direction) was caught and fixed during this experiment — before any production use

---

## 8. What We Need

- **A calibration dataset** where target and supplemental come from genuinely different populations — e.g., study participant neighborhood variables measured independently (not extracted from) the ACS census pool. Without this, the NNDR threshold of 0.8 remains an unvalidated default borrowed from computer vision
- **Intended downstream use cases** — knowing how researchers plan to use the matched dataset informs which quality signals to prioritize and what thresholds are appropriate
- **Known expected variable relationships** — any domain knowledge about correlations we should expect between features (e.g., "poverty rate and owner-occupancy should be negatively correlated") needed for Tier 1 testing
- **Feedback on output format** — does the zip package structure meet reporting needs? Are there required fields for IRB or data use agreements that should be included?

---

*Notes file and full design rationale: `version-2/docs/match_quality_brainstorm.md`*
*Calibration script: `version-2/analysis/nndr_calibration.py`*