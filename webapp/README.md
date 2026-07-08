# Dataset Matcher

Client-side webapp for matching and merging two CSV datasets using standardized Euclidean distance. Built for researchers who need to enrich a target dataset with columns from a supplemental reference dataset based on statistical similarity across shared variables.

## How It Works

1. Upload a **target** CSV (your data) and a **supplemental** CSV (reference data)
2. Accept the data use agreement (PHI/PII risk acknowledgment)
3. Link columns between datasets — exact name matches are auto-detected, mismatches can be linked manually
4. Run matching — each target row is paired with its closest supplemental row via z-score normalized Euclidean distance
5. Preview results and download the merged CSV

## Key Properties

- **Client-side only** — all computation runs in the browser; data never leaves your machine
- **PII detection** — flags column names that suggest identifiable information (SSN, name, address, etc.)
- **Data agreement** — requires acknowledgment of re-identification risks before each session

## Stack

React 18, TypeScript, Vite, Tailwind CSS v4, Papa Parse. Deployed as a static site on Netlify.

## Development

```
cd webapp
pnpm install
pnpm dev
```

## Missing / Planned

- Preprocess step suggesting similar columns (fuzzy name matching)
- Match quality predictor between column pairs
- Detailed post-match quality breakdown (summary statistics, per-row diagnostics)
- Support for multiple supplemental datasets (many dataset Bs)
- More PII detection features
- Blackboxed serverless backend for large datasets
- User accounts and session history
- Formal legal agreement (legal review pending)
- Performance optimization for large datasets (Web Workers, KD-tree indexing)
- Duplicate match tracking and aggregation
- Identification of exact vs non-exact variable matches
