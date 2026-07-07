[![Unit tests](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/actions/workflows/unittests.yml/badge.svg?branch=main)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/actions/workflows/unittests.yml)

# acs-matcher

Match participant-level CSVs to ACS tracts and copy over a `new_feature` column.

## Project layout

- `python/acs_matcher/`: Python package (uv/pyproject in `python/`).
- `python/tests/`: Python tests.
- `r/`: R package (DESCRIPTION, NAMESPACE, R/, tests/).

## Installation (with uv, Python)

```bash
uv pip install "git+https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher.git#subdirectory=python"
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

## Development (with uv, Python)

```bash
# from repo root
cd python

# create a local .venv and install deps + the package in editable mode
uv sync

# run the test suite
uv run python -m unittest discover tests
```

## R package

From the repo root:

```bash
# install R deps and build/install the package locally
R -q -e "install.packages(c('digest','testthat')); install.packages('remotes'); remotes::install_local('r')"

# run the R tests
R -q -e "testthat::test_dir('r/tests/testthat')"
```

Usage in R:

```r
library(acsMatcher)

match_participants(
  acs_csv_path = "ACS_Dataset.csv",
  participant_csv_path = "Participant_Dataset.csv",
  rtol = 0.005
)
```

This writes `*_matched.csv` and `*_unmatched.csv` next to your participant file and returns their paths.
