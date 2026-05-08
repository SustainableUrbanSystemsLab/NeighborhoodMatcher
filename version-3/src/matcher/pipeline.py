import os

from .io import load_csv, clean_val, dump_csv
from .align import find_common_headers
from .standardize import dual_standardize
from .distance import compute_sorted_distances
from .merge import row_merge, new_header
from .signals import (
    cascading_nndr,
    mnn_confirmed,
    per_row_feature_contribution,
    dataset_smd,
    build_flags,
)


def coordinator(target, supplemental, output="data/output.csv", exclude=None, threshold=0.8):
    """
    Full matching pipeline.

    target       : path to target CSV
    supplemental : path to supplemental CSV
    output       : path for linked dataset output CSV
    exclude      : list of column names to skip even if shared
    threshold    : NNDR threshold used for near-miss flagging (default 0.8, Lowe 2004)
    """
    if exclude is None:
        exclude = []

    # Load
    h1, rs1 = load_csv(target)
    h2, rs2 = load_csv(supplemental)

    # Align columns
    common = find_common_headers(h1, h2, exclude)
    feature_names = [c["headerName"] for c in common]

    # Extract and clean shared columns
    # NOTE: Empty cells and NA default to 0.
    # Future improvement: impute column mean or flag missing data.
    filtered_rs1 = [[clean_val(row[c["header1Index"]]) for c in common] for row in rs1]
    filtered_rs2 = [[clean_val(row[c["header2Index"]]) for c in common] for row in rs2]

    # Standardize across both datasets jointly
    std_rows_1, std_rows_2 = dual_standardize(filtered_rs1, filtered_rs2)

    # Pass 1: match every target row, collect full distance distributions
    matches = []
    for i, row in enumerate(std_rows_1):
        sorted_dists, j, repeats = compute_sorted_distances(row, std_rows_2)
        matches.append((i, j, repeats, sorted_dists))

    # Dataset-level SMD — one computation across all matched pairs
    matched_indices = [m[1] for m in matches]
    smd = dataset_smd(std_rows_1, matched_indices, std_rows_2)

    # Pass 2: per-row signals and output assembly
    linked_rows = []
    detail_rows = []
    for i, j, repeats, sorted_dists in matches:
        nndr_val, near_miss = cascading_nndr(sorted_dists, threshold)
        confirmed, _         = mnn_confirmed(i, j, std_rows_1, std_rows_2)
        contributions        = per_row_feature_contribution(std_rows_1[i], std_rows_2[j])
        flags                = build_flags(nndr_val, near_miss, threshold, repeats, smd, feature_names)

        dist = float(sorted_dists[0])
        linked_rows.append(
            row_merge(rs1[i], rs2[j], common)
            + [dist, repeats, round(nndr_val, 4), near_miss, int(confirmed), flags]
        )
        detail_rows.append(
            [i, dist, round(nndr_val, 4), near_miss, int(confirmed)]
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
        ["target_index", "euc_distance", "nndr", "near_miss_count", "mnn_confirmed"]
        + [f"contrib_{name}" for name in feature_names]
        + ["flags"]
    )
    dump_csv(f"{base}_detail{ext}", detail_headers, detail_rows)
