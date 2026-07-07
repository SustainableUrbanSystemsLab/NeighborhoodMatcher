# Exact Match scenario.
# The target row is inserted verbatim as the 20th supplemental row.
# Expected result: euc_distance=0, nndr=0, near_miss_count=0,
#                  mnn_confirmed=True, repeats=1, flags="".

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

SCENARIO_TITLE    = "Scenario 1: The Exact Match"
SCENARIO_SUBTITLE = "What happens when the target row exists verbatim in the supplemental dataset"
SCENARIO_LABEL    = "exact_match"

DESCRIPTION = (
    "This scenario asks a simple question: what does the system report "
    "when there is a perfect match --- a supplemental row that is completely "
    "identical to the target in every feature? "
    "This is the best possible outcome and serves as our baseline. "
    "All signals should be at their ideal values: zero distance, zero ambiguity, "
    "and a confirmed symmetric match. "
    "If any signal were to fire under these conditions, something would be wrong with the system."
)


def _fmt(val, col):
    """Format a raw value for display using the column's format spec."""
    if col["fmt"] == "d":
        return f"{int(round(val)):,}"
    return f"{val:{col['fmt']}}"


def build_scenario():
    # Append exact copy of target as the 20th supplemental row
    supplemental = np.vstack([SUPP_BASE, TARGET.copy()])
    n_supp = len(supplemental)

    target_2d = TARGET.reshape(1, -1).tolist()
    supp_list  = supplemental.tolist()

    # --- Standardize jointly ---
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

    # --- Compute combined stats for the worked example (replicates dual_standardize) ---
    combined = np.vstack([std_t, std_s])  # already standardized
    # We want raw means/stds for the explanation, so recompute from raw values
    raw_combined = np.vstack([TARGET.reshape(1, -1), supplemental])
    raw_means = np.mean(raw_combined, axis=0)
    raw_stds  = np.std(raw_combined, axis=0)
    raw_stds[raw_stds == 0] = 1

    # Second-closest row is the example for the worked distance calculation
    # sorted_dists[0] == 0 (exact match); index 1 is the next closest
    # We need to find which original supplemental index is rank-2
    all_dists = np.array([
        np.sqrt(np.sum((std_t[0] - std_s[i]) ** 2)) for i in range(n_supp)
    ])
    order = np.argsort(all_dists, kind="stable")
    example_supp_orig_idx = int(order[1])  # rank-2 supplemental row (original index)
    example_raw = supplemental[example_supp_orig_idx]

    z_target  = (TARGET        - raw_means) / raw_stds
    z_example = (example_raw   - raw_means) / raw_stds
    sq_diffs  = (z_target - z_example) ** 2
    example_distance = float(np.sqrt(np.sum(sq_diffs)))

    # --- Build supplemental display table (sorted by distance, rank 1..20) ---
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

    # --- Signal explanations (plain English, specific to this scenario) ---
    signal_explanations = {
        "per_feature_contribution": (
            "Because the distance is exactly 0, no feature contributed anything --- "
            "all values are identical between the target and the matched row. "
            "The table shows n/a for all features."
        ),
        "euc_distance": (
            f"The distance between the target and its best match is exactly "
            f"\\textbf{{0.0000}}. This means the two rows are identical in every "
            f"feature --- a perfect match."
        ),
        "nndr": (
            "The Nearest Neighbor Distance Ratio (NNDR) compares the best match "
            "distance to the second-best match distance: $d_1 / d_2$. "
            "Because $d_1 = 0$, the ratio is $0 \\div \\text{anything} = 0$. "
            "A value of \\textbf{0.0000} is the best possible score --- no ambiguity whatsoever. "
            "No flag raised (threshold is 0.80)."
        ),
        "near_miss_count": (
            "The near-miss count checks how many supplemental rows have a ratio "
            "$d_1 / d_i \\geq 0.80$. Since $d_1 = 0$, every ratio is "
            "$0 \\div d_i = 0$, well below the threshold. "
            "\\textbf{0 near misses.} No flag raised."
        ),
        "mnn_confirmed": (
            "Mutual Nearest Neighbor (MNN) confirmation runs the search in reverse: "
            "does the matched supplemental row also point back to this target as its "
            "nearest neighbor? Since the matched row is an exact copy of the target, "
            "of course it does. \\textbf{Confirmed: True.} "
            "This symmetry is a strong indicator of match quality."
        ),
        "repeats": (
            "Only \\textbf{one} supplemental row matched at distance 0 --- the exact "
            "copy we inserted. If a second identical row had been present, repeats "
            "would be 2 and the tie flag would fire."
        ),
        "smd": (
            "The Standardized Mean Difference (SMD) measures whether the distribution "
            "of the target dataset is systematically misaligned with its matches. "
            "With only \\textbf{one target row}, there is no distribution to measure --- "
            "SMD is undefined and reported as 0 for all features. "
            "In a real research run with many target rows, this signal would flag "
            "any feature that is consistently off across all matches."
        ),
        "flags": (
            "\\textbf{No flags raised.} This is the ideal outcome: perfect match, "
            "zero ambiguity, no ties, and a symmetric confirmation. "
            "Any well-functioning match on a row that exists verbatim in the "
            "supplemental dataset should produce this result."
        ),
    }

    return {
        "scenario_title":    SCENARIO_TITLE,
        "scenario_subtitle": SCENARIO_SUBTITLE,
        "scenario_label":    SCENARIO_LABEL,
        "description":       DESCRIPTION,
        "columns":           COLUMNS,
        "display_names":     DISPLAY_NAMES,
        "target_raw":        TARGET,
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
            "euc_distance":    float(sorted_dists[0]),
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