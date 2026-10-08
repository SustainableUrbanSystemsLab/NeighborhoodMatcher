# Dataset Matcher (webapp)

Client-side webapp for matching and merging two CSV datasets using
standardized Euclidean distance. Built for researchers who need to enrich a
target dataset with columns from a supplemental reference dataset based on
statistical similarity across shared variables.

The matching engine is the Python package in [`../matcher/`](../matcher/) —
the same code the CLI and the test suite run — executed in the browser via
Pyodide. `scripts/sync-assets.mjs` copies the matcher sources (and the
explanatory PDFs) into `public/` on every dev/build, and CI fails if the
copy drifts.

## How it works

1. Upload a **target** CSV (your data) and a **supplemental** CSV (reference data)
2. Accept the data use agreement (PHI/PII risk acknowledgment; can be
   remembered per device)
3. Link columns — exact name matches are auto-detected (whitespace-trimmed,
   ambiguous duplicates refused), mismatched names can be linked manually,
   and any column can be excluded from the distance without unlinking it
4. Run matching — a pool of Pyodide Web Workers (sized to the job, up to
   all-but-one CPU core, user-overridable) splits the target rows, each
   worker matching against the full supplemental set; results merge exactly
5. Inspect per-row diagnostics (distance, NNDR, MNN, ties, per-feature
   contributions, plain-English flags) and download the results zip
   (linked CSV, match detail, data + match statistics, SMD, agreement)

## Theming

Light and dark, following the OS/browser (`prefers-color-scheme`) by default
and overridable per device with the single theme icon in the header, which
cycles Auto → Light → Dark and shows the state it is in. The choice lives in
`localStorage` (`nbhdmatch:theme`); "Auto" keeps following the system,
including when it flips while the page is open. The dark palette is GitHub's
(Primer): canvas `#0d1117`, cards `#161b22`, borders `#30363d`, text
`#e6edf3`, with Primer's accent / success / attention / danger families.

The palette is a variable layer, not a per-component `dark:` sweep: the app is
written in literal Tailwind utilities, Tailwind v4 compiles those to
`var(--color-*)`, and `src/main.css` re-points the palette (and the `--chart-*`
tokens the inline SVGs paint with) under `[data-theme="dark"]`. Two rules keep
that honest:

- Card and panel backgrounds use the `surface` token, not `bg-white`, so
  `white` still means white where it must (`text-white` on colored buttons).
- New color choices that cannot be expressed as a palette re-point use the
  `dark:` variant, which is wired to the same attribute.

`index.html` applies the stored/system theme before the bundle loads, so
dark-mode visitors never see a white flash.

## Local storage and reopening runs

The app keeps three small things per device, all in `localStorage`, none of
them dataset contents: the data-use agreement acceptance, the theme choice,
the worker-count override — and a **run history** (`nbhdmatch:runs`, last 20)
holding settings, run-level quality numbers, and per-variable diagnostics.
Row-level data is deliberately excluded: results here can constitute PHI,
browser storage is unencrypted and outlives the tab, so participant data has
no business in it. The panel that shows the history says so and can clear it.

To **reopen a full run** — every number and chart — load its results zip back
in from the upload step. The package already carries the original inputs and
the settings used, and matching is deterministic, so replaying it reproduces
the run exactly. That keeps the "should this persist?" decision in the
researcher's file system, under their institution's rules, instead of in
browser storage (`src/lib/restore.ts`).

A service worker (`public/sw.js`) caches the Pyodide runtime — the ~15 MB of
public, version-pinned CDN assets — so it downloads once per device and keeps
working on networks that block jsDelivr. It touches nothing else: not the
app's own bundle (a deploy is never served stale), not `/matcher/*.py` (which
changes per deploy — a stale engine beside a fresh UI would compute with the
wrong code), and nothing of the user's, which never travels over HTTP here.

## Key properties

- **Client-side only** — all computation runs in the browser; data never
  leaves your machine. Only the Pyodide runtime and numpy wheel come from a
  CDN.
- **Brute-force by design** — the matcher never builds spatial indexes; this
  is a privacy decision (see the root README), not a missing optimization.
  Performance comes from vectorization and the worker pool.
- **PII detection** — flags column names that suggest identifiable
  information (SSN, name, address, …) before matching.
- **Honest signals** — every match carries quality diagnostics; missing
  data is never imputed.

## Stack

React 18, TypeScript, Vite, Tailwind CSS v4, Papa Parse, Pyodide (numpy).
Deployed as a static site on Netlify (config: root `netlify.toml`).

## Development

```bash
cd webapp
pnpm install
pnpm dev        # runs sync-assets, then Vite on :5173
```

`pnpm build` type-checks (`tsc -b`) and produces `dist/`.
Debug knobs: `?workers=N` pins the worker-pool size for a session; the
"Parallel workers" control on the link step persists a per-device override.

## Missing / planned

- Fuzzy column-name suggestions in the linker
- Support for multiple supplemental datasets
- Formal legal agreement text (legal review pending)
- Richer PII detection
