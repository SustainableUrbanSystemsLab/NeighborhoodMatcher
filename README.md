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
  <a href="https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher"><img src="https://img.shields.io/badge/GitHub-NeighborhoodMatcher-181717?logo=github" alt="Source on GitHub" /></a>
  <a href="https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/actions/workflows/python-tests.yml"><img src="https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/actions/workflows/python-tests.yml/badge.svg" alt="Python tests" /></a>
  <a href="https://app.netlify.com/projects/nbhdmatch/deploys"><img src="https://api.netlify.com/api/v1/badges/f2fe942a-24a9-41d3-9ed6-29dac67da9b3/deploy-status" alt="Netlify Status" /></a>
</p>

Developed by **[Dr. Benson Ku](https://med.emory.edu/directory/profile/?u=BSKU)**
and **[Dr. Patrick Kastner](https://sustainableurbansystems.com/)**. Given a **target** CSV (e.g. study participants) and a
**supplemental** CSV (e.g. census tracts), the matcher links every target row to its closest supplemental row by
standardized Euclidean distance and reports how trustworthy each link is:
nearest-neighbor distance ratio (NNDR), mutual-nearest-neighbor confirmation,
exact-distance ties, per-feature contributions, dataset-level balance (SMD),
and missing-data flags.

Privacy is a design constraint: the search is deliberately brute-force (no
spatial indexes), and all matching runs client-side in your browser — data
never leaves your machine, even on the hosted site. **ZIP codes, census tract
IDs and other geographic identifiers are never matching variables**: columns
named or shaped like them are blocked, with no override, in the web app and
the Python engine alike (they still pass through to the output).

**No Internet needed.** The site serves its own Python runtime and keeps
working offline after one visit; a [desktop app](#use-it-without-internet)
covers machines that never go online, and a zip of the site can be hosted
inside an institution.

## Using it

1. Open **[nbhdmatch.netlify.app](https://nbhdmatch.netlify.app/)** (or run locally, below).
2. Upload a target CSV and a supplemental CSV. Columns with identical names
   are auto-linked; every linked column must be numeric and measure the same
   thing the same way in both files (see
   [Preparing your data](#preparing-your-data)). Missing cells (`NA`, blank,
   `-`, …) are fine. Upload raw values — never pre-standardized (z-scored)
   columns.
3. Review the per-row diagnostics and download the results zip.

## Use it without Internet

| Situation | Use |
|-----------|-----|
| Online once, offline later | Open the site once; the footer shows *Available offline on this device* when the whole app is cached. Install it from the browser menu for an app icon. |
| A computer that never goes online | The desktop app from the [latest release](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/releases/latest): `NeighborhoodMatcher-darwin-aarch64.dmg` (macOS, Apple Silicon) or `NeighborhoodMatcher-windows-x64-setup.exe` (Windows, WebView2 included). Neither carries a developer certificate, so each system asks once — see [Installing the desktop app](#installing-the-desktop-app). |
| Host it inside an institution | Download *nbhdmatch-site-v&lt;version&gt;.zip* from the site's [About page](https://nbhdmatch.netlify.app/about#offline) and serve the folder from any static server (HOSTING.txt inside lists the two settings that matter). |

In every case the runtime, the engine and all assets are local: nothing is
fetched from a CDN, and no data leaves the machine.

### Installing the desktop app

**macOS (Apple Silicon)** — one of:

- From Terminal, with no security prompt. A download through curl is not
  quarantined, so macOS does not vet the app on first launch:

  ```bash
  curl -fsSL https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/releases/latest/download/install-macos.sh | sh
  ```

  It puts the app in Applications (replacing an older copy) and opens it.
- With [Homebrew](https://brew.sh), also without a prompt; later
  `brew upgrade --cask neighborhoodmatcher`:

  ```bash
  brew install --cask SustainableUrbanSystemsLab/tap/neighborhoodmatcher
  ```

  The cask lifts the quarantine flag Homebrew puts on downloads (Homebrew 7
  dropped `--no-quarantine`), and the
  [tap](https://github.com/SustainableUrbanSystemsLab/homebrew-tap) follows
  each release by itself.
- By hand: open the .dmg, drag the app to Applications and open it from
  there. macOS says it "could not verify" the app: click **Done**, open
  System Settings → Privacy & Security, click **Open Anyway** and confirm.
  Once per copy.

**Windows** — run the installer; SmartScreen: **More info → Run anyway**.

No data handy? Grab the benchmark pair from this repo:
[`simulated_data/dataset_A100.csv`](simulated_data/dataset_A100.csv) (target) ×
[`simulated_data/dataset_B_tracts.csv`](simulated_data/dataset_B_tracts.csv)
(supplemental), answer key in
[`simulated_data/truth_A100.csv`](simulated_data/truth_A100.csv).

<details>
<summary><strong>Build everything with one command</strong> (website, self-host zip, desktop app)</summary>

```bash
./build.sh              # macOS, Linux
```

```bat
build.bat               :: Windows
```

Both run the same steps (`scripts/build-all.mjs`): install dependencies,
build the website and its self-host zip, check that the build needs no
Internet, and build the desktop app for this computer. The outputs land in
`release/`: `nbhdmatch-site-v<version>.zip`, plus the `.dmg` on macOS or the
`-setup.exe` installer on Windows. `--web-only` skips the desktop app;
`--test` also runs the Python tests, the benchmark, the Playwright tests and
the built app's self-test; `--help` lists the prerequisites. You need Node.js
20+, which provides pnpm automatically, plus Rust for the desktop app and uv
for `--test`. On Linux the desktop app is skipped.

</details>

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
tests cover, together with the Pyodide runtime and the numpy wheel
(checksum-verified; the only build-time download). Matching runs in a pool of
Pyodide Web Workers sized to the job — all CPU cores but one for anything
non-trivial.

```bash
pnpm build                 # dist/ + dist/offline/nbhdmatch-site-v<version>.zip
pnpm run check:offline     # fails if the build could need the Internet
pnpm test:e2e              # Playwright: offline run, no foreign requests, identifier guard, desktop CSP
pnpm desktop:build         # desktop app (needs Rust; CI builds the installers)
```

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

Writes `linked.csv` (matched rows + distance, NNDR, MNN, flags),
`linked_detail.csv` (per-row audit: missing counts, per-feature
contributions), `linked_variables.csv` (per-variable input diagnostics), and
`linked_run_info.csv` (tool version, authors, run timestamp, and the settings
used). Dataset-level warnings (e.g. scale mismatch) print to stderr.
Input format, missing-value handling, and column-linking rules:
[`matcher/docs/output_format.md`](matcher/docs/output_format.md).

</details>

<details>
<summary><strong>Run the tests and the benchmark</strong></summary>

```bash
cd matcher
uv run --project . pytest                                        # 460 tests
uv run --project . python analysis/benchmark_simulated.py --check # scored vs ground truth
```

The benchmark runs the matcher against the simulated ACS datasets and fails
if any accuracy/flagging floor regresses; CI runs it on every push.

</details>

## Preparing your data

The matcher standardizes both files together (joint z-scoring), which
corrects for *scale* — dollars vs thousands of dollars — but never for
*meaning*. Before uploading:

- **One header row.** NDA/ABCD-style exports carry a second row of variable
  labels or descriptions. Both the web app and the CLI detect such a row
  (text where the column is otherwise numeric, or a repeat of the column
  names), skip it, and say so — in the upload card, where you can keep it
  instead, and in the run's warnings and `run_info.csv`.
- **Same definition and coding in both files.** A column must measure the
  same quantity computed the same way. Example failure: "poverty rate" as
  % below 100% of the federal poverty line in one file but below 180% in
  the other — every value shifts systematically, distances inflate, and
  matches degrade. The results page reports a per-variable check
  (`offset SMD`) that flags this pattern.
- **Raw values only.** Don't mix a pre-z-scored column with raw data — the
  pooled statistics collapse the narrow side onto a point. The scale check
  warns when spreads differ wildly, but same-scale definition differences
  are on you to verify.
- **Mark missing data as missing.** Recognized missing tokens: blank, `NA`,
  `N/A`, `null`, `none`, `-`, `.`, `NaN`, `#N/A` (case-insensitive). Convert
  sentinel codes like `9999` or `-99` to blanks first — left in place they
  are treated as real extreme values (the upload step tries to spot repeated
  extremes, but only as a heuristic).
- **Missing values are never imputed.** Each missing dimension of a pair
  contributes a fixed distance penalty instead. A variable that is mostly
  missing therefore adds mostly penalty — noise that can drown the signal
  from complete variables and *worsen* every match. Quality beats quantity:
  fewer well-measured shared variables usually out-match many spotty ones.
  The results page runs a leave-one-variable-out check and recommends
  excluding variables that hurt the linkage.

## Versioning

[Semantic Versioning](https://semver.org/), and **every change that ships bumps
the version** — the footer, the results page, `run_info.csv` and the CLI banner
all show it, so two runs can always be told apart.

- **patch** — fixes, copy, visual polish, docs that ship in the app
- **minor** — new behaviour: a signal, a control, an output column or file
- **major** — an incompatible change to an output format or the CLI/Python API

Bump with `python scripts/bump_version.py patch|minor|major`, which rewrites
every declaration (`matcher/about.py`, `webapp/src/lib/about.ts`,
`webapp/package.json`, both `pyproject.toml`, `webapp/src-tauri/Cargo.toml`)
and keeps them in agreement;
`--check` verifies. Add a line to `CHANGELOG.md`. CI fails a pull request that
changes `matcher/src`, `webapp/src` or `webapp/public/matcher` without a bump.

## Repository layout

| Folder | What it is |
|--------|------------|
| [`matcher/`](matcher/) | The matcher: matching core, quality signals, missing-data-aware distances, explanatory-PDF pipeline, and the Pyodide-loadable `web_api` the frontend uses. Docs in [`matcher/docs/`](matcher/docs/). |
| [`webapp/`](webapp/) | React + Vite webapp running the matcher in the browser via a pool of Pyodide workers, offline-capable. Deployed to [nbhdmatch.netlify.app](https://nbhdmatch.netlify.app/). `webapp/src-tauri/` wraps the same build as the desktop app. |
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
