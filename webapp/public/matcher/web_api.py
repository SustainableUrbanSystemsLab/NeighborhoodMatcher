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

from .about import provenance
from .ablation import (
    ABLATION_VERSION,
    ablation_sample_indices,
    build_recommendations,
    variant_metrics,
)
from .align import find_common_headers, header_warnings, no_shared_columns_error
from .standardize import dual_standardize, scale_compatibility_warnings
from .distance import (
    MISSING_PENALTY,
    match_all,
    validate_threshold,
    validate_max_distance,
    winner_observed_stats,
)
from .merge import row_merge, new_header
from .pipeline import extract_features, missing_counts
from .signals import (
    dataset_smd,
    build_flags,
    confidence_tier,
    variable_report,
    variable_warnings,
    validate_min_confidence,
    _TIERS_WITHHELD,
)


def _parse_csv_string(csv_str, file_label):
    reader = csv.reader(_io.StringIO(csv_str.lstrip("﻿")))
    data = list(reader)
    if not data:
        raise ValueError(f"{file_label}: file is empty (no header row)")
    headers, raw_rows = data[0], data[1:]
    rows = []
    line_numbers = []
    for i, row in enumerate(raw_rows):
        if not row:  # blank line — skip, matching io.load_csv
            continue
        if len(row) != len(headers):
            raise ValueError(
                f"{file_label}: line {i + 2} has {len(row)} cells, "
                f"expected {len(headers)} (matching the header)"
            )
        rows.append(row)
        line_numbers.append(i + 2)
    return headers, rows, line_numbers


def _validate_links(links, n_target_cols, n_supp_cols):
    """
    The explicit-links path bypasses find_common_headers, so it needs its
    own guards: two links sharing a name or a column index would silently
    double-weight one column or link the wrong one (last-wins), and an
    out-of-range or NEGATIVE index would either crash deep in extraction or
    — worse — silently index from the end of the row (JS indexOf() returns
    -1 for 'not found', the exact value a frontend regression would send).
    """
    problems = []

    for link in links:
        name = str(link["headerName"]).strip()
        i1, i2 = link["header1Index"], link["header2Index"]
        if not name:
            problems.append("a link has an empty column name")
        for label, idx, n_cols in (
            ("header1Index", i1, n_target_cols),
            ("header2Index", i2, n_supp_cols),
        ):
            if not float(idx).is_integer():
                problems.append(f"{label} {idx!r} for '{name}' is not an integer")
            elif not 0 <= int(idx) < n_cols:
                problems.append(
                    f"{label} {int(idx)} for '{name}' is out of range "
                    f"(file has {n_cols} columns)"
                )

    names = [l["headerName"] for l in links]
    t_idx = [l["header1Index"] for l in links]
    s_idx = [l["header2Index"] for l in links]
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

    NOTE: `exclude` applies only when `links is None` (auto-detection);
    explicit links are authoritative and bypass it.
    """
    if exclude is None:
        exclude = []

    h1, rs1, lines1 = _parse_csv_string(target_csv, "target file")
    h2, rs2, lines2 = _parse_csv_string(supplemental_csv, "supplemental file")

    if links is None:
        common = find_common_headers(h1, h2, exclude)
    else:
        _validate_links(list(links), len(h1), len(h2))
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
        raise no_shared_columns_error(h1, h2)
    if not rs1:
        raise ValueError("Target dataset has no rows.")
    if not rs2:
        raise ValueError("Supplemental dataset has no rows.")

    # Missing cells -> None -> NaN; never imputed — distances mask missing
    # dimensions instead (see pipeline.coordinator, same behaviour).
    filtered_rs1 = extract_features(rs1, common, "header1Index", "target file", lines1)
    filtered_rs2 = extract_features(rs2, common, "header2Index", "supplemental file", lines2)

    target_missing = missing_counts(filtered_rs1)
    supp_missing = missing_counts(filtered_rs2)

    warnings = scale_compatibility_warnings(filtered_rs1, filtered_rs2, feature_names)
    warnings += header_warnings(h1, h2, feature_names)

    # Per-variable input diagnostics (missingness, definition-shift check).
    # Computed on the raw parsed values, before standardization can absorb a
    # systematic between-file offset.
    variables = variable_report(filtered_rs1, filtered_rs2, feature_names)
    warnings += variable_warnings(variables)

    std_rows_1, std_rows_2 = dual_standardize(filtered_rs1, filtered_rs2)

    return {
        "h1": h1, "rs1": rs1, "h2": h2, "rs2": rs2,
        "common": common, "feature_names": feature_names,
        "target_missing": target_missing, "supp_missing": supp_missing,
        "warnings": warnings,
        "variable_report": variables,
        "std_rows_1": std_rows_1, "std_rows_2": std_rows_2,
        # Parsed per-feature values (None = missing) — the emit loop needs
        # them to decide which target cells to fill from the matched row.
        "filtered_rs1": filtered_rs1, "filtered_rs2": filtered_rs2,
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


# Bumped whenever the shard payload shape changes so assembly can reject
# shards produced by an older engine (e.g. a worker that predates a redeploy).
SHARD_VERSION = 2


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
    features_used, exact_on_observed = winner_observed_stats(
        std_slice, prep["std_rows_2"], res["best_index"]
    )
    top_k_lists = res.get("top_k", [[] for _ in range(t)])
    histograms = res.get("histograms", [([], []) for _ in range(t)])

    def _num_or_none(x):
        return None if not np.isfinite(x) else float(x)

    return {
        "row_lo": int(row_lo),
        "row_hi": int(row_hi),
        "shard_version": SHARD_VERSION,
        # Recorded so assembly can refuse to mix shards computed under a
        # different threshold (nndr/near_miss would disagree with the flags).
        "threshold": float(threshold),
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
        "features_used": [int(v) for v in features_used],
        "exact_on_observed": [bool(v) for v in exact_on_observed],
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
    validate_threshold(threshold)
    prep = _prepare(target_csv, supplemental_csv, links, exclude)
    return _match_shard_prepared(prep, threshold, row_lo, row_hi, top_k, hist_bins, progress_cb)


def assemble_results(
    target_csv,
    supplemental_csv,
    shards,
    links=None,
    exclude=None,
    threshold=0.8,
    max_distance=None,
    min_confidence=None,
):
    """
    Merges shard outputs (any order; ranges must tile [0, N) exactly) and
    assembles the full result dict — dataset-level SMD, global MNN
    confirmation from the merged column minima, flags, linked/detail rows,
    per-target diagnostics, and the run summary.

    max_distance: optional cutoff in per-feature z-units. A match whose
    best_distance / sqrt(features_used) exceeds it is rejected (routed to
    the no-match path, diagnostics preserved). Applied here, at assembly —
    shards are cutoff-agnostic, so no per-shard consistency field is needed.

    min_confidence: optional reporting filter ("medium" or "high"). Rows
    whose confidence tier falls below it are written unlinked with a
    "link withheld" flag while keeping full diagnostics; nothing else in
    the run changes. Also assembly-stage — shards are filter-agnostic.
    """
    validate_threshold(threshold)
    validate_max_distance(max_distance)
    min_confidence = validate_min_confidence(min_confidence)
    prep = _prepare(target_csv, supplemental_csv, links, exclude)
    return _assemble_prepared(prep, shards, threshold, max_distance, min_confidence)


def _assemble_prepared(prep, shards, threshold, max_distance=None, min_confidence=None):
    h1, rs1, h2, rs2 = prep["h1"], prep["rs1"], prep["h2"], prep["rs2"]
    common, feature_names = prep["common"], prep["feature_names"]
    target_missing, supp_missing = prep["target_missing"], prep["supp_missing"]
    warnings = prep["warnings"]
    std_rows_1, std_rows_2 = prep["std_rows_1"], prep["std_rows_2"]
    filtered_rs1, filtered_rs2 = prep["filtered_rs1"], prep["filtered_rs2"]

    n_target = len(std_rows_1)
    m = len(std_rows_2)

    # Sort by (row_lo, row_hi): row_lo alone is not a total order when an
    # empty shard shares its row_lo with a real one — a pool larger than the
    # row count produces exactly that, and workers finish in any order.
    shards = sorted((dict(s) for s in shards), key=lambda s: (s["row_lo"], s["row_hi"]))
    covered = [(s["row_lo"], s["row_hi"]) for s in shards]
    expected_lo = 0
    for lo, hi in covered:
        if lo != expected_lo:
            raise ValueError(f"shard ranges do not tile the target rows: {covered}")
        expected_lo = hi
    if expected_lo != n_target:
        raise ValueError(f"shard ranges do not cover all {n_target} target rows: {covered}")

    per_row_keys = ("best_index", "best_distance", "second_distance",
                    "repeats", "nndr", "near_miss", "top_k", "histograms",
                    "contributions", "features_used", "exact_on_observed")
    for s in shards:
        shard_version = s.get("shard_version")
        if shard_version != SHARD_VERSION:
            raise ValueError(
                f"shard [{s['row_lo']}, {s['row_hi']}) was produced by an "
                f"older engine version ({shard_version!r}, expected "
                f"{SHARD_VERSION}) — recompute the shards"
            )
        n_rows = s["row_hi"] - s["row_lo"]
        for key in per_row_keys:
            if len(s[key]) != n_rows:
                raise ValueError(
                    f"shard [{s['row_lo']}, {s['row_hi']}) has {len(s[key])} "
                    f"'{key}' entries, expected {n_rows} — truncated or "
                    f"corrupted shard payload"
                )
        shard_threshold = s.get("threshold")
        if shard_threshold is not None and shard_threshold != threshold:
            raise ValueError(
                f"shard [{s['row_lo']}, {s['row_hi']}) was computed at "
                f"threshold {shard_threshold}, but assembly requested "
                f"{threshold} — recompute the shards"
            )

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
    features_used = _cat("features_used")
    exact_on_observed = _cat("exact_on_observed")

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

    # Optional max-distance cutoff (per-feature z-units): reject a match
    # whose distance, averaged over the features that actually contributed
    # (sqrt because distances add in quadrature), exceeds the cutoff. The
    # numerator still carries the missing-dim penalty, so heavily missing
    # rows are rejected more aggressively — deliberate and conservative.
    rejected = np.zeros(n_target, dtype=bool)
    fu_arr = np.asarray(features_used, dtype=float)
    if max_distance is not None:
        with np.errstate(invalid="ignore"):
            per_feature_dist = best_distance / np.sqrt(np.maximum(fu_arr, 1.0))
        rejected = matched_mask & (per_feature_dist > max_distance)
    accepted_mask = matched_mask & ~rejected

    # Dataset-level SMD — computed across accepted matched pairs only
    if accepted_mask.any():
        smd = dataset_smd(
            np.asarray(std_rows_1)[accepted_mask],
            best_index[accepted_mask],
            std_rows_2,
        )
    else:
        smd = np.zeros(len(feature_names))

    # Per-variable share of the run's total match distance. Contributions
    # are proportions of each row's squared distance, so contrib * d1²
    # recovers absolute squared contributions exactly; summing over accepted
    # rows answers "which variable drove the matching overall?". Copies the
    # prep report so shard/assembly reuse of prep stays side-effect free.
    variables = [dict(v) for v in prep["variable_report"]]
    n_feat = len(feature_names)
    if accepted_mask.any():
        contrib_arr = np.asarray(contributions, dtype=float)[accepted_mask]
        d1_sq = best_distance[accepted_mask] ** 2
        total_sq = float(d1_sq.sum())
        shares = (
            (contrib_arr * d1_sq[:, None]).sum(axis=0) / total_sq
            if total_sq > 0 else np.zeros(n_feat)
        )
    else:
        shares = np.zeros(n_feat)
    for v, s in zip(variables, shares):
        v["distance_share"] = float(s)

    linked_headers = (
        new_header(h1, h2, common)
        + ["euc_distance", "repeats", "nndr", "near_miss_count", "mnn_confirmed",
           "features_used", "exact_on_observed", "filled_from_match",
           "confidence", "flags"]
    )
    detail_headers = (
        ["target_index", "euc_distance", "nndr", "near_miss_count", "mnn_confirmed",
         "target_missing", "match_missing", "features_used", "exact_on_observed"]
        + [f"contrib_{name}" for name in feature_names]
        + ["confidence", "flags"]
    )

    n_features = len(feature_names)
    blank_supp_row = [""] * len(h2)
    linked_rows = []
    detail_rows = []
    per_target = []
    flagged_count = 0
    mnn_confirmed_count = 0
    no_match_count = 0
    rejected_count = 0
    withheld_count = 0
    tier_counts = {"High": 0, "Medium": 0, "Low": 0, "No match": 0}
    nndr_sum = 0.0
    best_distance_sum = 0.0

    for i in range(n_target):
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
            per_target.append({
                "target_idx": int(i),
                "match_idx": None,
                "nearest_idx": None,
                "no_match": True,
                "rejected": False,
                "withheld": False,
                "best_distance": None,
                "second_distance": None,
                "nndr": None,
                "near_miss": 0,
                "mnn_confirmed": False,
                "repeats": 0,
                "target_missing": int(target_missing[i]),
                "match_missing": None,
                "features_used": 0,
                "exact_on_observed": False,
                "filled_from_match": [],
                "confidence": tier,
                "contributions": [0.0 for _ in feature_names],
                "flags": flags,
                "hist_counts": [],
                "hist_edges": [],
                "top_k_distances": [],
            })
            flagged_count += 1
            no_match_count += 1
            tier_counts[tier] += 1
            continue

        j = int(best_index[i])
        row_repeats = int(repeats[i])
        nndr_val = float(nndr[i])
        row_near_miss = int(near_miss[i])
        row_confirmed = bool(confirmed[i])
        row_contributions = contributions[i]
        row_features_used = int(features_used[i])
        row_exact = bool(exact_on_observed[i])
        row_best = float(best_distance[i])
        second = second_distance[i]
        # Keep None (not NaN): the result must stay JSON-safe and match the
        # frontend's `number | null` contract — shards already encode
        # non-finite as None, and NaN breaks dict equality and JSON.
        row_second = float(second) if second is not None else None
        hist_counts, hist_edges = histograms[i]

        if rejected[i]:
            # Cutoff rejection: no accepted match, but keep the nearest
            # row's diagnostics so a researcher can see what was rejected
            # and why. The linked row stays blank like a no-match row.
            per_feat_dist = row_best / np.sqrt(max(row_features_used, 1))
            flags = build_flags(
                nndr_val, row_near_miss, threshold, row_repeats, smd, feature_names,
                target_missing=target_missing[i],
                rejected=True, rejected_distance=per_feat_dist, cutoff=max_distance,
            )
            tier = "No match"
            linked_rows.append(
                row_merge(rs1[i], blank_supp_row, common)
                + ["", 0, "", 0, 0, 0, "", "", tier, flags]
            )
            detail_rows.append(
                [i, row_best, round(nndr_val, 4), row_near_miss, int(row_confirmed),
                 target_missing[i], supp_missing[j], row_features_used, int(row_exact)]
                + [round(float(c), 6) for c in row_contributions]
                + [tier, flags]
            )
            per_target.append({
                "target_idx": int(i),
                "match_idx": None,
                "nearest_idx": j,
                "no_match": True,
                "rejected": True,
                "withheld": False,
                "best_distance": row_best,
                "second_distance": row_second,
                "nndr": nndr_val,
                "near_miss": row_near_miss,
                "mnn_confirmed": row_confirmed,
                "repeats": row_repeats,
                "target_missing": int(target_missing[i]),
                "match_missing": int(supp_missing[j]),
                "features_used": row_features_used,
                "exact_on_observed": row_exact,
                "filled_from_match": [],
                "confidence": tier,
                "contributions": [float(c) for c in row_contributions],
                "flags": flags,
                "hist_counts": list(hist_counts),
                "hist_edges": list(hist_edges),
                "top_k_distances": list(top_k_lists[i]),
            })
            flagged_count += 1
            no_match_count += 1
            rejected_count += 1
            tier_counts[tier] += 1
            continue

        tier = confidence_tier(
            False, False, nndr_val, threshold, row_repeats,
            row_confirmed, row_near_miss, row_features_used, n_features,
        )
        withheld = (min_confidence is not None
                    and tier in _TIERS_WITHHELD[min_confidence])
        flags = build_flags(
            nndr_val, row_near_miss, threshold, row_repeats, smd, feature_names,
            mnn_confirmed=row_confirmed,
            target_missing=target_missing[i],
            match_missing=supp_missing[j],
            withheld=withheld, tier=tier, min_tier=min_confidence,
        )

        if withheld:
            # Reporting filter only: the linked row goes out unlinked (blank
            # supplemental cells, no fill), while the detail row and
            # per_target keep the nearest row's full diagnostics. Every
            # run-level statistic below is incremented exactly as it would
            # be with the filter off.
            linked_rows.append(
                row_merge(rs1[i], blank_supp_row, common)
                + ["", 0, "", 0, 0, 0, "", "", f"{tier} (withheld)", flags]
            )
            detail_rows.append(
                [i, row_best, round(nndr_val, 4), row_near_miss, int(row_confirmed),
                 target_missing[i], supp_missing[j], row_features_used, int(row_exact)]
                + [round(float(c), 6) for c in row_contributions]
                + [f"{tier} (withheld)", flags]
            )
            per_target.append({
                "target_idx": int(i),
                "match_idx": None,
                "nearest_idx": j,
                "no_match": False,
                "rejected": False,
                "withheld": True,
                "best_distance": row_best,
                "second_distance": row_second,
                "nndr": nndr_val,
                "near_miss": row_near_miss,
                "mnn_confirmed": row_confirmed,
                "repeats": row_repeats,
                "target_missing": int(target_missing[i]),
                "match_missing": int(supp_missing[j]),
                "features_used": row_features_used,
                "exact_on_observed": row_exact,
                "filled_from_match": [],
                "confidence": tier,
                "contributions": [float(c) for c in row_contributions],
                "flags": flags,
                "hist_counts": list(hist_counts),
                "hist_edges": list(hist_edges),
                "top_k_distances": list(top_k_lists[i]),
            })
            flagged_count += 1
            withheld_count += 1
            if row_confirmed:
                mnn_confirmed_count += 1
            nndr_sum += nndr_val
            best_distance_sum += row_best
            tier_counts[tier] += 1
            continue

        # Fill missing target cells in shared columns from the matched row
        # (raw value verbatim) and record which columns were filled. This is
        # output completion only — matching itself never imputes.
        merged = row_merge(rs1[i], rs2[j], common)
        filled = []
        for k, c in enumerate(common):
            if filtered_rs1[i][k] is None and filtered_rs2[j][k] is not None:
                merged[c["header1Index"]] = rs2[j][c["header2Index"]]
                filled.append(c["headerName"])

        linked_rows.append(
            merged
            + [row_best, row_repeats, round(nndr_val, 4), row_near_miss,
               int(row_confirmed), row_features_used, int(row_exact),
               "; ".join(filled), tier, flags]
        )
        detail_rows.append(
            [i, row_best, round(nndr_val, 4), row_near_miss, int(row_confirmed),
             target_missing[i], supp_missing[j], row_features_used, int(row_exact)]
            + [round(float(c), 6) for c in row_contributions]
            + [tier, flags]
        )

        per_target.append({
            "target_idx": int(i),
            "match_idx": j,
            "nearest_idx": j,
            "no_match": False,
            "rejected": False,
            "withheld": False,
            "best_distance": row_best,
            "second_distance": row_second,
            "nndr": nndr_val,
            "near_miss": row_near_miss,
            "mnn_confirmed": row_confirmed,
            "repeats": row_repeats,
            "target_missing": int(target_missing[i]),
            "match_missing": int(supp_missing[j]),
            "features_used": row_features_used,
            "exact_on_observed": row_exact,
            "filled_from_match": filled,
            "confidence": tier,
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
        tier_counts[tier] += 1

    n_matched = n_target - no_match_count
    summary = {
        "total": n_target,
        "flagged": flagged_count,
        "mnn_confirmed": mnn_confirmed_count,
        "no_match": no_match_count,
        "rejected": rejected_count,
        "withheld": withheld_count,
        "max_distance": (float(max_distance) if max_distance is not None else None),
        "min_confidence": min_confidence,
        "tiers": tier_counts,
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
        # Identity of the engine that produced this result. Static: the
        # caller stamps the run time, because Pyodide's clock has no
        # timezone of its own and the browser's local time is the one a
        # researcher recognizes.
        "provenance": provenance(moment=False),
        "smd": [float(s) for s in smd],
        "threshold": float(threshold),
        "warnings": list(warnings),
        "variables": variables,
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
    max_distance=None,
    min_confidence=None,
):
    """
    Browser-facing single-worker entry point: one full-range shard plus
    assembly. The worker-pool path calls match_shard / assemble_results
    directly. Arguments and the returned dict are unchanged from the
    original API (see assemble_results).
    """
    validate_threshold(threshold)
    validate_max_distance(max_distance)
    min_confidence = validate_min_confidence(min_confidence)

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
    result = _assemble_prepared(prep, [shard], threshold, max_distance, min_confidence)
    if progress_cb is not None:
        try:
            progress_cb(1.0)
        except Exception:
            pass
    return result


def ablation_variant(
    target_csv,
    supplemental_csv,
    links=None,
    exclude=None,
    threshold=0.8,
    drop_index=None,
    progress_cb=None,
):
    """
    One leave-one-variable-out matching variant, for the worker pool: the
    frontend runs d+1 of these concurrently (drop_index None = baseline,
    then one per linked feature) and merges them with assemble_ablation.

    Every worker derives the SAME deterministic target sample from the
    dataset shape, so variant metrics are comparable without coordination.
    Returns a JSON-safe payload (round-trips through postMessage).
    """
    validate_threshold(threshold)
    prep = _prepare(target_csv, supplemental_csv, links, exclude)
    feature_names = prep["feature_names"]
    d = len(feature_names)
    if d < 2:
        raise ValueError(
            "ablation needs at least two linked variables — removing the "
            "only one would leave nothing to match on"
        )
    if drop_index is not None and not 0 <= int(drop_index) < d:
        raise ValueError(
            f"drop_index {drop_index} out of range for {d} linked features"
        )

    n_targets = len(prep["std_rows_1"])
    sample_indices, sampled = ablation_sample_indices(
        n_targets, len(prep["std_rows_2"]), d
    )
    metrics = variant_metrics(
        prep["std_rows_1"], prep["std_rows_2"], threshold,
        drop_index=(None if drop_index is None else int(drop_index)),
        sample_indices=sample_indices, progress_cb=progress_cb,
    )
    return {
        "ablation_version": ABLATION_VERSION,
        "drop_index": (None if drop_index is None else int(drop_index)),
        "drop_feature": (None if drop_index is None else feature_names[int(drop_index)]),
        "threshold": float(threshold),
        "sample_size": len(sample_indices),
        "sampled": bool(sampled),
        "n_targets": int(n_targets),
        "metrics": metrics,
    }


def assemble_ablation(variants, feature_names, threshold=0.8):
    """
    Merges ablation_variant payloads (any order) into the ablation report —
    same shape as ablation.ablation_suite returns. Pure function: no CSVs,
    no matching; safe to run on any worker.

    Validates that every payload came from the same engine version, the
    same threshold, and the same target sample, and that exactly one
    baseline plus one variant per feature is present.
    """
    validate_threshold(threshold)
    feature_names = list(feature_names)
    d = len(feature_names)
    variants = [dict(v) for v in variants]

    for v in variants:
        version = v.get("ablation_version")
        if version != ABLATION_VERSION:
            raise ValueError(
                f"ablation variant (drop_index {v.get('drop_index')!r}) was "
                f"produced by engine version {version!r}, expected "
                f"{ABLATION_VERSION} — recompute the variants"
            )
        if v.get("threshold") != threshold:
            raise ValueError(
                f"ablation variant (drop_index {v.get('drop_index')!r}) was "
                f"computed at threshold {v.get('threshold')}, but assembly "
                f"requested {threshold} — recompute the variants"
            )

    sizes = {(v["sample_size"], v["n_targets"]) for v in variants}
    if len(sizes) > 1:
        raise ValueError(
            f"ablation variants disagree on the target sample: {sorted(sizes)}"
        )

    baselines = [v for v in variants if v["drop_index"] is None]
    if len(baselines) != 1:
        raise ValueError(
            f"expected exactly one baseline variant, got {len(baselines)}"
        )
    [baseline] = baselines

    by_drop = {v["drop_index"]: v for v in variants if v["drop_index"] is not None}
    missing = [i for i in range(d) if i not in by_drop]
    extra = sorted(i for i in by_drop if not 0 <= i < d)
    if missing or extra or len(by_drop) != d:
        raise ValueError(
            f"ablation variants do not cover the {d} linked features exactly "
            f"(missing {missing}, unexpected {extra})"
        )

    return {
        "ablation_version": ABLATION_VERSION,
        "threshold": float(threshold),
        "sampled": bool(baseline["sampled"]),
        "sample_size": int(baseline["sample_size"]),
        "n_targets": int(baseline["n_targets"]),
        "baseline": baseline["metrics"],
        "variables": build_recommendations(
            baseline["metrics"],
            [by_drop[i]["metrics"] for i in range(d)],
            feature_names,
        ),
    }
