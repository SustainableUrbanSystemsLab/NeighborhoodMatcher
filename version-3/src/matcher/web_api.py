# NOTE: Human authorized.
# In-memory pipeline wrapper for the browser (Pyodide) frontend.
# Wraps the same logic as pipeline.coordinator but:
#   - takes CSV strings instead of file paths
#   - returns structured data instead of writing CSV files
#   - includes per-target diagnostics needed for the Results UI
#       (distance histogram, top-k near-miss distances, feature contributions)

import csv
import io as _io

import numpy as np

from .io import clean_val
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


def _parse_csv_string(csv_str):
    reader = csv.reader(_io.StringIO(csv_str))
    data = list(reader)
    if not data:
        return [], []
    return data[0], data[1:]


def _histogram(dists, bins):
    counts, edges = np.histogram(dists, bins=bins)
    return counts.tolist(), edges.tolist()


def coordinate_in_memory(
    target_csv,
    supplemental_csv,
    links=None,
    exclude=None,
    threshold=0.8,
    hist_bins=30,
    top_k=50,
    progress_cb=None,
):
    """
    Browser-facing entry point.

    target_csv, supplemental_csv : CSV strings (header row + data rows).
    links                        : optional list of explicit column pairings
                                   [{"headerName", "header1Index", "header2Index"}].
                                   When None, falls back to shared-name auto-detection
                                   via find_common_headers (matches CLI behaviour).
    exclude                      : list of shared column names to skip. Only used
                                   when `links` is None.
    threshold                    : NNDR threshold for near-miss flagging.
    hist_bins                    : number of bins in the per-target distance histogram.
    top_k                        : number of nearest distances returned per target
                                   (used to draw the near-miss cluster).

    Returns a dict consumable from JavaScript via Pyodide (all leaf values are
    plain Python lists / numbers / strings, so .toJs() yields clean data).
    """
    if exclude is None:
        exclude = []

    h1, rs1 = _parse_csv_string(target_csv)
    h2, rs2 = _parse_csv_string(supplemental_csv)

    if links is None:
        common = find_common_headers(h1, h2, exclude)
    else:
        # Normalize dict-like entries coming from JS.
        common = [
            {
                "headerName": link["headerName"],
                "header1Index": int(link["header1Index"]),
                "header2Index": int(link["header2Index"]),
            }
            for link in links
        ]
    feature_names = [c["headerName"] for c in common]

    if not common:
        raise ValueError("No shared columns to match on.")
    if not rs1:
        raise ValueError("Target dataset has no rows.")
    if not rs2:
        raise ValueError("Supplemental dataset has no rows.")

    filtered_rs1 = [[clean_val(row[c["header1Index"]]) for c in common] for row in rs1]
    filtered_rs2 = [[clean_val(row[c["header2Index"]]) for c in common] for row in rs2]

    std_rows_1, std_rows_2 = dual_standardize(filtered_rs1, filtered_rs2)

    n_target = len(std_rows_1)
    step = max(1, n_target // 50)

    def _report(phase_offset, i):
        if progress_cb is None:
            return
        # Overall progress spans two passes (0..1); each pass is half.
        frac = (phase_offset + (i / n_target)) / 2.0 if n_target else 1.0
        try:
            progress_cb(frac)
        except Exception:
            pass

    matches = []
    for i, row in enumerate(std_rows_1):
        sorted_dists, j, repeats = compute_sorted_distances(row, std_rows_2)
        matches.append((i, j, repeats, sorted_dists))
        if i % step == 0:
            _report(0.0, i)

    matched_indices = [m[1] for m in matches]
    smd = dataset_smd(std_rows_1, matched_indices, std_rows_2)

    linked_headers = (
        new_header(h1, h2, common)
        + ["euc_distance", "repeats", "nndr", "near_miss_count", "mnn_confirmed", "flags"]
    )
    detail_headers = (
        ["target_index", "euc_distance", "nndr", "near_miss_count", "mnn_confirmed"]
        + [f"contrib_{name}" for name in feature_names]
        + ["flags"]
    )

    linked_rows = []
    detail_rows = []
    per_target = []
    flagged_count = 0
    mnn_confirmed_count = 0
    nndr_sum = 0.0
    best_distance_sum = 0.0

    for idx_iter, (i, j, repeats, sorted_dists) in enumerate(matches):
        if idx_iter % step == 0:
            _report(1.0, idx_iter)
        nndr_val, near_miss = cascading_nndr(sorted_dists, threshold)
        confirmed, _ = mnn_confirmed(i, j, std_rows_1, std_rows_2)
        contributions = per_row_feature_contribution(std_rows_1[i], std_rows_2[j])
        flags = build_flags(
            nndr_val, near_miss, threshold, repeats, smd, feature_names,
            mnn_confirmed=confirmed,
        )

        best_distance = float(sorted_dists[0])
        second_distance = float(sorted_dists[1]) if len(sorted_dists) > 1 else float("nan")

        linked_rows.append(
            row_merge(rs1[i], rs2[j], common)
            + [best_distance, repeats, round(nndr_val, 4), near_miss, int(confirmed), flags]
        )
        detail_rows.append(
            [i, best_distance, round(nndr_val, 4), near_miss, int(confirmed)]
            + [round(float(c), 6) for c in contributions]
            + [flags]
        )

        hist_counts, hist_edges = _histogram(sorted_dists, bins=hist_bins)
        top_dists = sorted_dists[: min(top_k, len(sorted_dists))].tolist()

        per_target.append({
            "target_idx": int(i),
            "match_idx": int(j),
            "best_distance": best_distance,
            "second_distance": second_distance,
            "nndr": float(nndr_val),
            "near_miss": int(near_miss),
            "mnn_confirmed": bool(confirmed),
            "repeats": int(repeats),
            "contributions": [float(c) for c in contributions],
            "flags": flags,
            "hist_counts": hist_counts,
            "hist_edges": hist_edges,
            "top_k_distances": top_dists,
        })

        if flags:
            flagged_count += 1
        if confirmed:
            mnn_confirmed_count += 1
        nndr_sum += float(nndr_val)
        best_distance_sum += best_distance

    if progress_cb is not None:
        try:
            progress_cb(1.0)
        except Exception:
            pass

    n = len(matches)
    summary = {
        "total": n,
        "flagged": flagged_count,
        "mnn_confirmed": mnn_confirmed_count,
        "mean_nndr": (nndr_sum / n) if n else 0.0,
        "mean_best_distance": (best_distance_sum / n) if n else 0.0,
        "threshold": threshold,
    }

    # Stringify rows for CSV serialization back in JS. Keep numbers formatted
    # consistently — matches what pipeline.coordinator writes to disk.
    linked_rows_str = [[str(v) for v in row] for row in linked_rows]
    detail_rows_str = [[str(v) for v in row] for row in detail_rows]

    return {
        "feature_names": feature_names,
        "smd": [float(s) for s in smd],
        "threshold": float(threshold),
        "linked_headers": linked_headers,
        "linked_rows": linked_rows_str,
        "detail_headers": detail_headers,
        "detail_rows": detail_rows_str,
        "per_target": per_target,
        "summary": summary,
    }
