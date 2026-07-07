import os
import sys

import numpy as np

from .io import load_csv, clean_val, dump_csv
from .align import find_common_headers
from .standardize import dual_standardize, scale_compatibility_warnings
from .distance import match_all
from .merge import row_merge, new_header
from .signals import (
    per_row_feature_contribution,
    dataset_smd,
    build_flags,
)


def extract_features(rows, common, index_key, file_label):
    """
    Pulls the shared columns out of raw CSV rows and parses each cell via
    clean_val (float, or None when missing).

    Re-raises parse failures with the file, 1-based CSV line, and column
    name so a researcher can find the offending cell.
    """
    extracted = []
    for r, row in enumerate(rows):
        values = []
        for c in common:
            try:
                values.append(clean_val(row[c[index_key]]))
            except ValueError as exc:
                raise ValueError(
                    f"{file_label}: line {r + 2}, column '{c['headerName']}': {exc}"
                ) from None
        extracted.append(values)
    return extracted


def missing_counts(extracted_rows):
    """Number of missing (None) shared features per row."""
    return [sum(1 for v in row if v is None) for row in extracted_rows]


def coordinator(target, supplemental, output="data/output.csv", exclude=None, threshold=0.8):
    """
    Full matching pipeline.

    target       : path to target CSV
    supplemental : path to supplemental CSV
    output       : path for linked dataset output CSV
    exclude      : list of column names to skip even if shared
    threshold    : NNDR threshold used for near-miss flagging (default 0.8, Lowe 2004)

    Returns the list of dataset-level warnings emitted for this run
    (currently: scale-compatibility warnings, also printed to stderr).
    """
    if exclude is None:
        exclude = []

    # Load
    h1, rs1 = load_csv(target)
    h2, rs2 = load_csv(supplemental)

    # Align columns
    common = find_common_headers(h1, h2, exclude)
    feature_names = [c["headerName"] for c in common]

    if not common:
        raise ValueError("No shared columns to match on.")
    if not rs1:
        raise ValueError(f"{target}: target dataset has no rows.")
    if not rs2:
        raise ValueError(f"{supplemental}: supplemental dataset has no rows.")

    # Extract and clean shared columns (missing cells -> None -> NaN;
    # never imputed — distances mask missing dimensions instead)
    filtered_rs1 = extract_features(rs1, common, "header1Index", target)
    filtered_rs2 = extract_features(rs2, common, "header2Index", supplemental)

    target_missing = missing_counts(filtered_rs1)
    supp_missing = missing_counts(filtered_rs2)

    # Dataset-level sanity check before pooling the two files
    warnings = scale_compatibility_warnings(filtered_rs1, filtered_rs2, feature_names)
    for w in warnings:
        print(f"WARNING: {w}", file=sys.stderr)

    # Standardize across both datasets jointly
    std_rows_1, std_rows_2 = dual_standardize(filtered_rs1, filtered_rs2)

    # Pass 1: vectorized brute-force matching (chunked; see distance.match_all —
    # brute force is a privacy decision, only the arithmetic is vectorized)
    res = match_all(std_rows_1, std_rows_2, threshold=threshold)

    # Dataset-level SMD — one computation across all validly matched pairs
    matched_mask = res["best_index"] >= 0
    if matched_mask.any():
        smd = dataset_smd(
            np.asarray(std_rows_1)[matched_mask],
            res["best_index"][matched_mask],
            std_rows_2,
        )
    else:
        smd = np.zeros(len(feature_names))

    # Pass 2: per-row signals and output assembly
    blank_supp_row = [""] * len(h2)
    linked_rows = []
    detail_rows = []
    for i in range(len(std_rows_1)):
        if not matched_mask[i]:
            flags = build_flags(
                1.0, 0, threshold, 0, smd, feature_names,
                target_missing=target_missing[i], no_match=True,
            )
            linked_rows.append(
                row_merge(rs1[i], blank_supp_row, common)
                + ["", 0, "", 0, 0, flags]
            )
            detail_rows.append(
                [i, "", "", 0, 0, target_missing[i], ""]
                + ["" for _ in feature_names]
                + [flags]
            )
            continue

        j = int(res["best_index"][i])
        repeats = int(res["repeats"][i])
        nndr_val = float(res["nndr"][i])
        near_miss = int(res["near_miss"][i])
        confirmed = bool(res["mnn_confirmed"][i])
        contributions = per_row_feature_contribution(std_rows_1[i], std_rows_2[j])
        flags = build_flags(
            nndr_val, near_miss, threshold, repeats, smd, feature_names,
            mnn_confirmed=confirmed,
            target_missing=target_missing[i],
            match_missing=supp_missing[j],
        )

        dist = float(res["best_distance"][i])
        linked_rows.append(
            row_merge(rs1[i], rs2[j], common)
            + [dist, repeats, round(nndr_val, 4), near_miss, int(confirmed), flags]
        )
        detail_rows.append(
            [i, dist, round(nndr_val, 4), near_miss, int(confirmed),
             target_missing[i], supp_missing[j]]
            + [round(float(c), 6) for c in contributions]
            + [flags]
        )

    # Write linked dataset
    linked_headers = (
        new_header(h1, h2, common)
        + ["euc_distance", "repeats", "nndr", "near_miss_count", "mnn_confirmed", "flags"]
    )
    dump_csv(output, linked_headers, linked_rows)

    # Write match detail
    base, ext = os.path.splitext(output)
    detail_headers = (
        ["target_index", "euc_distance", "nndr", "near_miss_count", "mnn_confirmed",
         "target_missing", "match_missing"]
        + [f"contrib_{name}" for name in feature_names]
        + ["flags"]
    )
    dump_csv(f"{base}_detail{ext}", detail_headers, detail_rows)

    return warnings
