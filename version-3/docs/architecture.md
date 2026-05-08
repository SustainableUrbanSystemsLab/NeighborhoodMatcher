# Architecture

The matcher takes two CSVs (target and supplemental), produces a linked
dataset, and computes per-row match-quality signals. The pipeline is a straight
line of pure functions — each stage takes the previous stage's output and
returns the next.

## Stages

```
load_csv ──► find_common_headers ──► clean_val ──► dual_standardize
                                                          │
                                                          ▼
                                                compute_sorted_distances
                                                          │
                                                          ▼
                                  ┌───── per-row signals ─┴───── dataset_smd ─┐
                                  │                                            │
                                  ▼                                            ▼
                              build_flags ◄────────────────────────────────────┘
                                  │
                                  ▼
                              row_merge ──► dump_csv
```

| Module | Role |
|--------|------|
| `io.py` | CSV parsing/writing, value cleanup. |
| `align.py` | Find columns shared between the two header lists. |
| `standardize.py` | Joint z-score across both datasets so the same raw value maps to the same standardized value in both. |
| `distance.py` | Standardized Euclidean distance and the brute-force nearest-neighbor search (returns the full sorted distance vector). |
| `signals.py` | Match-quality signals computed from the distance vector and matched pairs. See [signals/](signals/). |
| `merge.py` | Append non-shared supplemental columns onto the target row; build the merged header. |
| `pipeline.py` | File-based entry point (`coordinator`). |
| `web_api.py` | In-memory entry point for the browser/Pyodide frontend. Same logic; returns structured data plus per-target diagnostics. |

## Two passes

`coordinator` and `coordinate_in_memory` both do two passes over the target
rows:

1. **Pass 1 — distances.** For each target row, compute the full sorted
   distance vector against every supplemental row. Cache `(i, j, repeats,
   sorted_dists)`.
2. **Compute dataset-level SMD** across all matched pairs.
3. **Pass 2 — per-row signals and output.** For each cached match, compute
   `cascading_nndr`, `mnn_confirmed`, `per_row_feature_contribution`, and
   `build_flags`, then write the linked + detail rows.

The two-pass split exists because dataset-level SMD needs the full set of
matched indices before per-row flags can be assembled (a feature flagged as
imbalanced shows up in every row's `flags` column).

## Brute force, by design

Distance computation is `O(N × M × d)` — every target row is compared to every
supplemental row. No indexing structures (kd-trees, ball trees, FLANN) are used
because:

- Standardization is joint across both datasets, so any index would need to be
  rebuilt per run.
- The signals pipeline (especially `cascading_nndr` and the histograms in
  `web_api`) needs the full sorted distance vector, not just a top-k.
- Real runs are tabular data with `N`, `M` in the thousands — brute force
  finishes in seconds.

If a future revision needs to handle datasets that make brute force untenable,
the signal definitions need to be revisited (NNDR currently depends on the
full sorted distances).

## Two entry points, one core

- `pipeline.coordinator(target_path, supp_path, output, …)` — used by scripts
  and by the CLI. Reads/writes files.
- `web_api.coordinate_in_memory(target_csv_str, supp_csv_str, …)` — used by the
  browser frontend (Pyodide). Same matching logic; takes/returns strings and
  Python primitives so JS can serialize the result via `.toJs()`.

The web API additionally returns per-target diagnostics (distance histograms,
top-k near-miss distances, feature contributions) for the Results UI. The CLI
writes the equivalent information to the detail CSV.