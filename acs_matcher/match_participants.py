import os
import re
import hashlib

import numpy as np
import pandas as pd

"""
Core matching logic for mapping participant-level rows to ACS tracts and
copying over a `new_feature` column.
"""

# --- helpers (private to the module) ---

_num_re = re.compile(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?")


def _alias_for_geoid(geoid: str) -> str:
    """Deterministic alias for a GEOID, to avoid exposing the raw tract ID."""
    h = hashlib.sha1(str(geoid).encode("utf-8")).hexdigest()[:8]
    return f"alias_{h}"


def _to_numeric_series(s: pd.Series) -> pd.Series:
    """
    Convert a Series to numeric where possible, robust to commas and mixed text.
    Non-parsable values become NaN.
    """
    if pd.api.types.is_numeric_dtype(s):
        return pd.to_numeric(s, errors="coerce")

    def parse_cell(x):
        if pd.isna(x):
            return np.nan
        x = str(x).replace(",", "")
        m = _num_re.search(x)
        return float(m.group(0)) if m else np.nan

    return s.map(parse_cell)


def match_participants(
    acs_csv_path: str,
    participant_csv_path: str,
    rtol: float = 0.005,
):
    """
    Match participant-level rows to ACS tracts and copy over `new_feature`. It essentially matches participants to a new feature.

    Parameters
    ----------
    acs_csv_path : str
        Path to ACS CSV with columns:
        - 'geoid'
        - neighborhood feature columns
        - 'new_feature' (the column to transfer)
    participant_csv_path : str
        Path to participant CSV with columns:
        - 'id'
        - any subset of the same neighborhood features as ACS
    rtol : float, optional
        Relative tolerance for matching (default 0.005 = 0.5%).

    Matching logic
    --------------
    - Columns in the participant file that are not present in ACS are ignored
      (a warning is printed).
    - Requires:
        * participant CSV has 'id'
        * ACS CSV has 'geoid' and 'new_feature'
    - For each participant row:
        * consider all overlapping feature columns
        * ignore features that are NaN for that participant
        * restrict ACS comparison to those available features
        * compute relative differences; require ALL used features to be within `rtol`
        * if multiple tracts match, pick the one with minimum mean relative diff.

    Outputs
    -------
    Two CSVs are written next to the participant file:

        <participant_input>_matched.csv
            - original participant columns
            - plus: 'new_feature', 'tract_alias'

        <participant_input>_unmatched.csv
            - original participant rows that found no match (no extra cols)

    Returns
    -------
    matched_path : str
        Path to the matched CSV.
    unmatched_path : str
        Path to the unmatched CSV.
    """
    # --- load and normalize column names ---
    acs_df_raw = pd.read_csv(acs_csv_path, dtype=str)
    acs_df_raw.columns = [c.strip() for c in acs_df_raw.columns]

    user_df_raw = pd.read_csv(participant_csv_path, dtype=str)
    user_df_raw.columns = [c.strip() for c in user_df_raw.columns]

    # --- required columns ---
    if "id" not in user_df_raw.columns:
        raise ValueError("Participant file must contain an 'id' column.")
    if "geoid" not in acs_df_raw.columns:
        raise ValueError("ACS data file must contain a 'geoid' column.")
    if "new_feature" not in acs_df_raw.columns:
        raise ValueError("ACS data file must contain a 'new_feature' column.")

    # --- features and overlap ---
    user_feature_cols = [c for c in user_df_raw.columns if c != "id"]
    acs_feature_cols = [c for c in acs_df_raw.columns if c not in ("geoid", "new_feature")]

    extra = [c for c in user_feature_cols if c not in acs_feature_cols]
    if extra:
        print("Columns in participant CSV not found in ACS Data (ignored):")
        for c in extra:
            print("  -", c)

    overlap = [c for c in user_feature_cols if c in acs_feature_cols]
    if not overlap:
        raise ValueError("No overlapping neighborhood feature columns between participant CSV and ACS.")

    # --- numeric versions for comparison (outputs keep original values) ---
    user_cmp = pd.DataFrame({c: _to_numeric_series(user_df_raw[c]) for c in overlap})
    acs_cmp = pd.DataFrame({c: _to_numeric_series(acs_df_raw[c]) for c in overlap})

    # ensure there is at least one participant row with some numeric data
    if (~user_cmp[overlap].isna().all(axis=1)).sum() == 0:
        raise ValueError("All participant rows are empty/NaN across the overlapping columns.")

    # --- precalc ACS arrays for speed ---
    acs_vals = acs_cmp.to_numpy(dtype=float)  # (M, K)
    acs_new = pd.to_numeric(acs_df_raw["new_feature"], errors="coerce").to_numpy()
    acs_alias = acs_df_raw["geoid"].map(_alias_for_geoid).to_numpy()

    eps = 1e-12
    matched_rows, unmatched_rows = [], []

    for idx, row in user_df_raw.iterrows():
        row_cmp = user_cmp.iloc[idx]
        valid_cols = [j for j, c in enumerate(overlap) if pd.notna(row_cmp[c])]
        if not valid_cols:
            # no usable feature values for this participant
            unmatched_rows.append(row.to_dict())
            continue

        # restrict to columns with values for this participant
        uv = row_cmp[overlap].to_numpy(dtype=float)[valid_cols]
        av = acs_vals[:, valid_cols]

        # relative diffs
        denom = np.maximum(np.maximum(np.abs(av), np.abs(uv)), eps)
        rel = np.abs(av - uv) / denom

        # require ALL provided features within tolerance
        within = (rel <= rtol).all(axis=1)

        if within.any():
            cand_rel = rel[within]
            best_idx_within = int(np.argmin(cand_rel.mean(axis=1)))
            best_global_idx = np.flatnonzero(within)[best_idx_within]

            matched_rows.append(
                {
                    **row.to_dict(),
                    "new_feature": acs_new[best_global_idx],
                    "tract_alias": acs_alias[best_global_idx],
                }
            )
        else:
            unmatched_rows.append(row.to_dict())

    # --- build outputs (keep original participant columns order) ---
    matched_df = pd.DataFrame(
        matched_rows,
        columns=list(user_df_raw.columns) + ["new_feature", "tract_alias"],
    )
    unmatched_df = pd.DataFrame(unmatched_rows, columns=list(user_df_raw.columns))

    # --- write next to participant file ---
    base, _ = os.path.splitext(participant_csv_path)
    matched_path = f"{base}_matched.csv"
    unmatched_path = f"{base}_unmatched.csv"
    matched_df.to_csv(matched_path, index=False)
    unmatched_df.to_csv(unmatched_path, index=False)

    print(f"Matched: {len(matched_df):,}. Unmatched: {len(unmatched_df):,}")
    print(f" - {matched_path}")
    print(f" - {unmatched_path}")

    return matched_path, unmatched_path
