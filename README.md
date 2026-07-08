# NeighborhoodMatcher

Tooling developed by the Sustainable Urban Systems Lab for matching
participant-level data to neighborhood-scale records (American Community Survey
census tracts and similar). The repository captures three iterations of the
matcher and a browser frontend.

## Repository layout

| Folder | What it is | Authorship |
|--------|------------|------------|
| [`version-3/`](version-3/) | Current backend. Standardized-Euclidean matching core plus a battery of match-quality signals (NNDR, MNN, dataset SMD, per-row feature contribution, plain-English flags), missing-data-aware distances, an explanatory-PDF pipeline, and a Pyodide-loadable `web_api` for the frontend. See [`version-3/docs/`](version-3/docs/). | Tristin Shestag — spring 2026; hardened summer 2026. |
| [`apps/dataset-merge/`](apps/dataset-merge/) | React + Vite webapp that runs `version-3` in the browser via a pool of Pyodide workers. Upload two CSVs, link columns, view per-row diagnostics. | Tristin Shestag — spring 2026. |
| [`simulated_data/`](simulated_data/) | Simulated benchmark: fake participants generated from real ACS 2010–2014 tracts with known ground truth. Drives the regression floors in CI (`version-3/analysis/benchmark_simulated.py`). | — |

**Earlier iterations** (v1 tolerance matching in Python + R, v2 modular
Python matcher) were removed from the working tree in July 2026 and live in
git history — restore with
`git checkout <commit-before-removal> -- version-1 version-2`
(any commit up to and including the one preceding the removal). The
progression was iterative: v2 generalized the v1 idea, v3 added the
quality-signals layer on top of v2's matching logic. Python is the only
supported path; the v1 R package is unmaintained.

## Where to start

- **Researchers picking up the project:** read [`version-3/docs/README.md`](version-3/docs/README.md).
- **Running the webapp locally:** [`apps/dataset-merge/`](apps/dataset-merge/).