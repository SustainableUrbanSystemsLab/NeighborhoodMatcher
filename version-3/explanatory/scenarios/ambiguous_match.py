# Ambiguous Match scenario.
#
# The supplemental pool contains two rows that are nearly identical to each other
# and both moderately close to the target. The inserted row (SUPP_SLOT) is a
# near-twin of base row [2524, 30.0, 99.5, 557], edging it out by a tiny margin.
# Because both candidates sit at very similar standardized distances from the target,
# NNDR = d1/d2 approaches 1.0 and exceeds the 0.80 threshold.
# The system still picks the closer row, but the flag tells the researcher
# the choice is not clear-cut.

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

SCENARIO_TITLE    = "Scenario 4: Ambiguous Match"
SCENARIO_SUBTITLE = "What happens when two candidates are nearly equidistant from the target"
SCENARIO_LABEL    = "ambiguous_match"

DESCRIPTION = (
    "The matching algorithm always returns the single closest supplemental row, "
    "but it cannot always tell the researcher how confident that choice is. "
    "This scenario shows what happens when two candidates are genuinely similar "
    "to each other --- and both are a moderate, roughly equal distance from the target. "
    "The system picks the marginally closer row, but the Nearest Neighbor Distance "
    "Ratio (NNDR) approaches 1.0 and triggers an ambiguity flag. "
    "Unlike the scale-mismatch scenario, there is no data error here: the pool "
    "simply contains two similar records and the target falls between them. "
    "The flag tells the researcher to review the match before relying on it."
)

# Near-twin of the closest base row [2524, 30.0, 99.5, 557].
# Slightly closer to TARGET on every feature, so it wins rank 1
# by a thin margin — producing NNDR close to 1.0.
SUPP_SLOT = np.array([2521.0, 30.2, 99.5, 558.0])


def _tex_escape(s):
    replacements = {
        "&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#",
        "_": r"\_", "{": r"\{", "}": r"\}",
        "~": r"\textasciitilde{}", "^": r"\textasciicircum{}",
        "\\": r"\textbackslash{}",
    }
    return "".join(replacements.get(c, c) for c in s)


def build_scenario():
    supplemental = np.vstack([SUPP_BASE, SUPP_SLOT])
    n_supp = len(supplemental)

    target_2d = TARGET.reshape(1, -1).tolist()
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
    raw_combined = np.vstack([TARGET.reshape(1, -1), supplemental])
    raw_means = np.mean(raw_combined, axis=0)
    raw_stds  = np.std(raw_combined, axis=0)
    raw_stds[raw_stds == 0] = 1

    all_dists = np.array([
        np.sqrt(np.sum((std_t[0] - std_s[i]) ** 2)) for i in range(n_supp)
    ])
    order = np.argsort(all_dists, kind="stable")
    example_supp_orig_idx = int(order[1])
    example_raw = supplemental[example_supp_orig_idx]

    z_target  = (TARGET      - raw_means) / raw_stds
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
            "The per-feature breakdown here shows that no single feature dominates --- "
            "the distance between the target and the best match is spread across "
            "multiple features. This distinguishes genuine candidate similarity from "
            "a data error: in the scale-mismatch scenario one feature accounted for "
            "nearly all the distance; here the contributions are distributed, "
            "reflecting that both rows are broadly similar to the target."
        ),
        "euc_distance": (
            f"The best-match distance is \\textbf{{{best_dist:.4f}}}. "
            f"On its own this value does not signal a problem --- it is a real "
            f"distance from a real mismatch between the target and the pool. "
            f"The concern here is not the absolute distance but how close the "
            f"runner-up is. See NNDR below."
        ),
        "nndr": (
            f"NNDR = $d_1 / d_2$ = ${best_dist:.4f} \\div {second_dist:.4f}$ = "
            f"\\textbf{{{nndr_val:.4f}}}. "
            + (
                f"This meets or exceeds the 0.80 threshold --- the ambiguity flag fires. "
                f"The best and second-best candidates are only "
                f"{(1 - nndr_val) * 100:.1f}\\% apart in standardized distance. "
                f"The system chose the marginally closer row, but swapping the two "
                f"would change the match by almost nothing numerically --- yet the "
                f"two rows may represent meaningfully different real-world units."
                if nndr_val >= 0.8 else
                f"This is below the 0.80 threshold. Despite the similar candidates, "
                f"the best match holds a clear enough lead that no ambiguity flag fires. "
                f"The researcher may still want to note the runner-up distance."
            )
        ),
        "near_miss_count": (
            f"\\textbf{{{near_miss}}} supplemental row(s) fall within the near-miss "
            f"threshold ($d_1 / d_i \\geq 0.80$). "
            + (
                f"With {near_miss} near-miss(es), the match is not uniquely determined. "
                f"These additional rows are close enough that a small change in the "
                f"target's reported values could flip the selection."
                if near_miss > 0 else
                "Only the immediate runner-up is within the ambiguity band. "
                "The rest of the pool is clearly farther away."
            )
        ),
        "mnn_confirmed": (
            ("\\textbf{Confirmed: True.} "
             "Even with a high NNDR, the matched row still points back to this "
             "target as its nearest record in the reverse search. Ambiguity in "
             "the forward direction does not automatically break MNN symmetry."
             if confirmed else
             "\\textbf{Confirmed: False.} "
             "The matched row does not point back to this target in the reverse "
             "search. Combined with the high NNDR, this is a strong signal that "
             "the match should be reviewed before use.")
        ),
        "repeats": (
            f"\\textbf{{{repeats}}} row(s) tied at the minimum distance. "
            + ("No exact tie. The two similar candidates are close but not "
               "equidistant from the target."
               if repeats == 1 else
               "An exact tie --- two rows are equidistant from the target. "
               "The system selects one arbitrarily.")
        ),
        "smd": (
            "With one target row, SMD is not computable and is reported as 0. "
            "In a full run where many targets fall in this dense region of the "
            "supplemental space, SMD would remain near 0 (both candidates are "
            "similar to the target) --- but NNDR flags would accumulate, signaling "
            "that the pool is too dense for confident one-to-one matching."
        ),
        "flags": (
            f"\\textbf{{Flags: \\texttt{{{_tex_escape(flags) if flags else '(none)'}}}}}. "
            + ("One or more flags raised. This match requires researcher review. "
               "The flag does not mean the match is wrong --- it means the system "
               "cannot confidently distinguish the best candidate from the runner-up. "
               "The researcher should inspect both rows and decide which, if either, "
               "is appropriate to use."
               if flags else
               "No flags raised. The best match maintained enough of a lead over "
               "the runner-up to stay below the threshold.")
        ),
    }

    return {
        "scenario_title":    SCENARIO_TITLE,
        "scenario_subtitle": SCENARIO_SUBTITLE,
        "scenario_label":    SCENARIO_LABEL,
        "description":       DESCRIPTION,
        "rounding_note":     None,
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
