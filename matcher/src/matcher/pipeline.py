import os
import sys

import numpy as np

from .ablation import ablation_sample_indices, ablation_suite
from .about import TOOL_NAME, VERSION, authors_line, provenance_rows
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
    variable_report,
    variable_warnings,
    validate_min_confidence,
    _TIERS_WITHHELD,
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
                fast=False, max_distance=None, min_confidence=None, ablation=False):
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
    min_confidence : optional reporting filter ("medium" or "high"). A row
                   whose confidence tier falls below the minimum keeps its
                   diagnostics in the detail file, but the linked row is
                   written unlinked (blank supplemental cells, no fill) with
                   a "link withheld" flag. Purely a reporting filter: it
                   never changes which matches are found, the SMD, or any
                   other row. None (default) reports everything — unchanged
                   behaviour.
    ablation     : when True, additionally re-matches with each linked
                   variable left out (deterministically subsampling targets
                   above a compute budget), prints a per-variable quality
                   table, and writes <output_base>_ablation.csv — flags
                   variables whose removal IMPROVES linkage quality as
                   candidates for exclusion. Needs at least two linked
                   variables. See matcher.ablation / docs/signals/ablation.md.

    Returns the list of dataset-level warnings emitted for this run
    (scale/definition/header warnings, also printed to stderr).
    """
    if exclude is None:
        exclude = []
    validate_threshold(threshold)
    validate_max_distance(max_distance)
    min_confidence = validate_min_confidence(min_confidence)

    # Refuse to clobber an input, and fail on a bad output location BEFORE
    # minutes of matching compute (a raw FileNotFoundError used to surface
    # only at write time).
    base, ext = os.path.splitext(output)
    detail_output = f"{base}_detail{ext}"
    variables_output = f"{base}_variables{ext}"
    ablation_output = f"{base}_ablation{ext}"
    run_info_output = f"{base}_run_info{ext}"
    for out_path in (output, detail_output, variables_output, ablation_output,
                     run_info_output):
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

    print(f"{TOOL_NAME} {VERSION} — {authors_line()}", file=sys.stderr)

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

    # Per-variable input diagnostics (missingness, definition-shift check) —
    # computed on raw parsed values, before standardization can absorb a
    # systematic between-file offset. Written to <base>_variables.csv below.
    variable_rows = variable_report(filtered_rs1, filtered_rs2, feature_names)
    warnings += variable_warnings(variable_rows)

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
    # Per-variable share of the run's total match distance, accumulated over
    # accepted rows (contributions are proportions of d1², so contrib · d1²
    # recovers absolute squared contributions exactly).
    share_num = np.zeros(n_features)
    share_total_sq = 0.0
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

        tier = confidence_tier(
            False, False, nndr_val, threshold, repeats,
            confirmed, near_miss, row_features_used, n_features,
        )
        withheld = (min_confidence is not None
                    and tier in _TIERS_WITHHELD[min_confidence])
        flags = build_flags(
            nndr_val, near_miss, threshold, repeats, smd, feature_names,
            mnn_confirmed=confirmed,
            target_missing=target_missing[i],
            match_missing=supp_missing[j],
            withheld=withheld, tier=tier, min_tier=min_confidence,
        )

        # The reporting filter must not feed back into run-level statistics:
        # withheld rows still count toward distance_share exactly as they
        # would with the filter off.
        share_num += contributions * (dist * dist)
        share_total_sq += dist * dist

        if withheld:
            # Linked row goes out unlinked (no supplemental cells, no fill);
            # the detail row keeps the full diagnostics of the nearest row.
            linked_rows.append(
                row_merge(rs1[i], blank_supp_row, common)
                + ["", 0, "", 0, 0, 0, "", "", f"{tier} (withheld)", flags]
            )
            detail_rows.append(
                [i, dist, round(nndr_val, 4), near_miss, int(confirmed),
                 target_missing[i], supp_missing[j], row_features_used, int(row_exact)]
                + [round(float(c), 6) for c in contributions]
                + [f"{tier} (withheld)", flags]
            )
            continue

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

    # Write per-variable diagnostics
    if share_total_sq > 0:
        distance_share = share_num / share_total_sq
    else:
        distance_share = np.zeros(n_features)
    for v, s in zip(variable_rows, distance_share):
        v["distance_share"] = float(s)

    def _fmt(value):
        return "" if value is None else round(float(value), 6)

    dump_csv(
        variables_output,
        ["feature", "target_missing_pct", "supp_missing_pct", "offset_smd",
         "spread_ratio", "distance_share", "notes"],
        [
            [v["feature"], _fmt(v["target_missing_pct"]), _fmt(v["supp_missing_pct"]),
             _fmt(v["offset_smd"]), _fmt(v["spread_ratio"]),
             _fmt(v["distance_share"]), v["notes"]]
            for v in variable_rows
        ],
    )

    # Write run provenance — who made the tool, which version processed this
    # data, when, and the settings in force, so a results folder is still
    # self-describing months later.
    dump_csv(
        run_info_output,
        ["key", "value"],
        [list(row) for row in provenance_rows(extra=[
            ("target_file", os.path.basename(target)),
            ("supplemental_file", os.path.basename(supplemental)),
            ("target_rows", len(rs1)),
            ("supplemental_rows", len(rs2)),
            ("matching_variables", "; ".join(feature_names)),
            ("nndr_threshold", threshold),
            ("max_distance_cutoff", "off" if max_distance is None else max_distance),
            ("min_confidence_filter", min_confidence or "off"),
            ("variable_ablation", "on" if ablation else "off"),
            ("fast_engine", "on" if fast else "off"),
        ])],
    )

    if ablation:
        if n_features < 2:
            print(
                "WARNING: ablation skipped — needs at least two linked "
                "variables (removing the only one would leave nothing to "
                "match on)",
                file=sys.stderr,
            )
        else:
            _run_ablation(std_rows_1, std_rows_2, feature_names, threshold,
                          ablation_output)

    return warnings


def _run_ablation(std_rows_1, std_rows_2, feature_names, threshold, out_path):
    """
    Leave-one-variable-out pass for the CLI: reuses the already-standardized
    arrays (column re-slicing == fresh run with the link excluded), prints a
    per-variable quality table to stdout, writes <base>_ablation.csv.
    """
    sample_indices, sampled = ablation_sample_indices(
        len(std_rows_1), len(std_rows_2), len(feature_names)
    )
    report = ablation_suite(
        std_rows_1, std_rows_2, feature_names, threshold,
        sample_indices=sample_indices,
    )

    baseline = report["baseline"]
    scope = (
        f"sampled {report['sample_size']} of {report['n_targets']} target rows"
        if report["sampled"] else f"all {report['n_targets']} target rows"
    )
    print(f"\nVariable ablation ({scope}; baseline "
          f"MNN-confirmed {baseline['mnn_confirmed_pct']:.1f}%, "
          f"High confidence {baseline['high_pct']:.1f}%):")

    name_width = max(len("feature"), *(len(n) for n in feature_names))
    header = (f"  {'feature'.ljust(name_width)}  {'ΔMNN pts':>9}  "
              f"{'ΔHigh pts':>9}  {'NNDR w/o':>9}  verdict")
    print(header)
    csv_rows = []
    for var in report["variables"]:
        m = var["metrics"]
        median_nndr = m["median_nndr"]
        print(f"  {var['feature'].ljust(name_width)}  "
              f"{var['delta_mnn_pct']:>+9.1f}  {var['delta_high_pct']:>+9.1f}  "
              f"{(f'{median_nndr:.3f}' if median_nndr is not None else '—'):>9}  "
              f"{var['verdict']}")
        csv_rows.append([
            var["feature"], report["sample_size"], int(report["sampled"]),
            round(baseline["mnn_confirmed_pct"], 2),
            round(m["mnn_confirmed_pct"], 2), round(var["delta_mnn_pct"], 2),
            round(baseline["high_pct"], 2),
            round(m["high_pct"], 2), round(var["delta_high_pct"], 2),
            ("" if median_nndr is None else round(median_nndr, 4)),
            m["no_match"], var["verdict"],
        ])

    flagged = [v["feature"] for v in report["variables"]
               if v["verdict"] == "consider_excluding"]
    if flagged:
        print(
            f"  → linkage quality improves without: {', '.join(flagged)} — "
            f"consider excluding (exclude=[...]) and re-running"
        )

    dump_csv(
        out_path,
        ["feature", "sample_size", "sampled", "baseline_mnn_pct",
         "mnn_pct_without", "delta_mnn_pct", "baseline_high_pct",
         "high_pct_without", "delta_high_pct", "median_nndr_without",
         "no_match_without", "verdict"],
        csv_rows,
    )
    return report
