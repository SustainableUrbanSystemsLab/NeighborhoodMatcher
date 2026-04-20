# NOTE: Human authorized
#
# Rounding Discrepancy scenario.
#
# The target values are rounded to coarser precision than the supplemental:
#   dragon_sightings       : 2469  → 2500  (nearest 100)
#   avg_wizard_age         : 40.2  → 40    (nearest year)
#   pct_leprechaun_cottages: 99.5  → 100   (nearest whole %)
#   goblin_family_units    : 649   → 600   (nearest 100)
#
# Supplemental slot (row 19) = original unrounded values (2469, 40.2, 99.5, 649).
# The system should still select the correct row, but with a non-zero distance.

import sys
import os
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

from matcher.standardize import dual_standardize
from matcher.distance import compute_sorted_distances
from matcher.signals import (
    cascading_nndr,
    mnn_confirmed,
    per_row_feature_contribution,
    dataset_smd,
    build_flags,
)
from explanatory.base_pool import TARGET, SUPP_BASE, COLUMNS, DISPLAY_NAMES, SILLY_NAMES

SCENARIO_TITLE    = "Scenario 2: Rounding Discrepancy"
SCENARIO_SUBTITLE = "What happens when the target uses coarser precision than the supplemental dataset"
SCENARIO_LABEL    = "rounding_discrepancy"

DESCRIPTION = (
    "A common real-world problem: the same data appears at different levels of "
    "precision in different sources. Here the target dataset rounds population counts "
    "to the nearest 100, ages to the nearest year, and percentages to the nearest "
    "whole number. The supplemental dataset retains the original decimal precision. "
    "The two records describe the same real-world unit --- but because they report "
    "values at different precisions, the system cannot find an exact match. "
    "The correct row is still selected as the best match, but the distance is "
    "non-zero and the signals reveal the imprecision introduced by rounding."
)

ROUNDING_NOTE = (
    "The target values above have been rounded from their original precision. "
    "Original values: Dragon Sightings = 2{,}469; "
    "Avg.\\ Wizard Age = 40.2; "
    "Pct.\\ Leprechaun Cottages = 99.5; "
    "Goblin Family Units = 649. "
    "The supplemental dataset retains this original precision --- "
    "see rank~1 in the candidate table."
)

# Rounded target
TARGET_ROUNDED = np.array([2500.0, 40.0, 100.0, 600.0])

# Supplemental slot: original unrounded values of the target
SUPP_SLOT = TARGET.copy()


def _fmt(val, col):
    if col["fmt"] == "d":
        return f"{int(round(val)):,}"
    return f"{val:{col['fmt']}}"


def build_scenario():
    supplemental = np.vstack([SUPP_BASE, SUPP_SLOT])
    n_supp = len(supplemental)

    target_2d = TARGET_ROUNDED.reshape(1, -1).tolist()
    supp_list  = supplemental.tolist()

    # --- Standardize ---
    std_t, std_s = dual_standardize(target_2d, supp_list)
    std_t = np.array(std_t)
    std_s = np.array(std_s)

    # --- Match ---
    sorted_dists, best_idx, repeats = compute_sorted_distances(std_t[0], std_s)

    # --- Signals ---
    nndr_val, near_miss = cascading_nndr(sorted_dists)
    confirmed, _        = mnn_confirmed(0, best_idx, std_t, std_s)
    contributions       = per_row_feature_contribution(std_t[0], std_s[best_idx])
    smd                 = dataset_smd(std_t, [best_idx], std_s)
    flags               = build_flags(nndr_val, near_miss, 0.8, repeats, smd, SILLY_NAMES)

    # --- Raw stats for worked example ---
    raw_combined = np.vstack([TARGET_ROUNDED.reshape(1, -1), supplemental])
    raw_means = np.mean(raw_combined, axis=0)
    raw_stds  = np.std(raw_combined, axis=0)
    raw_stds[raw_stds == 0] = 1

    # Example: use second-closest row
    all_dists = np.array([
        np.sqrt(np.sum((std_t[0] - std_s[i]) ** 2)) for i in range(n_supp)
    ])
    order = np.argsort(all_dists, kind="stable")
    example_supp_orig_idx = int(order[1])
    example_raw = supplemental[example_supp_orig_idx]

    z_target  = (TARGET_ROUNDED - raw_means) / raw_stds
    z_example = (example_raw    - raw_means) / raw_stds
    sq_diffs  = (z_target - z_example) ** 2
    example_distance = float(np.sqrt(np.sum(sq_diffs)))

    # --- Sorted supplemental display table ---
    supp_table = []
    for rank, orig_idx in enumerate(order, start=1):
        raw_row = supplemental[orig_idx]
        dist    = float(all_dists[orig_idx])
        supp_table.append({
            "rank":    rank,
            "raw":     raw_row,
            "dist":    dist,
            "is_best": (rank == 1),
        })

    best_dist   = float(sorted_dists[0])
    second_dist = float(sorted_dists[1]) if len(sorted_dists) > 1 else None

    # --- Signal explanations ---
    signal_explanations = {
        "per_feature_contribution": (
            "Shows how much of the best-match distance each feature is responsible for. "
            "In a rounding scenario the contribution is spread across whichever features "
            "were rounded --- no single feature should dominate unless one was rounded "
            "far more aggressively than the others."
        ),
        "euc_distance": (
            f"The best match distance is \\textbf{{{best_dist:.4f}}} --- non-zero despite "
            f"the correct row existing in the supplemental dataset. "
            f"The gap comes entirely from rounding: the target reports rounded values "
            f"while the supplemental retains the original precision. "
            f"In the exact match scenario this was 0.0000; here the same underlying "
            f"record produces a small but real distance."
        ),
        "nndr": (
            f"NNDR = $d_1 / d_2$ = ${best_dist:.4f} \\div {second_dist:.4f}$ = "
            f"\\textbf{{{nndr_val:.4f}}}. "
            + (
                f"This is below the 0.80 threshold, so no ambiguity flag is raised --- "
                f"the system is still confident the best match is correct. "
                f"However, note that the NNDR is no longer 0.0000 as in the exact match: "
                f"rounding has brought the second-best candidate slightly closer relative "
                f"to the best match."
                if nndr_val < 0.8 else
                f"This meets or exceeds the 0.80 threshold --- an ambiguity flag is raised. "
                f"The rounding has made the best and second-best candidates difficult to "
                f"distinguish, which is a direct consequence of the precision loss."
            )
        ),
        "near_miss_count": (
            f"\\textbf{{{near_miss}}} supplemental row(s) fall within the near-miss "
            f"threshold ($d_1 / d_i \\geq 0.80$). "
            + (
                "Because the best-match distance is small but non-zero, "
                "the ratio $d_1 / d_i$ is also non-zero for all other rows --- "
                "the cascading check stops quickly and no near misses are counted."
                if near_miss == 0 else
                f"Rounding has compressed the distances between candidates, "
                f"bringing {near_miss} additional row(s) within the ambiguity band."
            )
        ),
        "mnn_confirmed": (
            ("\\textbf{Confirmed: True.} "
             "Running the search in reverse --- from the matched supplemental row back "
             "to the target --- still returns this target as the nearest record. "
             "Even with rounded target values, the match is symmetric."
             if confirmed else
             "\\textbf{Confirmed: False.} "
             "Running the search in reverse --- from the matched supplemental row back "
             "to the target --- does not return this target as the nearest record. "
             "The rounding has shifted the target far enough that, from the supplemental "
             "row's perspective, a different target row appears closer.")
        ),
        "repeats": (
            f"\\textbf{{{repeats}}} row(s) tied at the minimum distance. "
            + ("No tie." if repeats == 1 else
               "A tie exists --- two or more supplemental rows are equidistant "
               "from the rounded target. This can happen when rounding collapses "
               "distinct values to the same rounded level.")
        ),
        "smd": (
            "With only one target row, the SMD cannot be computed and is reported "
            "as 0 for all features. In a full run, systematic rounding of the target "
            "dataset would appear here as a consistent offset on the affected features."
        ),
        "flags": (
            f"\\textbf{{Flags: {_tex_escape(flags) if flags else '(none)'}}}. "
            + ("No flags raised. Despite the non-zero distance, the system is "
               "confident enough in the match that no warnings are triggered. "
               "The distance and NNDR are visible in the output for the researcher "
               "to inspect."
               if not flags else
               "One or more flags were raised. The rounding has introduced enough "
               "ambiguity that the system is flagging this match for researcher review.")
        ),
    }

    return {
        "scenario_title":    SCENARIO_TITLE,
        "scenario_subtitle": SCENARIO_SUBTITLE,
        "scenario_label":    SCENARIO_LABEL,
        "description":       DESCRIPTION,
        "rounding_note":     ROUNDING_NOTE,
        "columns":           COLUMNS,
        "display_names":     DISPLAY_NAMES,
        "target_raw":        TARGET_ROUNDED,
        "supp_table":        supp_table,
        "example": {
            "rank":       2,
            "raw":        example_raw,
            "raw_means":  raw_means,
            "raw_stds":   raw_stds,
            "z_target":   z_target,
            "z_example":  z_example,
            "sq_diffs":   sq_diffs,
            "distance":   example_distance,
        },
        "signals": {
            "contributions":    contributions,
            "euc_distance":    best_dist,
            "nndr":            round(nndr_val, 4),
            "near_miss_count": near_miss,
            "mnn_confirmed":   confirmed,
            "repeats":         repeats,
            "smd":             smd,
            "flags":           flags,
        },
        "signal_explanations": signal_explanations,
        "nndr_threshold":      0.8,
    }


def _tex_escape(s):
    replacements = {
        "&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#",
        "_": r"\_", "{": r"\{", "}": r"\}", "~": r"\textasciitilde{}",
        "^": r"\textasciicircum{}", "\\": r"\textbackslash{}",
    }
    return "".join(replacements.get(c, c) for c in s)
