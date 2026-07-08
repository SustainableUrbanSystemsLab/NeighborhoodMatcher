# Scale Mismatch scenario.
#
# The target reports dragon_sightings in thousands (2.469) while every
# supplemental row uses the raw count (2,469–7,389).
# This single unit error dominates the distance calculation.
#
# Supplemental slot (row 19) = original unrounded target values in raw units
# (2469, 40.2, 99.5, 649) — the "correct" row, included so the researcher can
# see it was available but received a large distance regardless.

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

SCENARIO_TITLE    = "Scenario 3: Scale Mismatch"
SCENARIO_SUBTITLE = "What happens when one feature uses different units across the two datasets"
SCENARIO_LABEL    = "scale_mismatch"

DESCRIPTION = (
    "One of the most dangerous data errors: the same variable measured in different "
    "units in the two datasets. Here the target reports Dragon Sightings as a "
    "per-thousand figure (2.469, meaning approximately 2{,}469), while every row in "
    "the supplemental dataset uses the raw count (2{,}469--7{,}389). "
    "After standardization, the target's Dragon Sightings value becomes an extreme "
    "outlier --- pulling every candidate's distance upward by roughly the same large "
    "amount and effectively neutralising that feature's discriminating power. "
    "The system still selects the nearest row, but inspecting the per-feature "
    "contribution table alongside the large absolute distance reveals the problem: "
    "one feature is responsible for nearly all of the distance. "
    "Concentration alone is not a warning --- any scenario where only one feature "
    "differs will show 100\\% contribution from that feature. "
    "The concern here is that concentration is paired with a large absolute distance, "
    "suggesting the dominant feature is not slightly off but fundamentally misscaled."
)

ROUNDING_NOTE = (
    "Dragon Sightings in the target is entered as \\textbf{2.469} "
    "(per-thousand units). "
    "The supplemental dataset records the same variable as a raw count; "
    "the correct raw value for this record is \\textbf{2{,}469}. "
    "All other features use consistent units across both datasets."
)

# Target with dragon_sightings in thousands
TARGET_SCALED = np.array([2.469, 40.2, 99.5, 649.0])

# Supplemental slot: correct raw-count row so it appears in the candidate table
SUPP_SLOT = TARGET.copy()   # [2469, 40.2, 99.5, 649]


def _fmt(val, col):
    if col["fmt"] == "d":
        return f"{int(round(val)):,}"
    return f"{val:{col['fmt']}}"


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

    target_2d = TARGET_SCALED.reshape(1, -1).tolist()
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
    raw_combined = np.vstack([TARGET_SCALED.reshape(1, -1), supplemental])
    raw_means = np.mean(raw_combined, axis=0)
    raw_stds  = np.std(raw_combined, axis=0)
    raw_stds[raw_stds == 0] = 1

    # Example: second-closest row
    all_dists = np.array([
        np.sqrt(np.sum((std_t[0] - std_s[i]) ** 2)) for i in range(n_supp)
    ])
    order = np.argsort(all_dists, kind="stable")
    example_supp_orig_idx = int(order[1])
    example_raw = supplemental[example_supp_orig_idx]

    z_target  = (TARGET_SCALED - raw_means) / raw_stds
    z_example = (example_raw   - raw_means) / raw_stds
    sq_diffs  = (z_target - z_example) ** 2
    example_distance = float(np.sqrt(np.sum(sq_diffs)))

    # Sorted supplemental display table
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
    dominant_feature = DISPLAY_NAMES[int(np.argmax(contributions))]
    dominant_pct     = float(np.max(contributions)) * 100

    # --- Signal explanations ---
    signal_explanations = {
        "per_feature_contribution": (
            f"\\textbf{{This is the key diagnostic for this scenario.}} "
            f"When one feature uses the wrong units, it generates an outsized "
            f"squared difference that dwarfs all other features. "
            f"Here \\textbf{{{dominant_feature}}} accounts for "
            f"\\textbf{{{dominant_pct:.1f}\\%}} of the total distance, "
            f"with the remaining features contributing only {100 - dominant_pct:.1f}\\%. "
            f"Concentration alone is not a red flag --- if only one feature differs, "
            f"it will naturally account for 100\\% of the distance even when the "
            f"difference is trivial. "
            f"The warning sign here is that this concentration is paired with a "
            f"large absolute distance ({best_dist:.4f}). Together they indicate the "
            f"dominant feature is not slightly off but misscaled by orders of magnitude."
        ),
        "euc_distance": (
            f"The best-match distance is \\textbf{{{best_dist:.4f}}} --- "
            f"far larger than the rounding scenario (0.2902) and orders of "
            f"magnitude above the exact match (0.0000). "
            f"The scale error inflates every candidate's distance by roughly "
            f"the same large amount, making the absolute distance value "
            f"unreliable as a quality signal on its own. "
            f"The per-feature contribution table above is more informative here."
        ),
        "nndr": (
            f"NNDR = $d_1 / d_2$ = ${best_dist:.4f} \\div {second_dist:.4f}$ = "
            f"\\textbf{{{nndr_val:.4f}}}. "
            + (
                f"This exceeds the 0.80 threshold --- an ambiguity flag is raised. "
                f"Because the scale error adds roughly the same large constant to "
                f"every candidate's distance, the gap between best and second-best "
                f"is small relative to both values, pushing the ratio toward 1.0."
                if nndr_val >= 0.8 else
                f"This is below the 0.80 threshold. Despite the large absolute distance, "
                f"the best match is still meaningfully closer than the second-best --- "
                f"likely because the correct row's other three features match exactly, "
                f"giving it a small advantage even under the scale error."
            )
        ),
        "near_miss_count": (
            f"\\textbf{{{near_miss}}} supplemental row(s) fall within the near-miss "
            f"threshold ($d_1 / d_i \\geq 0.80$). "
            + (
                f"With {near_miss} near-miss(es), many candidates are nearly "
                f"indistinguishable from the best match. This is the expected "
                f"consequence of the scale error: since Dragon Sightings contributes "
                f"~{dominant_pct:.0f}\\% of every row's distance, the remaining "
                f"features have little room to differentiate candidates."
                if near_miss > 0 else
                "The best match is still clearly separated from the others, "
                "likely because the correct row's remaining features match the "
                "target exactly while no other row does."
            )
        ),
        "mnn_confirmed": (
            ("\\textbf{Confirmed: True.} "
             "The matched row points back to this target as its nearest record "
             "in the reverse search. The match is symmetric despite the unit error."
             if confirmed else
             "\\textbf{Confirmed: False.} "
             "The matched row does not point back to this target in the reverse "
             "search. The scale error has distorted distances enough that the "
             "match is not symmetric.")
        ),
        "repeats": (
            f"\\textbf{{{repeats}}} row(s) tied at the minimum distance. "
            + ("No exact tie." if repeats == 1 else
               "A tie exists. When the dominant feature is neutralised by a unit "
               "error, two rows with identical remaining features become equidistant.")
        ),
        "smd": (
            "With one target row, SMD is not computable and is reported as 0. "
            "In a full run, the scale error on Dragon Sightings would appear as "
            "a very large SMD on that feature --- potentially the most obvious "
            "diagnostic signal of all."
        ),
        "flags": (
            f"\\textbf{{Flags: \\texttt{{{_tex_escape(flags) if flags else '(none)'}}}}}. "
            + ("One or more flags were raised. The scale error has introduced "
               "enough ambiguity that the system warns the researcher to review "
               "this match before using it."
               if flags else
               "No flags raised. The NNDR is close to the 0.80 threshold, "
               "but the remaining three features were unique enough that the "
               "correct row still pulled ahead. The match succeeded despite "
               "the unit error.")
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
        "target_raw":        TARGET_SCALED,
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
            "contributions":   contributions,
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
