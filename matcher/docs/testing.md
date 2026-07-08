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
| `tests/test_io.py` | `clean_val` — comma/dollar/whitespace stripping, NA / empty → "0". |
| `tests/test_align.py` | `find_common_headers` — shared columns, exclude list, missing intersections. |
| `tests/test_standardize.py` | `dual_standardize` — combined mean ≈ 0, std ≈ 1; constant-column guard; row-count preservation. |
| `tests/test_distance.py` | `euclidean_distance`, `brute_find_best_match`, `compute_sorted_distances`. Includes 3-4-5 triangle, sort order, tie counting, agreement between brute and sorted variants. |
| `tests/test_merge.py` | `row_merge`, `new_header` — non-shared appended, shared not duplicated. |
| `tests/signals/test_cascading_nndr.py` | Degenerate inputs, clear / ambiguous matches, threshold sensitivity, cascading stop condition, flat-landscape edge case. |
| `tests/signals/test_mnn_confirmed.py` | Symmetric / one-directional matches, single-target row, tie handling (permissive — `reverse_repeat_count`). |
| `tests/signals/test_per_row_feature_contribution.py` | Sums to 1.0, hand-computed decomposition, single-feature dominance, sign invariance, exact-match → all zeros. |
| `tests/signals/test_dataset_smd.py` | Hand-computed values against pooled-SD formula, threshold benchmarks (0.10 / 0.25), constant-feature → 0, single-pair → 0. |
| `tests/signals/test_build_flags.py` | Each individual flag trigger, NNDR threshold inclusivity, SMD warn/poor band exclusivity, multi-flag joining. |

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
