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
