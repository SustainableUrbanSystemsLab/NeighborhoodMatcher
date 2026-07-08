<p align="center">
  <img src="webapp/public/logo.svg" alt="NeighborhoodMatcher logo" width="96" height="96" />
</p>

<h1 align="center">NeighborhoodMatcher</h1>

<p align="center">
  Match participant-level data to neighborhood-scale records (ACS census
  tracts and similar) — with honest, plain-English quality signals for every
  match.
</p>

<p align="center">
  <a href="https://nbhdmatch.netlify.app/"><strong>▶ Use it in your browser — nbhdmatch.netlify.app</strong></a>
  <br /><br />
  <a href="https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/actions/workflows/python-tests.yml"><img src="https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/actions/workflows/python-tests.yml/badge.svg" alt="Python tests" /></a>
  <a href="https://app.netlify.com/projects/nbhdmatch/deploys"><img src="https://api.netlify.com/api/v1/badges/f2fe942a-24a9-41d3-9ed6-29dac67da9b3/deploy-status" alt="Netlify Status" /></a>
</p>

Developed by the Sustainable Urban Systems Lab. Given a **target** CSV (e.g.
study participants) and a **supplemental** CSV (e.g. census tracts), the
matcher links every target row to its closest supplemental row by
standardized Euclidean distance and reports how trustworthy each link is:
nearest-neighbor distance ratio (NNDR), mutual-nearest-neighbor confirmation,
exact-distance ties, per-feature contributions, dataset-level balance (SMD),
and missing-data flags.

Privacy is a design constraint: the search is deliberately brute-force (no
spatial indexes), and all matching runs client-side in your browser — data
never leaves your machine, even on the hosted site.

## Using it

1. Open **[nbhdmatch.netlify.app](https://nbhdmatch.netlify.app/)** (or run locally, below).
2. Upload a target CSV and a supplemental CSV. Columns with identical names
   are auto-linked; every linked column must be numeric and in the same units
   in both files. Missing cells (`NA`, blank, `-`, …) are fine — never fed
   raw or z-scored data.
3. Review the per-row diagnostics and download the results zip.

No data handy? Grab the benchmark pair from this repo:
[`simulated_data/dataset_A100.csv`](simulated_data/dataset_A100.csv) (target) ×
[`simulated_data/dataset_B_tracts.csv`](simulated_data/dataset_B_tracts.csv)
(supplemental), answer key in
[`simulated_data/truth_A100.csv`](simulated_data/truth_A100.csv).

<details>
<summary><strong>Run the webapp locally</strong> (Node + pnpm)</summary>

```bash
cd webapp
pnpm install
pnpm dev          # http://localhost:5173
```

The dev/build step copies the Python matcher sources from
[`matcher/`](matcher/) into `webapp/public/` (see
`webapp/scripts/sync-assets.mjs`), so the app always runs the same code the
tests cover. Matching runs in a pool of Pyodide Web Workers — one per CPU
core, up to 8.

</details>

<details>
<summary><strong>Use the matcher from Python</strong> (CLI, better for very large files)</summary>

Requires Python ≥ 3.9 and [uv](https://docs.astral.sh/uv/). From the repo
root:

```bash
uv run --project matcher python -c "
from matcher import coordinator
coordinator(
    target='participants.csv',
    supplemental='tracts.csv',
    output='linked.csv',
    threshold=0.8,          # NNDR near-miss threshold
    # exclude=['some_col'], # skip a shared column
)"
```

Writes `linked.csv` (matched rows + distance, NNDR, MNN, flags) and
`linked_detail.csv` (per-row audit: missing counts, per-feature
contributions). Dataset-level warnings (e.g. scale mismatch) print to stderr.
Input format, missing-value handling, and column-linking rules:
[`matcher/docs/output_format.md`](matcher/docs/output_format.md).

</details>

<details>
<summary><strong>Run the tests and the benchmark</strong></summary>

```bash
cd matcher
uv run --project . pytest                                        # 167 tests
uv run --project . python analysis/benchmark_simulated.py --check # scored vs ground truth
```

The benchmark runs the matcher against the simulated ACS datasets and fails
if any accuracy/flagging floor regresses; CI runs it on every push.

</details>

## Repository layout

| Folder | What it is |
|--------|------------|
| [`matcher/`](matcher/) | The matcher: matching core, quality signals, missing-data-aware distances, explanatory-PDF pipeline, and the Pyodide-loadable `web_api` the frontend uses. Docs in [`matcher/docs/`](matcher/docs/). |
| [`webapp/`](webapp/) | React + Vite webapp running the matcher in the browser via a pool of Pyodide workers. Deployed to [nbhdmatch.netlify.app](https://nbhdmatch.netlify.app/). |
| [`simulated_data/`](simulated_data/) | Benchmark: fake participants generated from real ACS 2010–2014 tracts with known ground truth. Drives the regression floors in CI. |

<details>
<summary><strong>History</strong></summary>

Originally authored by Tristin Shestag (spring 2026); hardened summer 2026.
Earlier iterations (v1 tolerance matching in Python + R, v2 modular Python
matcher) were removed from the working tree in July 2026 and live in git
history — restore with `git checkout <commit-before-removal> -- version-1
version-2`. Python is the only supported path.

</details>

## Where to start

- **Researchers picking up the project:** [`matcher/docs/README.md`](matcher/docs/README.md), then [`HANDOFF.md`](HANDOFF.md) for open issues and next steps.
- **Understanding a signal:** one page per signal in [`matcher/docs/signals/`](matcher/docs/signals/).
