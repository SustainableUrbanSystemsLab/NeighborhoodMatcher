# MNN Not Confirmed scenario.
#
# Mutual Nearest Neighbor (MNN) confirmation runs the match in reverse:
# does the selected supplemental row point back to this target as its nearest
# neighbor? With a single target row the answer is always yes (no other target
# to point to). To demonstrate a genuine MNN failure we need two target rows.
#
# TARGET_A = [2469, 40.2, 99.5, 649]  (the record being explained)
# TARGET_B = [2467, 40.6, 99.5, 649]  (an adjacent target record)
# SUPP_X   = [2468, 40.5, 99.5, 649]  (the 20th supplemental row)
#
# SUPP_X is the closest supplemental row to TARGET_A (all other candidates
# are far away), so the forward match selects it. But SUPP_X sits between
# TARGET_A and TARGET_B on wizard age — closer to TARGET_B. The reverse
# search therefore finds TARGET_B as SUPP_X's nearest target, not TARGET_A.
# mnn_confirmed returns False and a flag is raised.

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

SCENARIO_TITLE    = "Scenario 5: MNN Not Confirmed"
SCENARIO_SUBTITLE = "What happens when the matched row 'belongs' to a different target record"
SCENARIO_LABEL    = "mnn_not_confirmed"

DESCRIPTION = (
    "In a real research run the target dataset contains many records, not just one. "
    "Mutual Nearest Neighbor (MNN) confirmation guards against a specific failure: "
    "the forward search assigns a supplemental row to Target A, but from that "
    "supplemental row's perspective, Target B is actually closer. "
    "The match is asymmetric --- the supplemental row would prefer a different target. "
    "This scenario reproduces that condition with two target records. "
    "Target A is the record shown in the table below; Target B is an adjacent record "
    "with values \\textbf{[2{,}467, 40.6, 99.5\\%, 649]} --- almost identical but "
    "shifted 0.4 years upward on Avg.\\ Wizard Age. "
    "The inserted supplemental row (Rank~1 in the candidate table) sits between "
    "the two targets on that feature, closer to Target B. "
    "The forward match assigns it to Target A because it is still the nearest "
    "supplemental row available. The reverse search exposes the asymmetry."
)

ADJACENT_NOTE = (
    "This scenario uses \\textbf{two} target records to demonstrate MNN failure. "
    "Target A (shown above) has Avg.\\ Wizard Age = 40.2; "
    "Target B (not shown) has Avg.\\ Wizard Age = 40.6. "
    "The Rank~1 supplemental row has Avg.\\ Wizard Age = 40.5, "
    "placing it marginally closer to Target B on that feature."
)

TARGET_A = TARGET.copy()                         # [2469, 40.2, 99.5, 649]
TARGET_B = np.array([2467.0, 40.6, 99.5, 649.0])  # adjacent target

# 20th supplemental: between TARGET_A and TARGET_B on wizard age,
# closer to TARGET_B (40.5 vs. 40.6, vs. TARGET_A's 40.2).
SUPP_X = np.array([2468.0, 40.5, 99.5, 649.0])


def _tex_escape(s):
    replacements = {
        "&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#",
        "_": r"\_", "{": r"\{", "}": r"\}",
        "~": r"\textasciitilde{}", "^": r"\textasciicircum{}",
        "\\": r"\textbackslash{}",
    }
    return "".join(replacements.get(c, c) for c in s)


def build_scenario():
    supplemental = np.vstack([SUPP_BASE, SUPP_X])
    n_supp = len(supplemental)

    # Two target rows: TARGET_A (index 0) and TARGET_B (index 1).
    # Standardize jointly so both contribute to the combined mean/std.
    targets_raw = np.array([TARGET_A, TARGET_B])
    target_2d   = targets_raw.tolist()
    supp_list   = supplemental.tolist()

    std_t, std_s = dual_standardize(target_2d, supp_list)
    std_t = np.array(std_t)   # shape (2, 4)
    std_s = np.array(std_s)   # shape (20, 4)

    # Match TARGET_A (index 0) against all supplemental rows.
    sorted_dists, best_idx, repeats = compute_sorted_distances(std_t[0], std_s)

    # MNN: pass both target rows so the reverse search can find TARGET_B.
    nndr_val, near_miss = cascading_nndr(sorted_dists)
    confirmed, _        = mnn_confirmed(0, best_idx, std_t, std_s)
    contributions       = per_row_feature_contribution(std_t[0], std_s[best_idx])
    # SMD requires n >= 2 matched pairs; pass only TARGET_A's row to get zeros.
    smd   = dataset_smd(std_t[[0]], [best_idx], std_s)
    flags = build_flags(nndr_val, near_miss, 0.8, repeats, smd, SILLY_NAMES,
                        mnn_confirmed=confirmed)

    # --- Raw stats for worked example (use both target rows in combined pool) ---
    raw_combined = np.vstack([targets_raw, supplemental])
    raw_means = np.mean(raw_combined, axis=0)
    raw_stds  = np.std(raw_combined, axis=0)
    raw_stds[raw_stds == 0] = 1

    all_dists = np.array([
        np.sqrt(np.sum((std_t[0] - std_s[i]) ** 2)) for i in range(n_supp)
    ])
    order = np.argsort(all_dists, kind="stable")
    example_supp_orig_idx = int(order[1])
    example_raw = supplemental[example_supp_orig_idx]

    z_target  = (TARGET_A    - raw_means) / raw_stds
    z_example = (example_raw - raw_means) / raw_stds
    sq_diffs  = (z_target - z_example) ** 2
    example_distance = float(np.sqrt(np.sum(sq_diffs)))

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

    signal_explanations = {
        "per_feature_contribution": (
            "The Rank~1 supplemental row is extremely close to Target A on all features --- "
            "the total distance is tiny and the per-feature contributions reflect small "
            "differences spread across dimensions. The contribution table alone does not "
            "signal a problem. The MNN check below is what reveals the issue."
        ),
        "euc_distance": (
            f"The best-match distance is \\textbf{{{best_dist:.4f}}} --- very small, "
            f"indicating a close match. On its own this looks like a high-quality result. "
            f"The problem is not the distance but the direction: the selected row is "
            f"almost as close to Target B as it is to Target A."
        ),
        "nndr": (
            f"NNDR = $d_1 / d_2$ = ${best_dist:.4f} \\div {second_dist:.4f}$ = "
            f"\\textbf{{{nndr_val:.4f}}}. "
            + (
                f"This meets or exceeds the 0.80 threshold --- an ambiguity flag fires "
                f"in addition to the MNN failure."
                if nndr_val >= 0.8 else
                f"This is well below the 0.80 threshold. The selected supplemental row "
                f"is clearly the closest candidate --- there is no ambiguity about which "
                f"supplemental row wins. The MNN failure is a separate problem: "
                f"the issue is not which supplemental row was chosen but whether "
                f"this target should have claimed it."
            )
        ),
        "near_miss_count": (
            f"\\textbf{{{near_miss}}} supplemental row(s) fall within the near-miss "
            f"threshold. "
            + (
                "No near misses --- the selected row is clearly the closest supplemental "
                "candidate. This reinforces that the MNN failure here is not about "
                "supplemental ambiguity but about target competition."
                if near_miss == 0 else
                f"{near_miss} additional supplemental row(s) are nearly as close. "
                "The match is ambiguous on both axes: which supplemental row to use "
                "and which target row should claim it."
            )
        ),
        "mnn_confirmed": (
            ("\\textbf{Confirmed: True.} "
             "Unexpectedly, the reverse search still returns Target A as the nearest "
             "target to the matched supplemental row. Check the scenario design --- "
             "this should be False."
             if confirmed else
             "\\textbf{Confirmed: False.} "
             "This is the key signal for this scenario. "
             "Running the match in reverse --- from the selected supplemental row "
             "back across all target rows --- the nearest target is \\textbf{Target B}, "
             "not Target A. "
             "The supplemental row was assigned to Target A by the forward search, "
             "but from its own perspective it is closer to a different record. "
             "This asymmetry suggests Target A's match may have been 'stolen' from "
             "Target B, and the researcher should review both assignments before use.")
        ),
        "repeats": (
            f"\\textbf{{{repeats}}} row(s) tied at the minimum distance. "
            + ("No exact tie in the supplemental pool."
               if repeats == 1 else
               "An exact tie exists in the supplemental pool.")
        ),
        "smd": (
            "SMD is computed across all matched target--supplemental pairs in a full run. "
            "With only one target row being explained here, it is reported as 0. "
            "In a production run, widespread MNN failures would appear as elevated SMD "
            "on the features driving the competition between target records."
        ),
        "flags": (
            f"\\textbf{{Flags: \\texttt{{{_tex_escape(flags) if flags else '(none)'}}}}}. "
            + ("The MNN flag is the primary concern. "
               "The researcher should inspect both Target A and Target B alongside "
               "the Rank~1 supplemental row and decide which assignment is correct "
               "for their analysis. In many cases the right action is to leave "
               "Target A unmatched rather than assign it a row that belongs elsewhere."
               if flags else
               "No flags raised.")
        ),
    }

    return {
        "scenario_title":    SCENARIO_TITLE,
        "scenario_subtitle": SCENARIO_SUBTITLE,
        "scenario_label":    SCENARIO_LABEL,
        "description":       DESCRIPTION,
        "rounding_note":     ADJACENT_NOTE,
        "columns":           COLUMNS,
        "display_names":     DISPLAY_NAMES,
        "target_raw":        TARGET_A,
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
        "extra_target_rows":   [{"label": "Target B", "raw": TARGET_B}],
    }
