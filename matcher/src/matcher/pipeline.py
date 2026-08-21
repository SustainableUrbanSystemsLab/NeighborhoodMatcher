import os
import sys

import numpy as np

from .io import load_csv, clean_val, dump_csv
from .align import find_common_headers, header_warnings, no_shared_columns_error
from .standardize import dual_standardize, scale_compatibility_warnings
from .distance import match_all, validate_threshold, validate_max_distance, winner_observed_stats
from .merge import row_merge, new_header
from .signals import (
    per_row_feature_contribution,
    dataset_smd,
    build_flags,
    confidence_tier,
)


def extract_features(rows, common, index_key, file_label, line_numbers=None):
    """
    Pulls the shared columns out of raw CSV rows and parses each cell via
    clean_val (float, or None when missing).

    Re-raises parse failures with the file, 1-based CSV line, and column
    name so a researcher can find the offending cell. line_numbers maps
    each row back to its line in the ORIGINAL file (blank lines are
    skipped at load time); without it, row position + 2 is assumed.
    """
    extracted = []
    for r, row in enumerate(rows):
        values = []
        for c in common:
            try:
                values.append(clean_val(row[c[index_key]]))
            except ValueError as exc:
                line = line_numbers[r] if line_numbers else r + 2
                raise ValueError(
                    f"{file_label}: line {line}, column '{c['headerName']}': {exc}"
                ) from None
            except IndexError:
                raise ValueError(
                    f"{file_label}: column index {c[index_key]} for "
                    f"'{c['headerName']}' is out of range for this file's rows"
                ) from None
        extracted.append(values)
    return extracted


def missing_counts(extracted_rows):
    """Number of missing (None) shared features per row."""
    return [sum(1 for v in row if v is None) for row in extracted_rows]


def coordinator(target, supplemental, output="data/output.csv", exclude=None, threshold=0.8,
                fast=False, max_distance=None):
    """
    Full matching pipeline.

    target       : path to target CSV
    supplemental : path to supplemental CSV
    output       : path for linked dataset output CSV
    exclude      : list of column names to skip even if shared
    threshold    : NNDR threshold used for near-miss flagging (default 0.8, Lowe 2004)
    fast         : opt into the faster distance engine (~25%) at the cost of
                   bitwise tie reproducibility — see distance.match_all
    max_distance : optional cutoff in per-feature z-units; a match whose
                   best_distance / sqrt(features_used) exceeds it is rejected
                   ("no match" with diagnostics preserved in the detail file).
                   None (default) disables rejection — unchanged behaviour.

    Returns the list of dataset-level warnings emitted for this run
    (currently: scale-compatibility warnings, also printed to stderr).
    """
    if exclude is None:
        exclude = []
    validate_threshold(threshold)
    validate_max_distance(max_distance)

    # Refuse to clobber an input, and fail on a bad output location BEFORE
    # minutes of matching compute (a raw FileNotFoundError used to surface
    # only at write time).
    base, ext = os.path.splitext(output)
    detail_output = f"{base}_detail{ext}"
    for out_path in (output, detail_output):
        if os.path.realpath(out_path) in (
            os.path.realpath(target), os.path.realpath(supplemental)
        ):
            raise ValueError(
                f"output path {out_path!r} would overwrite an input file"
            )
        out_dir = os.path.dirname(out_path) or "."
        if not os.path.isdir(out_dir):
            raise ValueError(
                f"output directory {out_dir!r} does not exist"
            )

    # Load (line numbers kept so parse errors can cite the original file
    # even after blank lines are skipped)
    h1, rs1, lines1 = load_csv(target, with_line_numbers=True)
    h2, rs2, lines2 = load_csv(supplemental, with_line_numbers=True)

    # Align columns
    common = find_common_headers(h1, h2, exclude)
    feature_names = [c["headerName"] for c in common]

    if not common:
        raise no_shared_columns_error(h1, h2)
    if not rs1:
        raise ValueError(f"{target}: target dataset has no rows.")
    if not rs2:
        raise ValueError(f"{supplemental}: supplemental dataset has no rows.")

    # Extract and clean shared columns (missing cells -> None -> NaN;
    # never imputed — distances mask missing dimensions instead)
    filtered_rs1 = extract_features(rs1, common, "header1Index", target, lines1)
    filtered_rs2 = extract_features(rs2, common, "header2Index", supplemental, lines2)

    target_missing = missing_counts(filtered_rs1)
    supp_missing = missing_counts(filtered_rs2)

    # Dataset-level sanity checks before pooling the two files
    warnings = scale_compatibility_warnings(filtered_rs1, filtered_rs2, feature_names)
    warnings += header_warnings(h1, h2, feature_names)
    for w in warnings:
        print(f"WARNING: {w}", file=sys.stderr)

    # Standardize across both datasets jointly
    std_rows_1, std_rows_2 = dual_standardize(filtered_rs1, filtered_rs2)

    # Pass 1: vectorized brute-force matching (chunked; see distance.match_all —
    # brute force is a privacy decision, only the arithmetic is vectorized)
    res = match_all(std_rows_1, std_rows_2, threshold=threshold, fast=fast)

    # Winner-pair observed-feature stats (features actually compared, and
    # whether the pair agrees exactly on all of them)
    features_used, exact_on_observed = winner_observed_stats(
        std_rows_1, std_rows_2, res["best_index"]
    )

    # Optional max-distance cutoff (per-feature z-units) — same rule as
    # web_api._assemble_prepared; rejected rows take the no-match path with
    # diagnostics preserved in the detail file.
    matched_mask = res["best_index"] >= 0
    rejected = np.zeros(len(std_rows_1), dtype=bool)
    if max_distance is not None:
        with np.errstate(invalid="ignore"):
            per_feature_dist = res["best_distance"] / np.sqrt(
                np.maximum(features_used.astype(float), 1.0)
            )
        rejected = matched_mask & (per_feature_dist > max_distance)
    accepted_mask = matched_mask & ~rejected

    # Dataset-level SMD — one computation across accepted matched pairs
    if accepted_mask.any():
        smd = dataset_smd(
            np.asarray(std_rows_1)[accepted_mask],
            res["best_index"][accepted_mask],
            std_rows_2,
        )
    else:
        smd = np.zeros(len(feature_names))

    # Pass 2: per-row signals and output assembly
    n_features = len(feature_names)
    blank_supp_row = [""] * len(h2)
    linked_rows = []
    detail_rows = []
    for i in range(len(std_rows_1)):
        if not matched_mask[i]:
            flags = build_flags(
                1.0, 0, threshold, 0, smd, feature_names,
                target_missing=target_missing[i], no_match=True,
            )
            tier = "No match"
            linked_rows.append(
                row_merge(rs1[i], blank_supp_row, common)
                + ["", 0, "", 0, 0, 0, "", "", tier, flags]
            )
            detail_rows.append(
                [i, "", "", 0, 0, target_missing[i], "", 0, ""]
                + ["" for _ in feature_names]
                + [tier, flags]
            )
            continue

        j = int(res["best_index"][i])
        repeats = int(res["repeats"][i])
        nndr_val = float(res["nndr"][i])
        near_miss = int(res["near_miss"][i])
        confirmed = bool(res["mnn_confirmed"][i])
        row_features_used = int(features_used[i])
        row_exact = bool(exact_on_observed[i])
        dist = float(res["best_distance"][i])
        contributions = per_row_feature_contribution(std_rows_1[i], std_rows_2[j])

        if rejected[i]:
            per_feat_dist = dist / np.sqrt(max(row_features_used, 1))
            flags = build_flags(
                nndr_val, near_miss, threshold, repeats, smd, feature_names,
                target_missing=target_missing[i],
                rejected=True, rejected_distance=per_feat_dist, cutoff=max_distance,
            )
            tier = "No match"
            linked_rows.append(
                row_merge(rs1[i], blank_supp_row, common)
                + ["", 0, "", 0, 0, 0, "", "", tier, flags]
            )
            detail_rows.append(
                [i, dist, round(nndr_val, 4), near_miss, int(confirmed),
                 target_missing[i], supp_missing[j], row_features_used, int(row_exact)]
                + [round(float(c), 6) for c in contributions]
                + [tier, flags]
            )
            continue

        flags = build_flags(
            nndr_val, near_miss, threshold, repeats, smd, feature_names,
            mnn_confirmed=confirmed,
            target_missing=target_missing[i],
            match_missing=supp_missing[j],
        )
        tier = confidence_tier(
            False, False, nndr_val, threshold, repeats,
            confirmed, near_miss, row_features_used, n_features,
        )

        # Fill missing target cells in shared columns from the matched row
        # (raw value verbatim) and record which columns were filled. Output
        # completion only — matching itself never imputes.
        merged = row_merge(rs1[i], rs2[j], common)
        filled = []
        for k, c in enumerate(common):
            if filtered_rs1[i][k] is None and filtered_rs2[j][k] is not None:
                merged[c["header1Index"]] = rs2[j][c["header2Index"]]
                filled.append(c["headerName"])

        linked_rows.append(
            merged
            + [dist, repeats, round(nndr_val, 4), near_miss, int(confirmed),
               row_features_used, int(row_exact), "; ".join(filled), tier, flags]
        )
        detail_rows.append(
            [i, dist, round(nndr_val, 4), near_miss, int(confirmed),
             target_missing[i], supp_missing[j], row_features_used, int(row_exact)]
            + [round(float(c), 6) for c in contributions]
            + [tier, flags]
        )

    # Write linked dataset
    linked_headers = (
        new_header(h1, h2, common)
        + ["euc_distance", "repeats", "nndr", "near_miss_count", "mnn_confirmed",
           "features_used", "exact_on_observed", "filled_from_match",
           "confidence", "flags"]
    )
    dump_csv(output, linked_headers, linked_rows)

    # Write match detail
    base, ext = os.path.splitext(output)
    detail_headers = (
        ["target_index", "euc_distance", "nndr", "near_miss_count", "mnn_confirmed",
         "target_missing", "match_missing", "features_used", "exact_on_observed"]
        + [f"contrib_{name}" for name in feature_names]
        + ["confidence", "flags"]
    )
    dump_csv(f"{base}_detail{ext}", detail_headers, detail_rows)

    return warnings
