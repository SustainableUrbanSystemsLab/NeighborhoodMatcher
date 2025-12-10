[![Unit tests](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/actions/workflows/unittests.yml/badge.svg?branch=main)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/actions/workflows/unittests.yml)

# acs-matcher

Match participant-level CSVs to ACS tracts and copy over a `new_feature` column.

## Installation (with uv)

```bash
uv pip install git+https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher.git
```

## Usage

```python
from acs_matcher import match_participants

match_participants(
    acs_csv_path="ACS_Dataset.csv",
    participant_csv_path="Participant_Dataset.csv",
    rtol=0.005,  # default; 0.5%
)
```

This will create two files next to your participant CSV:

- `Participant_Dataset_matched.csv`
- `Participant_Dataset_unmatched.csv`

## Development (with uv)

```bash
# create a local .venv and install deps + the package in editable mode
uv sync

# run the test suite
uv run python -m unittest discover tests
```


