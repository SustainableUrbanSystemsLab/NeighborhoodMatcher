# acs-matcher

Match participant-level CSVs to ACS tracts and copy over a `new_feature` column.

## Installation (with uv)

```bash
uv add acs-matcher
```

## Usage

```python
from acs_matcher import match_participants_to_new_feature

match_participants_to_new_feature(
    acs_csv_path="ACS_Dataset.csv",
    participant_csv_path="Participant_Dataset.csv",
    rtol=0.005,  # default; 0.5%
)
```

This will create two files next to your participant CSV:

- `Participant_Dataset_matched.csv`
- `Participant_Dataset_unmatched.csv`
