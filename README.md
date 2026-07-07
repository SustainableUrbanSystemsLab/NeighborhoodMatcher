# NeighborhoodMatcher

Tooling developed by the Sustainable Urban Systems Lab for matching
participant-level data to neighborhood-scale records (American Community Survey
census tracts and similar). The repository captures three iterations of the
matcher and a browser frontend.

## Repository layout

| Folder | What it is | Authorship |
|--------|------------|------------|
| [`version-1/`](version-1/) | Original Python (`acs_matcher`) and R packages. Match participant CSVs to ACS tracts and copy over a `new_feature` column. Tolerance-based matching. | Predates the current author (Tristin Shestag). Archived — kept for reference only. The R package is unmaintained and not run in CI; Python is the only supported path. Install paths in [`version-1/README.md`](version-1/README.md). |
| [`version-2/`](version-2/) | Modular Python tool that finds the closest supplemental row for each target row using standardized Euclidean distance. Adds an analysis suite, sample data, and design notes. | Tristin Shestag — spring 2026. |
| [`version-3/`](version-3/) | Current backend. Same matching core as v2 plus a battery of match-quality signals (NNDR, MNN, dataset SMD, per-row feature contribution, plain-English flags), an explanatory-PDF pipeline, and a Pyodide-loadable `web_api` for the frontend. See [`version-3/docs/`](version-3/docs/). | Tristin Shestag — spring 2026. |
| [`apps/dataset-merge/`](apps/dataset-merge/) | React + Vite webapp that runs `version-3` in the browser via Pyodide. Upload two CSVs, link columns, view per-row diagnostics. | Tristin Shestag — spring 2026. |

Each version is self-contained in its folder; later versions do not import code
from earlier ones. The progression is iterative — v2 generalizes the v1 idea,
v3 adds the quality-signals layer on top of v2's matching logic.

## Where to start

- **Researchers picking up the project:** read [`version-3/docs/README.md`](version-3/docs/README.md).
- **Running the webapp locally:** [`apps/dataset-merge/`](apps/dataset-merge/).
- **Looking at the older R / tolerance-matching code (archived, unmaintained):** [`version-1/README.md`](version-1/README.md).