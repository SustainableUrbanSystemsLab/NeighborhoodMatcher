# Testing

Pytest. Run from `matcher/` with the project venv active:

```sh
pytest
```

`pyproject.toml` pins `testpaths = ["tests"]`, so unqualified `pytest`
discovers everything below `tests/`.

## Layout

| File | Covers |
|------|--------|
| `tests/conftest.py` | Shared fixtures: `simple_common`, `tiny_rows_equal`, `tiny_rows_known_distance`, `reference_pool`. |
| `tests/test_io.py` | `clean_val` — comma/dollar/whitespace stripping, missing tokens → `None`, garbage → `ValueError`; `load_csv` — BOM, blank lines, ragged rows, empty file; utf-8 round-trip. |
| `tests/test_align.py` | `find_common_headers` — shared columns, exclude list, whitespace-trimmed names, empty-name and duplicate-name guards. |
| `tests/test_standardize.py` | `dual_standardize` — combined mean ≈ 0, std ≈ 1; constant-column guard; missing-value (NaN) stats; `scale_compatibility_warnings`. |
| `tests/test_distance.py` | `euclidean_distance`, `brute_find_best_match`, `compute_sorted_distances`. 3-4-5 triangle, sort order, tie counting, missing-dim penalty, no-overlap → inf. |
| `tests/test_match_all.py` | Vectorized engine ↔ per-row reference equivalence (bitwise in exact mode), chunk-size independence, coincidental exact ties, fast-mode tolerance, top-k/histograms, progress callback. |
| `tests/test_merge.py` | `row_merge`, `new_header` — non-shared appended, shared not duplicated. |
| `tests/test_pipeline.py` | `coordinator` end-to-end: MNN flag in output, missing-data flags, no-match rows, all-blank supplemental rows, guards (no shared columns, empty datasets, parse errors with file/line/column), scale-mismatch warnings, detail columns. |
| `tests/test_web_api_shards.py` | Sharded (`match_shard` + `assemble_results`) ↔ single-worker equality, shard-order independence, global MNN merge, gap/overlap rejection, JSON-safe payloads. |
| `tests/test_simulated_benchmark.py` | Regression floors on the simulated ACS benchmark (accuracy per scenario, wrong-match flag rate, no-match tripwire, runtime cap). Skipped when `simulated_data/` is absent. |
| `tests/signals/test_cascading_nndr.py` | Degenerate inputs, clear / ambiguous matches, threshold sensitivity, cascading stop condition, flat-landscape edge case. |
| `tests/signals/test_mnn_confirmed.py` | Symmetric / one-directional matches, single-target row, tie handling (permissive — `reverse_repeat_count`). |
| `tests/signals/test_per_row_feature_contribution.py` | Sums to 1.0, hand-computed decomposition, single-feature dominance, sign invariance, exact-match → all zeros. |
| `tests/signals/test_dataset_smd.py` | Hand-computed values against pooled-SD formula, threshold benchmarks (0.10 / 0.25), constant-feature → 0, single-pair → 0. |
| `tests/signals/test_build_flags.py` | Each individual flag trigger, NNDR threshold inclusivity, SMD warn/poor band exclusivity, multi-flag joining. |
| `tests/test_about.py` | Tool identity and run provenance — authors and version constants, UTC/local timestamp formats, `provenance_rows` order, the `provenance` key in web results, the CLI's `<base>_run_info.csv` (settings recorded, paths not leaked), and drift between `about.py` and the webapp's `about.ts` mirror. |
| `tests/test_io_bom.py` | UTF-8 BOM on every written CSV (Excel/ANSI mojibake fix), BOM round-trip through `load_csv`, coordinator outputs. |
| `tests/signals/test_variable_report.py` | `variable_report` / `variable_warnings` — hand-computed offset SMD (incl. a shifted-mean "poverty definition" fixture), missing-pct math, ≥30-observed warning gate, constant-column edge cases, JSON safety. |
| `tests/test_variable_panel.py` | `variables` key wiring — distance_share aggregation (single-row == contributions, matches definition, sums to 1), sharded ≡ single, CLI `<base>_variables.csv` + CLI↔web agreement. |
| `tests/test_min_confidence.py` | Minimum-confidence filter — off ≡ base run, exact withheld set per tier, run-level statistics invariant, precedence vs the distance cutoff, no fill on withheld rows, validation, sharded ≡ single, CLI↔web parity. |
| `tests/test_ablation.py` | Leave-one-variable-out — re-slice ≡ fresh-run anchor equivalence, deterministic sampling arithmetic, recommendation margins/veto/floor, MNN-collapse reproduction (harmful variable flagged, clean ones not), load-bearing detection, assembly validation + order independence, CLI table + CSV. |

## Conventions

- **Fixtures over fixture data files.** All tests use small in-memory arrays
  via `conftest.py`. The CSVs under `data/` are for end-to-end runs and
  explanatory PDFs, not for unit tests.
- **Hand-computable expected values.** Where possible, tests pin to values
  that a researcher could verify by hand — see the docstrings in
  `test_dataset_smd.py` and `test_per_row_feature_contribution.py`. This is
  a PM requirement carried over from the planning docs.
- **Edge cases first-class.** Empty inputs, single rows, exact matches, and
  threshold boundaries each get their own tests rather than being assumed.

## When adding a new signal

1. Add the function to `matcher.signals`.
2. Create `tests/signals/test_<signal>.py` mirroring the existing files —
   degenerate inputs, hand-computable cases, edge cases, threshold
   boundaries (if applicable).
3. If the signal raises a flag, add cases to `tests/signals/test_build_flags.py`.
4. Document the signal under `docs/signals/<signal>.md` and link it from
   `docs/signals/README.md` and `docs/output_format.md`.
