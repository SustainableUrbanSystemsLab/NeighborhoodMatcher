# In-memory pipeline wrapper for the browser (Pyodide) frontend.
# Wraps the same logic as pipeline.coordinator but:
#   - takes CSV strings instead of file paths
#   - returns structured data instead of writing CSV files
#   - includes per-target diagnostics needed for the Results UI
#       (distance histogram, top-k near-miss distances, feature contributions)

import csv
import io as _io

import numpy as np

from .align import find_common_headers
from .standardize import dual_standardize, scale_compatibility_warnings
from .distance import match_all
from .merge import row_merge, new_header
from .pipeline import extract_features, missing_counts
from .signals import (
    per_row_feature_contribution,
    dataset_smd,
    build_flags,
)


def _parse_csv_string(csv_str, file_label):
    reader = csv.reader(_io.StringIO(csv_str.lstrip("﻿")))
    data = list(reader)
    if not data:
        return [], []
    headers, raw_rows = data[0], data[1:]
    rows = []
    for i, row in enumerate(raw_rows):
        if not row:  # blank line — skip, matching io.load_csv
            continue
        if len(row) != len(headers):
            raise ValueError(
                f"{file_label}: line {i + 2} has {len(row)} cells, "
                f"expected {len(headers)} (matching the header)"
            )
        rows.append(row)
    return headers, rows


def _validate_links(links):
    """
    The explicit-links path bypasses find_common_headers, so it needs its
    own ambiguity guard: two links sharing a name or a column index would
    silently double-weight one column or link the wrong one (last-wins).
    """
    names = [l["headerName"] for l in links]
    t_idx = [l["header1Index"] for l in links]
    s_idx = [l["header2Index"] for l in links]
    problems = []
    for label, values in (("column name", names),
                          ("target column index", t_idx),
                          ("supplemental column index", s_idx)):
        seen, dupes = set(), set()
        for v in values:
            if v in seen:
                dupes.add(v)
            seen.add(v)
        if dupes:
            problems.append(f"duplicate {label}(s): {', '.join(str(d) for d in sorted(dupes))}")
    if problems:
        raise ValueError(
            "Ambiguous column links — " + "; ".join(problems)
            + ". Each shared column must be linked exactly once."
        )


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

    h1, rs1 = _parse_csv_string(target_csv, "target file")
    h2, rs2 = _parse_csv_string(supplemental_csv, "supplemental file")

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
        _validate_links(common)
    feature_names = [c["headerName"] for c in common]

    if not common:
        raise ValueError("No shared columns to match on.")
    if not rs1:
        raise ValueError("Target dataset has no rows.")
    if not rs2:
        raise ValueError("Supplemental dataset has no rows.")

    # Missing cells -> None -> NaN; never imputed — distances mask missing
    # dimensions instead (see pipeline.coordinator, same behaviour).
    filtered_rs1 = extract_features(rs1, common, "header1Index", "target file")
    filtered_rs2 = extract_features(rs2, common, "header2Index", "supplemental file")

    target_missing = missing_counts(filtered_rs1)
    supp_missing = missing_counts(filtered_rs2)

    warnings = scale_compatibility_warnings(filtered_rs1, filtered_rs2, feature_names)

    std_rows_1, std_rows_2 = dual_standardize(filtered_rs1, filtered_rs2)

    n_target = len(std_rows_1)

    # Distance pass dominates the wall clock; reserve the last 5% of the
    # progress bar for output assembly.
    def _match_progress(frac):
        if progress_cb is None:
            return
        try:
            progress_cb(0.95 * frac)
        except Exception:
            pass

    # Vectorized brute-force matching (chunked; brute force is a privacy
    # decision — see docs/architecture.md). chunk_size=32 keeps the transient
    # broadcast block small enough for the WASM heap in Pyodide.
    res = match_all(
        std_rows_1, std_rows_2, threshold=threshold,
        top_k=top_k, hist_bins=hist_bins,
        chunk_size=32, progress_cb=_match_progress,
    )

    # Dataset-level SMD — computed across validly matched pairs only
    matched_mask = res["best_index"] >= 0
    if matched_mask.any():
        smd = dataset_smd(
            np.asarray(std_rows_1)[matched_mask],
            res["best_index"][matched_mask],
            std_rows_2,
        )
    else:
        smd = np.zeros(len(feature_names))

    linked_headers = (
        new_header(h1, h2, common)
        + ["euc_distance", "repeats", "nndr", "near_miss_count", "mnn_confirmed", "flags"]
    )
    detail_headers = (
        ["target_index", "euc_distance", "nndr", "near_miss_count", "mnn_confirmed",
         "target_missing", "match_missing"]
        + [f"contrib_{name}" for name in feature_names]
        + ["flags"]
    )

    blank_supp_row = [""] * len(h2)
    linked_rows = []
    detail_rows = []
    per_target = []
    flagged_count = 0
    mnn_confirmed_count = 0
    no_match_count = 0
    nndr_sum = 0.0
    best_distance_sum = 0.0

    for i in range(n_target):
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
            per_target.append({
                "target_idx": int(i),
                "match_idx": None,
                "no_match": True,
                "best_distance": None,
                "second_distance": None,
                "nndr": None,
                "near_miss": 0,
                "mnn_confirmed": False,
                "repeats": 0,
                "target_missing": int(target_missing[i]),
                "match_missing": None,
                "contributions": [0.0 for _ in feature_names],
                "flags": flags,
                "hist_counts": [],
                "hist_edges": [],
                "top_k_distances": [],
            })
            flagged_count += 1
            no_match_count += 1
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

        best_distance = float(res["best_distance"][i])
        second = res["second_distance"][i]
        second_distance = float(second) if np.isfinite(second) else float("nan")

        linked_rows.append(
            row_merge(rs1[i], rs2[j], common)
            + [best_distance, repeats, round(nndr_val, 4), near_miss, int(confirmed), flags]
        )
        detail_rows.append(
            [i, best_distance, round(nndr_val, 4), near_miss, int(confirmed),
             target_missing[i], supp_missing[j]]
            + [round(float(c), 6) for c in contributions]
            + [flags]
        )

        hist_counts, hist_edges = res["histograms"][i] if hist_bins > 0 else ([], [])
        top_dists = res["top_k"][i] if top_k > 0 else []

        per_target.append({
            "target_idx": int(i),
            "match_idx": int(j),
            "no_match": False,
            "best_distance": best_distance,
            "second_distance": second_distance,
            "nndr": float(nndr_val),
            "near_miss": int(near_miss),
            "mnn_confirmed": bool(confirmed),
            "repeats": int(repeats),
            "target_missing": int(target_missing[i]),
            "match_missing": int(supp_missing[j]),
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

    n = n_target
    n_matched = n - no_match_count
    summary = {
        "total": n,
        "flagged": flagged_count,
        "mnn_confirmed": mnn_confirmed_count,
        "no_match": no_match_count,
        "mean_nndr": (nndr_sum / n_matched) if n_matched else 0.0,
        "mean_best_distance": (best_distance_sum / n_matched) if n_matched else 0.0,
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
        "warnings": list(warnings),
        "linked_headers": linked_headers,
        "linked_rows": linked_rows_str,
        "detail_headers": detail_headers,
        "detail_rows": detail_rows_str,
        "per_target": per_target,
        "summary": summary,
    }
