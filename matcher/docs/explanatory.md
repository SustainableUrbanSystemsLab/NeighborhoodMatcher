# Explanatory PDFs

The `explanatory/` package builds one PDF per signal-demonstration scenario.
Each PDF walks a non-technical researcher through:

- The target row.
- The 20 supplemental candidates, sorted by distance.
- A worked example of the standardized-distance calculation on the rank-2
  candidate.
- A histogram of all 20 candidate distances with the selected match
  highlighted.
- Each signal's value on this scenario, with a plain-English explanation.

Output is written to `explanatory/output/<scenario>.pdf` (and an intermediate
`<scenario>_hist.pdf` per scenario).

## Scenarios

| Label | Demonstrates |
|-------|--------------|
| `exact_match` | Best-case baseline — verbatim copy in the supplemental dataset. All signals at ideal values. |
| `rounding_discrepancy` | Same record at different precisions in the two datasets. Distance is non-zero but the correct row is still selected. |
| `scale_mismatch` | One feature reported in different units (per-thousand vs. raw count). Per-row contribution is the diagnostic. |
| `ambiguous_match` | Two near-twin candidates produce NNDR ≈ 1. The flag warns the researcher. |
| `mnn_not_confirmed` | The matched supplemental row is actually closer to a different target row. Requires two target rows. |

## Building

From `matcher/` with the project venv active and `pdflatex` on the path:

```sh
python explanatory/build.py                    # build all scenarios
python explanatory/build.py exact_match        # build one
python explanatory/build.py exact_match scale_mismatch
```

`build.py` writes a per-scenario `.tex` to a temp dir, runs `pdflatex` twice
(for page-number stability), and copies the resulting PDF into
`explanatory/output/`.

## Architecture

| File | Role |
|------|------|
| `build.py` | Orchestrator — Jinja2 environment, histogram rendering, LaTeX compilation, scenario registry. |
| `template.tex.j2` | LaTeX template (Jinja2 `<<` `>>` delimiters to avoid clashing with TeX). One template; the scenario provides the values. |
| `base_pool.py` | Shared 19-row supplemental pool plus the canonical target row. Each scenario inserts its own 20th supplemental row to create the demonstrated condition. Values are adapted from real ACS census-tract data; column display names are illustrative. |
| `scenarios/<name>.py` | Per-scenario builder. Returns the dict consumed by `build_context` in `build.py`. |

## Adding a scenario

1. Add a module under `explanatory/scenarios/` with a `build_scenario()`
   function returning the dict shape used by the existing scenarios. Easiest
   approach: copy `exact_match.py` and edit.
2. Register it in `_load_scenarios` inside `build.py`.
3. The output PDF and histogram are written automatically by name on the
   next `python explanatory/build.py` run.

## Conventions

- **Use the shared `SUPP_BASE`** so all scenarios share the same baseline
  candidate pool. Differentiate scenarios by their inserted row, not by
  shuffling the base.
- **One scenario, one phenomenon.** If a scenario demonstrates two issues at
  once, the explanation gets muddled — split it.
- **Prefer real data.** `SUPP_BASE` rows are real ACS census tracts. Don't
  use random synthetic values when a real example will do.
