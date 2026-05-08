# Neighborhood Matcher — Version 3 Documentation

Version 3 is the Python backend that links a target dataset to a supplemental
dataset using standardized Euclidean distance and reports a set of match-quality
signals for each pair. It is consumed both by a CLI pipeline (writes CSVs) and
by an in-browser frontend (Pyodide-loaded `web_api`).

## Where things live

| Topic | Document |
|-------|----------|
| Pipeline overview, modules, data flow | [architecture.md](architecture.md) |
| Files written by a run | [output_format.md](output_format.md) |
| Per-signal reference (one file per signal) | [signals/](signals/) |
| Explanatory PDFs and how to rebuild them | [explanatory.md](explanatory.md) |
| Test suite layout | [testing.md](testing.md) |
| Earlier design notes (kept for context) | [old-planning/](old-planning/) |

## Quick orientation

- `src/matcher/` — the package. Pure functions, no global state.
  - `pipeline.py` — file-based entry point (`coordinator`).
  - `web_api.py` — in-memory entry point used by the browser frontend (loaded via Pyodide by [`apps/dataset-merge/`](../../apps/dataset-merge/)).
  - `io.py`, `align.py`, `standardize.py`, `distance.py`, `merge.py` — stages.
  - `signals.py` — match-quality signals. See [signals/](signals/).
- `tests/` — pytest suite. Mirror of the package layout; see [testing.md](testing.md).
- `analysis/` — researcher-facing scripts (e.g., dataset perturbation).
- `explanatory/` — pipeline that builds per-scenario PDFs explaining each signal.
- `data/` — sample inputs (ACS, Dexter) and perturbed variants.
- `docs/old-planning/` — original brainstorm and PM presentation. Kept for
  historical context; the live docs are the files in this folder.

## Running the pipeline

```python
from matcher import coordinator

coordinator(
    target="data/acs-test/real-data/dataseta.csv",
    supplemental="data/acs-test/real-data/datasetb.csv",
    output="data/output.csv",
    threshold=0.8,   # NNDR threshold; see signals/cascading_nndr.md
)
```

Two CSVs are written: the linked dataset at `output` and a per-row detail file
at `<output>_detail.csv`. See [output_format.md](output_format.md) for the
column lists.

## Running the tests

```sh
pytest
```

from `version-3/` (with the project venv active). Tests do not require any of
the sample CSVs — they use small in-memory fixtures.