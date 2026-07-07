# In-memory pipeline wrapper for the browser (Pyodide) frontend.
# Wraps the same logic as pipeline.coordinator but:
#   - takes CSV strings instead of file paths
#   - returns structured data instead of writing CSV files
#   - includes per-target diagnostics needed for the Results UI
#       (distance histogram, top-k near-miss distances, feature contributions)
#
# Parallelism: the browser cannot thread a single WASM interpreter, so the
# frontend runs a POOL of Pyodide workers instead. Each worker calls
# match_shard on a contiguous slice of target rows; one worker then calls
# assemble_results on the collected shard outputs. Joint standardization is
# deterministic over the full datasets, so every shard computes identical
# global statistics and the shard results merge exactly.
# coordinate_in_memory (single worker) is match_shard + assemble_results
# over one full-range shard — one code path, sharded or not.

import csv
import io as _io

import numpy as np

from .align import find_common_headers
from .standardize import dual_standardize, scale_compatibility_warnings
from .distance import MISSING_PENALTY, match_all
from .merge import row_merge, new_header
from .pipeline import extract_features, missing_counts
from .signals import (
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


def _prepare(target_csv, supplemental_csv, links, exclude):
    """
    Shared front half of every entry point: parse, link columns, extract,
    count missingness, standardize jointly. Deterministic — every shard
    worker running this on the same inputs gets identical arrays.
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

    return {
        "h1": h1, "rs1": rs1, "h2": h2, "rs2": rs2,
        "common": common, "feature_names": feature_names,
        "target_missing": target_missing, "supp_missing": supp_missing,
        "warnings": warnings,
        "std_rows_1": std_rows_1, "std_rows_2": std_rows_2,
    }


def _shard_contributions(std_slice, std_rows_2, best_index):
    """
    Per-feature squared-difference proportions for each row of the slice
    against its matched supplemental row — vectorized equivalent of
    signals.per_row_feature_contribution (missing dims contribute their
    MISSING_PENALTY share; no-match rows are all zeros).
    """
    t, d = std_slice.shape
    contributions = np.zeros((t, d))
    matched = best_index >= 0
    if matched.any():
        diff = std_slice[matched] - std_rows_2[best_index[matched]]
        sq = np.where(np.isnan(diff), MISSING_PENALTY, diff * diff)
        denom = sq.sum(axis=1, keepdims=True)
        safe = np.where(denom == 0, 1.0, denom)
        contributions[matched] = np.where(denom == 0, 0.0, sq / safe)
    return contributions


def _match_shard_prepared(prep, threshold, row_lo, row_hi, top_k, hist_bins, progress_cb):
    std_rows_1 = prep["std_rows_1"]
    n = len(std_rows_1)
    if row_hi is None:
        row_hi = n
    if not (0 <= row_lo <= row_hi <= n):
        raise ValueError(f"invalid shard range [{row_lo}, {row_hi}) for {n} target rows")

    std_slice = std_rows_1[row_lo:row_hi]
    t = len(std_slice)
    res = match_all(
        std_slice, prep["std_rows_2"], threshold=threshold,
        top_k=top_k, hist_bins=hist_bins,
        chunk_size=32, progress_cb=progress_cb,
    )
    contributions = _shard_contributions(std_slice, prep["std_rows_2"], res["best_index"])
    top_k_lists = res.get("top_k", [[] for _ in range(t)])
    histograms = res.get("histograms", [([], []) for _ in range(t)])

    def _num_or_none(x):
        return None if not np.isfinite(x) else float(x)

    return {
        "row_lo": int(row_lo),
        "row_hi": int(row_hi),
        "best_index": [int(v) for v in res["best_index"]],
        "best_distance": [_num_or_none(v) for v in res["best_distance"]],
        "second_distance": [_num_or_none(v) for v in res["second_distance"]],
        "repeats": [int(v) for v in res["repeats"]],
        "nndr": [float(v) for v in res["nndr"]],
        "near_miss": [int(v) for v in res["near_miss"]],
        "col_min": [_num_or_none(v) for v in res["col_min"]],
        "top_k": top_k_lists,
        "histograms": [[list(c), list(e)] for c, e in histograms],
        "contributions": [[float(c) for c in row] for row in contributions],
    }


def match_shard(
    target_csv,
    supplemental_csv,
    links=None,
    exclude=None,
    threshold=0.8,
    row_lo=0,
    row_hi=None,
    top_k=50,
    hist_bins=30,
    progress_cb=None,
):
    """
    Matches target rows [row_lo, row_hi) against the FULL supplemental set.

    Returns a plain dict of lists (JSON-serializable, so shard results can
    round-trip through postMessage between workers):
        row_lo/row_hi, and per shard-row: best_index (-1 = no match),
        best_distance (None = no match), second_distance (None when absent),
        repeats, nndr, near_miss, top_k (ascending lists), histograms
        ([counts, edges] pairs), contributions; plus col_min — this shard's
        per-supplemental-row minimum, merged globally by assemble_results
        for the MNN check.
    """
    prep = _prepare(target_csv, supplemental_csv, links, exclude)
    return _match_shard_prepared(prep, threshold, row_lo, row_hi, top_k, hist_bins, progress_cb)


def assemble_results(
    target_csv,
    supplemental_csv,
    shards,
    links=None,
    exclude=None,
    threshold=0.8,
):
    """
    Merges shard outputs (any order; ranges must tile [0, N) exactly) and
    assembles the full result dict — dataset-level SMD, global MNN
    confirmation from the merged column minima, flags, linked/detail rows,
    per-target diagnostics, and the run summary.
    """
    prep = _prepare(target_csv, supplemental_csv, links, exclude)
    return _assemble_prepared(prep, shards, threshold)


def _assemble_prepared(prep, shards, threshold):
    h1, rs1, h2, rs2 = prep["h1"], prep["rs1"], prep["h2"], prep["rs2"]
    common, feature_names = prep["common"], prep["feature_names"]
    target_missing, supp_missing = prep["target_missing"], prep["supp_missing"]
    warnings = prep["warnings"]
    std_rows_1, std_rows_2 = prep["std_rows_1"], prep["std_rows_2"]

    n_target = len(std_rows_1)
    m = len(std_rows_2)

    shards = sorted((dict(s) for s in shards), key=lambda s: s["row_lo"])
    covered = [(s["row_lo"], s["row_hi"]) for s in shards]
    expected_lo = 0
    for lo, hi in covered:
        if lo != expected_lo:
            raise ValueError(f"shard ranges do not tile the target rows: {covered}")
        expected_lo = hi
    if expected_lo != n_target:
        raise ValueError(f"shard ranges do not cover all {n_target} target rows: {covered}")

    def _cat(key):
        out = []
        for s in shards:
            out.extend(s[key])
        return out

    best_index = np.asarray(_cat("best_index"), dtype=np.int64)
    best_distance = np.asarray(
        [np.inf if v is None else v for v in _cat("best_distance")], dtype=float
    )
    second_distance = _cat("second_distance")
    repeats = _cat("repeats")
    nndr = _cat("nndr")
    near_miss = _cat("near_miss")
    top_k_lists = _cat("top_k")
    histograms = _cat("histograms")
    contributions = _cat("contributions")

    # Global MNN: merge each shard's per-supplemental-row minimum, then a
    # match is confirmed when its distance equals the global minimum —
    # identical to what match_all computes unsharded.
    col_min = np.full(m, np.inf)
    for s in shards:
        partial = np.asarray(
            [np.inf if v is None else v for v in s["col_min"]], dtype=float
        )
        if partial.shape[0] != m:
            raise ValueError("shard col_min length does not match the supplemental set")
        np.minimum(col_min, partial, out=col_min)
    matched_mask = best_index >= 0
    confirmed = np.zeros(n_target, dtype=bool)
    confirmed[matched_mask] = (
        best_distance[matched_mask] == col_min[best_index[matched_mask]]
    )

    # Dataset-level SMD — computed across validly matched pairs only
    if matched_mask.any():
        smd = dataset_smd(
            np.asarray(std_rows_1)[matched_mask],
            best_index[matched_mask],
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

        j = int(best_index[i])
        row_repeats = int(repeats[i])
        nndr_val = float(nndr[i])
        row_near_miss = int(near_miss[i])
        row_confirmed = bool(confirmed[i])
        row_contributions = contributions[i]
        flags = build_flags(
            nndr_val, row_near_miss, threshold, row_repeats, smd, feature_names,
            mnn_confirmed=row_confirmed,
            target_missing=target_missing[i],
            match_missing=supp_missing[j],
        )

        row_best = float(best_distance[i])
        second = second_distance[i]
        row_second = float(second) if second is not None else float("nan")

        linked_rows.append(
            row_merge(rs1[i], rs2[j], common)
            + [row_best, row_repeats, round(nndr_val, 4), row_near_miss,
               int(row_confirmed), flags]
        )
        detail_rows.append(
            [i, row_best, round(nndr_val, 4), row_near_miss, int(row_confirmed),
             target_missing[i], supp_missing[j]]
            + [round(float(c), 6) for c in row_contributions]
            + [flags]
        )

        hist_counts, hist_edges = histograms[i]

        per_target.append({
            "target_idx": int(i),
            "match_idx": j,
            "no_match": False,
            "best_distance": row_best,
            "second_distance": row_second,
            "nndr": nndr_val,
            "near_miss": row_near_miss,
            "mnn_confirmed": row_confirmed,
            "repeats": row_repeats,
            "target_missing": int(target_missing[i]),
            "match_missing": int(supp_missing[j]),
            "contributions": [float(c) for c in row_contributions],
            "flags": flags,
            "hist_counts": list(hist_counts),
            "hist_edges": list(hist_edges),
            "top_k_distances": list(top_k_lists[i]),
        })

        if flags:
            flagged_count += 1
        if row_confirmed:
            mnn_confirmed_count += 1
        nndr_sum += nndr_val
        best_distance_sum += row_best

    n_matched = n_target - no_match_count
    summary = {
        "total": n_target,
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
    Browser-facing single-worker entry point: one full-range shard plus
    assembly. The worker-pool path calls match_shard / assemble_results
    directly. Arguments and the returned dict are unchanged from the
    original API (see assemble_results).
    """
    def _match_progress(frac):
        if progress_cb is None:
            return
        try:
            progress_cb(0.95 * frac)  # reserve the tail for assembly
        except Exception:
            pass

    prep = _prepare(target_csv, supplemental_csv, links, exclude)
    shard = _match_shard_prepared(
        prep, threshold, 0, None, top_k, hist_bins, _match_progress,
    )
    result = _assemble_prepared(prep, [shard], threshold)
    if progress_cb is not None:
        try:
            progress_cb(1.0)
        except Exception:
            pass
    return result
