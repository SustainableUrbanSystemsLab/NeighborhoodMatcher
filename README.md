[![Python Tests](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/actions/workflows/python-tests.yml/badge.svg?branch=main)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/actions/workflows/python-tests.yml)
[![R tests](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/actions/workflows/r-tests.yml/badge.svg?branch=main)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/actions/workflows/r-tests.yml)

# acs-matcher

Match participant-level CSVs to ACS tracts and copy over a `new_feature` column.

## Project layout

- `python/acs_matcher/`: Python package (uv/pyproject in `python/`).
- `python/tests/`: Python tests.
- `r/`: R package (DESCRIPTION, NAMESPACE, R/, tests/).

## Installation (Python):

With `uv`:

```bash
uv pip install "git+https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher.git#subdirectory=python"
```

wITH `pip`:

```
pip install "git+https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher.git#subdirectory=python"
```

## Usage (Python):

```python
from acs_matcher import match_participants

match_participants(
    acs_csv_path="ACS_Dataset.csv",
    participant_csv_path="Participant_Dataset.csv",
    rtol=0.005,  # default; 0.5%
)
```

This will create two files next to your participant CSV:

- `Participant_Dataset_matched.csv` (adds `new_feature`, `tract_alias`)
- `Participant_Dataset_unmatched.csv` (original participant columns only)

## Development (Python):

```bash
# from repo root
cd python

# create a local .venv and install deps + the package in editable mode
uv sync

# run the test suite
uv run python -m unittest discover tests
```

## Installation (R)

Recommended (install directly from GitHub):

```bash
install.packages("remotes", repos = "https://cloud.r-project.org")
remotes::install_github("SustainableUrbanSystemsLab/NeighborhoodMatcher", subdir = "r")
```

## Usage (R):

```r
library(acsMatcher)

match_participants(
  acs_csv_path = "ACS_Dataset.csv",
  participant_csv_path = "Participant_Dataset.csv",
  rtol = 0.005
)

```

This will create two files next to your participant CSV:

- `Participant_Dataset_matched.csv` (adds `new_feature`, `tract_alias`)
- `Participant_Dataset_unmatched.csv` (original participant columns only)

## Development / Local install (R, Windows example)
From the repo root:
```
# set a user-writable library (single path) for this session
set R_LIBS_USER=%USERPROFILE%\R\libs

# install R deps and build/install the package locally (verbose output)
"C:\Program Files\R\R-4.5.2\bin\x64\Rscript.exe" -e "lib <- file.path(Sys.getenv('USERPROFILE'), 'R', 'libs'); dir.create(lib, showWarnings = FALSE, recursive = TRUE); .libPaths(lib); install.packages(c('digest','testthat','remotes'), lib=lib, repos='https://cloud.r-project.org'); remotes::install_local('r', lib=lib)"

# run the R tests (uses the same library path)
"C:\Program Files\R\R-4.5.2\bin\x64\Rscript.exe" -e "lib <- file.path(Sys.getenv('USERPROFILE'), 'R', 'libs'); .libPaths(lib); testthat::test_dir('r/tests/testthat')"
```



