"""
Match-quality signals computed for every target/supplemental pair.

Each signal isolates one aspect of match confidence; together they form the
content of the ``flags`` column written to the linked dataset and detail file.
See ``docs/signals/`` for per-signal write-ups (definition, behavior, examples,
edge cases) and ``docs/architecture.md`` for how these are wired into the
pipeline.

Missing data: standardized rows may contain NaN (missing cells are never
imputed). Distances mask NaN dimensions, and the per-row/per-dataset signals
below follow the same convention.
"""

from matcher.distance import MISSING_PENALTY, brute_find_best_match, euclidean_distance

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

    Exact matches: d1 == 0 with d2 > 0 is a uniquely perfect match →
    (0.0, 0). But d1 == 0 with d2 == 0 is a tie between exact matches —
    maximally ambiguous, so nndr = 1.0 and every zero-distance runner-up
    counts as a near miss. A best distance of inf means no valid match
    exists (no overlapping observed features); that is also maximally
    ambiguous → (1.0, 0), and the pipeline flags it explicitly.
    """
    n = len(sorted_dists)
    if n == 0:
        return 0.0, 0

    d1 = sorted_dists[0]
    if np.isinf(d1):  # no valid match at all
        return 1.0, 0
    if n < 2:  # single supplemental row — no d2 exists
        return 0.0, 0

    if d1 == 0:
        if sorted_dists[1] == 0:  # tied exact matches — ambiguous
            zero_ties = int(np.sum(sorted_dists[1:] == 0.0))
            return 1.0, zero_ties
        return 0.0, 0  # uniquely exact match

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
    reverse_repeat_count (see docs/signals/mnn_confirmed.md).

    Returns: (confirmed, reverse_repeat_count)
        confirmed            — bool. True if target_idx is among nearest.
        reverse_repeat_count — int. Target rows tied for nearest in the
                               reverse search.
    """
    supp_row = std_rows_2[best_supp_idx]
    (best_distance, best_idx), reverse_repeat_count = brute_find_best_match(supp_row, std_rows_1)
    if best_idx is None:  # supplemental row shares no observed feature with any target
        return False, 0

    target_distance = euclidean_distance(supp_row, std_rows_1[target_idx])
    confirmed = target_distance == best_distance

    return confirmed, reverse_repeat_count


def per_row_feature_contribution(target_row, matched_row):
      """
      target_row, matched_row : 1-D numpy arrays of standardized features,
                                same length. May contain NaN (missing).

      Returns: 1-D array of per-feature proportions (sum to 1.0). A
               dimension missing on either side contributes its
               MISSING_PENALTY share — missingness is uncertainty, and the
               heat map should show it rather than hide it.
               Element i = (target_i - matched_i)^2 / total_squared_distance.
      """

      diff = target_row - matched_row
      sq_diff = np.where(np.isnan(diff), MISSING_PENALTY, diff ** 2)
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

    Rows may contain NaN (missing); statistics are computed over observed
    values per column.

    Returns: 1-D array of length d.
        Element f = |mean(target_col_f) - mean(matched_col_f)| / pooled_SD_f.
        0.0 where pooled SD is zero (constant feature — imbalance not computable).

    Benchmarks (Austin, PMC3472075):
        |SMD| > 0.10 → imbalance flag
        |SMD| > 0.25 → poor match quality
    """
    targets = np.asarray(std_rows_1, dtype=float)
    matched = np.asarray(std_rows_2, dtype=float)[np.asarray(matched_indices, dtype=int)]

    n, d = targets.shape

    if n < 2:
        return np.zeros(d)

    def _observed_mean_var(a):
        """Column mean and sample variance (ddof=1) over observed values."""
        counts = (~np.isnan(a)).sum(axis=0)
        safe = np.maximum(counts, 1)
        mean = np.where(counts > 0, np.nansum(a, axis=0) / safe, np.nan)
        ss = np.nansum((a - np.where(np.isnan(mean), 0.0, mean)) ** 2, axis=0)
        var = np.where(counts > 1, ss / np.maximum(counts - 1, 1), 0.0)
        return mean, var

    t_mean, t_var = _observed_mean_var(targets)
    m_mean, m_var = _observed_mean_var(matched)

    mean_diff = np.abs(t_mean - m_mean)
    mean_diff = np.where(np.isnan(mean_diff), 0.0, mean_diff)  # all-missing column
    pooled_sd = np.sqrt((t_var + m_var) / 2.0)

    smd = np.zeros(d)
    nonzero = pooled_sd != 0.0
    smd[nonzero] = mean_diff[nonzero] / pooled_sd[nonzero]
    return smd


# SMD thresholds are fixed by literature (Austin, PMC3472075).
# NNDR threshold is intentionally absent — it is run-configurable and
# passed explicitly so the flag reflects the same threshold used during matching.
_FLAG_RULES = {
    "no_match":      {"message": "WARNING: no valid match — target shares no observed features with any supplemental row"},
    "nndr":          {"message": "ambiguous match — NNDR {nndr:.2f} (>= {threshold:.2f})"},
    "near_miss":     {"message": "{n} near-miss row(s) within distance ratio threshold"},
    "repeat":        {"message": "{n} exact-distance tie(s)"},
    "mnn":           {"message": "MNN not confirmed — supplemental row is closer to a different target; this record may have no valid match"},
    "target_missing": {"message": "target row missing {k} of {n} shared feature(s); match uses observed features only"},
    "match_missing": {"message": "matched supplemental row missing {k} of {n} shared feature(s)"},
    "smd_poor":      {"threshold": 0.25, "message": "poor feature balance — {features} (|SMD| > 0.25)"},
    "smd_warn":      {"threshold": 0.10, "message": "feature imbalance — {features} (|SMD| > 0.10)"},
}


def build_flags(nndr, near_miss_count, threshold, repeat_count, smd_per_feature, feature_names,
                mnn_confirmed=True, target_missing=0, match_missing=0, no_match=False):
    """
    Assembles a plain-English flag string for one matched row.

    nndr            : float    — d1/d2 ratio from cascading_nndr.
    near_miss_count : int      — supplemental rows within distance ratio threshold.
    threshold       : float    — NNDR threshold used in this run.
    repeat_count    : int      — exact-distance ties from brute_find_best_match.
    smd_per_feature : 1-D array — per-feature SMD values from dataset_smd.
    feature_names   : sequence of str — feature names, same order as smd_per_feature.
    mnn_confirmed   : bool     — False triggers an MNN flag (default True = no flag).
    target_missing  : int      — missing shared features in the target row.
    match_missing   : int      — missing shared features in the matched supplemental row.
    no_match        : bool     — True when no valid match exists (all distances inf);
                                 suppresses the per-match flags, which would be
                                 meaningless without a match.

    Returns: str. Empty string if no flags raised; " | "-joined messages otherwise.
    """
    n_features = len(list(feature_names))
    flags = []

    if no_match:
        flags.append(_FLAG_RULES["no_match"]["message"])
        if target_missing > 0:
            flags.append(_FLAG_RULES["target_missing"]["message"].format(k=target_missing, n=n_features))
        return " | ".join(flags)

    if nndr >= threshold:
        flags.append(_FLAG_RULES["nndr"]["message"].format(nndr=nndr, threshold=threshold))

    if near_miss_count > 0:
        flags.append(_FLAG_RULES["near_miss"]["message"].format(n=near_miss_count))

    if repeat_count > 1:
        flags.append(_FLAG_RULES["repeat"]["message"].format(n=repeat_count))

    if not mnn_confirmed:
        flags.append(_FLAG_RULES["mnn"]["message"])

    if target_missing > 0:
        flags.append(_FLAG_RULES["target_missing"]["message"].format(k=target_missing, n=n_features))

    if match_missing > 0:
        flags.append(_FLAG_RULES["match_missing"]["message"].format(k=match_missing, n=n_features))

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
