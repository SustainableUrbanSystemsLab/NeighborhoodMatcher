## Probabilistic Dataset Merge

A general-purpose tool for linking two tabular datasets at a common geographic
resolution — built around the immediate need to merge our team's Pedestrian
Environment Index (PEI) scores with Adolescent Brain Cognitive Development
(ABCD) mental-health data at the U.S. census-tract level. The matching logic
is dataset-agnostic, so the same tool serves both our in-house research
question and a public release for other groups facing comparable record-
linkage problems.

**Live tool:** _<https://dataset-merge-smur.netlify.app/>_

### Setup

```bash
# Backend (Python)
cd version-3
python -m venv venv && source venv/bin/activate
pip install -e .
pytest                               # 85 tests

# Webapp (loads the same Python via Pyodide in-browser)
cd apps/dataset-merge
pnpm install
pnpm dev
```

Full backend documentation: [`version-3/docs/`](../version-3/docs/).

### Abstract

The tool takes a *target* dataset and a *supplemental* dataset, both at the
same geographic resolution, and finds the closest supplemental row for each
target row using standardized Euclidean distance over shared columns. For
every match it also computes a battery of match-quality signals — Nearest
Neighbor Distance Ratio (NNDR), Mutual Nearest Neighbor (MNN) confirmation,
per-row feature contributions, and dataset-level Standardized Mean Difference
(SMD) — and emits a plain-English `flags` column so non-technical researchers
can read row-by-row whether to trust each link.

The driving use case is a collaboration with **Dr. Benson Ku (Emory
University)**: linking PEI built-environment scores to ABCD mental-health
outcomes by census tract, so we can ask whether walkable, well-connected
environments correlate with measured adolescent well-being. The matching
infrastructure built for that question is general — it works on any pair of
CSVs that share at least one column — so the same code is released as a
public webapp.

### How it works

The pipeline is a straight line of pure functions:

1. **Align shared columns.** Exact column-name matches are detected
   automatically; mismatched names can be linked manually in the webapp.
2. **Joint z-score standardization.** Both datasets are normalized using a
   combined per-column mean and standard deviation, so the same raw value
   maps to the same standardized value in either source.
3. **Compute distances.** For every target row, the standardized Euclidean
   distance is computed against *every* supplemental row. Distances are kept
   in full so the quality signals can be derived.
4. **Pick the best match per target.** Closest supplemental row by distance.
   Ties are recorded.
5. **Derive quality signals and flags.** See "Match quality signals" below.

Output is two CSVs: a linked dataset (target rows + matched supplemental
columns + per-row signals + plain-English flags) and a wider detail file
(per-feature contributions, full per-row diagnostics) for audit.

### Privacy / HIPAA framing

The matching engine is **deliberately brute-force**: every target row is
compared against every supplemental row with no spatial index, no kd-tree, no
approximate nearest-neighbor structure. This is a privacy decision, not a
performance one. ABCD is HIPAA-protected and the supplemental side carries
location-derived attributes; any indexed structure that exploits geographic
proximity could leak location information through query patterns or
re-identification side channels. Holding the algorithm at brute force keeps
the privacy posture explicit: every match is computed in isolation, and the
same code path is followed for every row.

The current build also surfaces a soft warning when a user attempts to match
on columns that look like direct identifiers (census tract IDs, coordinates).
That warning is bypassable today and is one of the items flagged for the next
revision; an external HIPAA / ethics review of the methodology is the
top-priority next step.

### Match quality signals

Each linked row carries five signals plus a derived `flags` string. Brief
summary; full reference at [`version-3/docs/signals/`](../version-3/docs/signals/).

| Signal | What it captures |
|--------|------------------|
| `euc_distance` | Standardized Euclidean distance to the matched row. |
| `cascading_nndr` | $d_1/d_2$ ratio (Lowe 2004) plus a "near-miss count" of supplemental rows within threshold of the best match. Primary ambiguity signal — scale-invariant across runs. |
| `mnn_confirmed` | Reverse-direction check: does the matched supplemental row also point back to this target? Catches asymmetric matches where the supplemental row "belongs" to a different target. |
| `per_row_feature_contribution` | Per-feature share of the squared distance for one match. Useful when a flagged row turns out to be driven by a single column with a unit error. |
| `dataset_smd` | Run-wide standardized mean difference per feature across all matched pairs. Threshold benchmarks from Austin (PMC3472075): >0.10 = imbalance, >0.25 = poor. |
| `flags` | Plain-English summary string. Empty when no signal fires; otherwise a `\|`-joined list (`ambiguous match — NNDR 0.92 (>= 0.80) \| 3 near-miss row(s) ...`). |

### Webapp

A React + Vite frontend (`apps/dataset-merge/`) loads the entire Python
matcher into the browser via **Pyodide**. Researchers upload two CSVs, link
columns interactively, and inspect a Results UI with a sortable per-row
diagnostics table, a per-feature SMD bar chart, and a per-row drill-down
showing feature-contribution bars, a top-k rank plot, and a full-population
distance histogram.

Running the matcher in the browser means no participant data ever leaves the
researcher's machine — another deliberate piece of the privacy posture. The
frontend and CLI share the *same* Python module (`web_api` mirrors the file-
based `coordinator`), so any signal works identically in both entry points.

### Explanatory PDFs

A separate LaTeX pipeline (`version-3/explanatory/`) generates one PDF per
characteristic match scenario — exact match, rounding discrepancy, scale
mismatch, ambiguous match, and MNN not confirmed. Each PDF walks a non-
technical reader through the target row, all 20 candidates, a worked
distance calculation, a histogram of all candidate distances, and the value
each signal takes for that scenario with a plain-English explanation.

These are surfaced from the webapp's "How it works" page so a researcher can
see what each flag actually corresponds to in real data.

### Runtimes

(Current, on a single laptop core, with the full signals pipeline.)

| Workload | Time |
|----------|------|
| `acs-test` (~350 tracts × ~350 tracts) | sub-second |
| Realistic ABCD-scale workload (~70k × 70k target) | does not yet meet the under-2-minute target |

The signals layer added meaningful overhead. Vectorising the distance matrix
and the per-row signal loop is the natural next pass and is queued as a
high-priority next step (see below). Optimisation has to stay within the
brute-force constraint set by the privacy posture.

### Strengths and Weaknesses

**Strengths**

- General-purpose matching: works on any pair of CSVs sharing at least one
  column. Same code serves both our in-house PEI ↔ ABCD merge and a public
  release.
- Honest quality reporting: every row carries a plain-English flag string
  instead of a single composite "match score." Researchers can trace
  exactly why a row was flagged.
- Browser-based, no data egress: Pyodide runs the matcher locally;
  participant data never leaves the user's machine.
- Privacy posture is explicit and load-bearing: brute force is deliberate,
  documented, and tested.

**Weaknesses**

- The signals are theoretically motivated but **not empirically validated**
  against human-labelled match quality.
- The default NNDR threshold (0.8) is borrowed from computer vision (Lowe
  2004) and has not been calibrated on tabular census-tract data.
- Performance does not yet hit the realistic ABCD workload target.
- Missing values are silently coerced to zero rather than imputed or flagged.
- The PII safeguard is currently a soft warning and is bypassable.

### Next steps

Top priorities (full list in the repo's [`HANDOFF.md`](../HANDOFF.md)):

1. **External HIPAA / ethics audit** of the matching methodology.
2. **Harden the PII safeguard** beyond a soft warning.
3. **Performance pass** — target ~70k × 70k under 2 minutes, staying
   brute-force.
4. **Empirically validate the signals** against human-labelled match quality
   on a sample.
5. **Source real-population calibration data** (target dataset measured
   independently of the supplemental ACS pool) and rebuild the NNDR
   calibration script.
6. **UX overhaul** of the webapp's "How it works" page — more visual
   explainers, full PDFs and detailed glossary moved to a links list.