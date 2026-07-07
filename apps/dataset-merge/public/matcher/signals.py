# NOTE: Quality signals — to be implemented after design discussion.
#
# Planned signals (see docs/match_quality_brainstorm.md):
#
#   cascading_nndr(sorted_dists, threshold)
#       Returns (nndr, near_miss_count).
#       nndr     = d1/d2 ratio (Lowe 2004)
#       near_miss_count = number of supplemental rows where d1/di >= threshold
#
#   mnn_confirmed(target_idx, best_supp_idx, std_rows_1, std_rows_2)
#       Returns (confirmed, reverse_repeat_count).
#       confirmed: True if match is symmetric (Muja & Lowe 2009).
#       reverse_repeat_count: ties found in the reverse search.
#
#   per_row_feature_contribution(target_row, matched_row)
#       Returns array of per-feature squared-distance proportions.
#       Feeds the heat map.
#
#   dataset_smd(std_rows_1, matched_indices, std_rows_2)
#       Returns per-feature SMD across all matched pairs (Austin, PMC3472075).
#       Benchmark: |SMD| > 0.10 = imbalance, > 0.25 = poor.
#
#   build_flags(nndr, near_miss_count, threshold, repeat_count, smd_per_feature)
#       Returns a plain-English string for the flags column.

from matcher.distance import brute_find_best_match, euclidean_distance

import numpy as np

def cascading_nndr(sorted_dists, threshold=0.8):
    """
    Cascading nearest-neighbor distance ratio (Lowe 2004, extended).

    sorted_dists : 1-D array of distances from one target to every
                   supplemental row, ascending.
    threshold    : float in (0, 1). Lower = stricter.

    Returns: (nndr, near_miss_count)
        nndr            — d1/d2. Near 0 = confident, near 1 = ambiguous.
        near_miss_count — supplemental rows where d1/di >= threshold.
    """
    n = len(sorted_dists)
    if n < 2: # Handles 1 supplemental row case
        return 0.0, 0

    d1 = sorted_dists[0]
    if d1 == 0: # Handles exact match case
        return 0.0, 0

    nndr = d1 / sorted_dists[1]

    near_miss_count = 0
    for i in range(1, n):
        if d1 / sorted_dists[i] >= threshold:
            near_miss_count += 1
        else:
            break

    return nndr, near_miss_count


def mnn_confirmed(target_idx, best_supp_idx, std_rows_1, std_rows_2):
    """
    Mutual nearest neighbor check (Muja & Lowe 2009).

    Runs a reverse search: if supplemental row at best_supp_idx has
    target_idx among its nearest target rows, the match is symmetric.
    Permissive on ties — ties are reported separately via
    reverse_repeat_count (see match_quality_brainstorm.md §6).

    Returns: (confirmed, reverse_repeat_count)
        confirmed            — bool. True if target_idx is among nearest.
        reverse_repeat_count — int. Target rows tied for nearest in the
                               reverse search.
    """
    supp_row = std_rows_2[best_supp_idx]
    (best_distance, _), reverse_repeat_count = brute_find_best_match(supp_row, std_rows_1)

    target_distance = euclidean_distance(supp_row, std_rows_1[target_idx])
    confirmed = target_distance == best_distance

    return confirmed, reverse_repeat_count


def per_row_feature_contribution(target_row, matched_row):
      """
      target_row, matched_row : 1-D numpy arrays of standardized features,
                                same length.

      Returns: 1-D array of per-feature proportions (sum to 1.0).
               Element i = (target_i - matched_i)^2 / total_squared_distance.
      """

      sq_diff = (target_row - matched_row)**2
      sq_sum = np.sum(sq_diff)

      if sq_sum == 0:
          return np.zeros_like(sq_diff)

      return sq_diff / sq_sum


def dataset_smd(std_rows_1, matched_indices, std_rows_2):
    """
    Per-feature standardized mean difference across all matched pairs.

    std_rows_1      : 2-D array, shape (N, d) — standardized target rows.
    matched_indices : 1-D int array, length N — index into std_rows_2 for
                      each target row's best match.
    std_rows_2      : 2-D array, shape (M, d) — standardized supplemental rows.

    Returns: 1-D array of length d.
        Element f = |mean(target_col_f) - mean(matched_col_f)| / pooled_SD_f.
        0.0 where pooled SD is zero (constant feature — imbalance not computable).

    Benchmarks (Austin, PMC3472075):
        |SMD| > 0.10 → imbalance flag
        |SMD| > 0.25 → poor match quality
    """
    targets = np.asarray(std_rows_1, dtype=float)
    matched = np.asarray(std_rows_2, dtype=float)[np.asarray(matched_indices)]

    n, d = targets.shape

    if n < 2:
        return np.zeros(d)

    mean_diff = np.abs(targets.mean(axis=0) - matched.mean(axis=0))
    pooled_var = (np.var(targets, axis=0, ddof=1) + np.var(matched, axis=0, ddof=1)) / 2.0
    pooled_sd = np.sqrt(pooled_var)

    smd = np.zeros(d)
    nonzero = pooled_sd != 0.0
    smd[nonzero] = mean_diff[nonzero] / pooled_sd[nonzero]
    return smd


# SMD thresholds are fixed by literature (Austin, PMC3472075).
# NNDR threshold is intentionally absent — it is run-configurable and
# passed explicitly so the flag reflects the same threshold used during matching.
_FLAG_RULES = {
    "nndr":      {"message": "ambiguous match — NNDR {nndr:.2f} (>= {threshold:.2f})"},
    "near_miss": {"message": "{n} near-miss row(s) within distance ratio threshold"},
    "repeat":    {"message": "{n} exact-distance tie(s)"},
    "mnn":       {"message": "MNN not confirmed — supplemental row is closer to a different target; this record may have no valid match"},
    "smd_poor":  {"threshold": 0.25, "message": "poor feature balance — {features} (|SMD| > 0.25)"},
    "smd_warn":  {"threshold": 0.10, "message": "feature imbalance — {features} (|SMD| > 0.10)"},
}


def build_flags(nndr, near_miss_count, threshold, repeat_count, smd_per_feature, feature_names,
                mnn_confirmed=True):
    """
    Assembles a plain-English flag string for one matched row.

    nndr            : float    — d1/d2 ratio from cascading_nndr.
    near_miss_count : int      — supplemental rows within distance ratio threshold.
    threshold       : float    — NNDR threshold used in this run.
    repeat_count    : int      — exact-distance ties from brute_find_best_match.
    smd_per_feature : 1-D array — per-feature SMD values from dataset_smd.
    feature_names   : sequence of str — feature names, same order as smd_per_feature.
    mnn_confirmed   : bool     — False triggers an MNN flag (default True = no flag).

    Returns: str. Empty string if no flags raised; " | "-joined messages otherwise.
    """
    flags = []

    if nndr >= threshold:
        flags.append(_FLAG_RULES["nndr"]["message"].format(nndr=nndr, threshold=threshold))

    if near_miss_count > 0:
        flags.append(_FLAG_RULES["near_miss"]["message"].format(n=near_miss_count))

    if repeat_count > 1:
        flags.append(_FLAG_RULES["repeat"]["message"].format(n=repeat_count))

    if not mnn_confirmed:
        flags.append(_FLAG_RULES["mnn"]["message"])

    smd   = np.asarray(smd_per_feature)
    names = list(feature_names)

    poor_features = [names[i] for i in range(len(smd))
                     if smd[i] > _FLAG_RULES["smd_poor"]["threshold"]]
    if poor_features:
        flags.append(_FLAG_RULES["smd_poor"]["message"].format(features=", ".join(poor_features)))

    warn_features = [names[i] for i in range(len(smd))
                     if _FLAG_RULES["smd_warn"]["threshold"] < smd[i]
                     <= _FLAG_RULES["smd_poor"]["threshold"]]
    if warn_features:
        flags.append(_FLAG_RULES["smd_warn"]["message"].format(features=", ".join(warn_features)))

    return " | ".join(flags)