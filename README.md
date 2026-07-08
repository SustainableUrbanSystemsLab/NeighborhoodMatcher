<p align="center">
  <img src="apps/dataset-merge/public/logo.svg" alt="NeighborhoodMatcher logo" width="96" height="96" />
</p>

<h1 align="center">NeighborhoodMatcher</h1>

<p align="center">
  Match participant-level data to neighborhood-scale records (ACS census
  tracts and similar) — with honest, plain-English quality signals for every
  match.
  <br />
  <a href="https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/actions/workflows/python-tests.yml"><img src="https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/actions/workflows/python-tests.yml/badge.svg" alt="Python tests" /></a>
</p>

Developed by the Sustainable Urban Systems Lab. Given a **target** CSV (e.g.
study participants) and a **supplemental** CSV (e.g. census tracts), the
matcher links every target row to its closest supplemental row by
standardized Euclidean distance and reports how trustworthy each link is:
nearest-neighbor distance ratio (NNDR), mutual-nearest-neighbor confirmation,
exact-distance ties, per-feature contributions, dataset-level balance (SMD),
and missing-data flags. Privacy is a design constraint: the search is
deliberately brute-force (no spatial indexes), and the webapp runs entirely
in your browser — data never leaves the machine.

## Quick start

**Webapp** (drag-and-drop, in-browser, parallel across CPU cores):

```bash
cd apps/dataset-merge
pnpm install
pnpm dev          # http://localhost:5173
```

**CLI** (Python ≥ 3.9, via [uv](https://docs.astral.sh/uv/)):

```bash
uv run --project version-3 python -c "
from matcher import coordinator
coordinator(
    target='participants.csv',
    supplemental='tracts.csv',
    output='linked.csv',
)"
```

Writes `linked.csv` (matched rows + distance, NNDR, MNN, flags) and
`linked_detail.csv` (per-row audit: missing counts, per-feature
contributions). Input format, missing-value handling, and column-linking
rules: [`version-3/docs/output_format.md`](version-3/docs/output_format.md).

Try it with the checked-in benchmark pair:
`simulated_data/dataset_A100.csv` × `simulated_data/dataset_B_tracts.csv`
(ground truth in `simulated_data/truth_A100.csv`).

## Repository layout

| Folder | What it is |
|--------|------------|
| [`version-3/`](version-3/) | The matcher: matching core, quality signals, missing-data-aware distances, explanatory-PDF pipeline, and the Pyodide-loadable `web_api` the frontend uses. Docs in [`version-3/docs/`](version-3/docs/). |
| [`apps/dataset-merge/`](apps/dataset-merge/) | React + Vite webapp running `version-3` in the browser via a pool of Pyodide workers. Upload two CSVs, link columns, inspect per-row diagnostics. |
| [`simulated_data/`](simulated_data/) | Benchmark: fake participants generated from real ACS 2010–2014 tracts with known ground truth. Drives the regression floors in CI (`version-3/analysis/benchmark_simulated.py`). |

Originally authored by Tristin Shestag (spring 2026); hardened summer 2026.
Earlier iterations (v1 tolerance matching in Python + R, v2 modular Python
matcher) were removed from the working tree in July 2026 and live in git
history — restore with `git checkout <commit-before-removal> -- version-1
version-2`. Python is the only supported path.

## Where to start

- **Researchers picking up the project:** [`version-3/docs/README.md`](version-3/docs/README.md), then [`HANDOFF.md`](HANDOFF.md) for open issues and next steps.
- **Understanding a signal:** one page per signal in [`version-3/docs/signals/`](version-3/docs/signals/).
- **Running the tests:** `cd version-3 && uv run --project . pytest`.
