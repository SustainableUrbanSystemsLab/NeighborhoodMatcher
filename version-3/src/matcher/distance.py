import numpy as np

# Squared-distance contribution of a dimension that is missing on either
# side. Under joint z-scoring each column has variance 1, so the expected
# squared difference between two unrelated rows is Var(z_a - z_b) ~= 2.
# Charging a missing dimension this neutral prior keeps rows with missing
# data comparable to complete rows WITHOUT letting them look artificially
# close: rescaling the observed dimensions instead (the sklearn
# nan-Euclidean convention) assumes the missing dimensions behave like this
# pair's observed ones, which lets a supplemental row that agrees on its
# few observed dimensions "exact-match" at distance 0 and displace the true
# complete-row match.
MISSING_PENALTY = 2.0


def euclidean_distance(row_a, row_b):
    """
    Euclidean distance between two standardized numpy rows, tolerating
    missing (NaN) dimensions.

    Dimensions observed in BOTH rows contribute their squared difference;
    every other dimension contributes MISSING_PENALTY. Returns inf when the
    rows share no observed dimension — such a pair carries no evidence of
    similarity at all.
    """
    diff = row_a - row_b
    observed = ~np.isnan(diff)
    n_observed = int(observed.sum())
    n_features = diff.shape[0]
    if n_observed == 0:
        return np.inf
    if n_observed == n_features:
        return np.sqrt(np.sum(diff ** 2))
    sq = np.sum(diff[observed] ** 2) + MISSING_PENALTY * (n_features - n_observed)
    return np.sqrt(sq)


def compute_sorted_distances(target_row, reference_rows):
    """
    Computes distances from target_row to every reference row.
    Returns (sorted_dists, best_index, repeat_count).

    sorted_dists : 1-D array of all distances, ascending (inf sorts last).
    best_index   : index of the closest row in the *original* reference_rows.
    repeat_count : number of rows tied at the minimum distance
                   (0 when even the best distance is inf — no valid match).
    """
    dists = np.array([euclidean_distance(target_row, ref) for ref in reference_rows])
    order = np.argsort(dists, kind='stable')
    sorted_dists = dists[order]
    best_index = int(order[0])
    if np.isinf(sorted_dists[0]):
        return sorted_dists, best_index, 0
    repeat_count = int(np.sum(dists == sorted_dists[0]))
    return sorted_dists, best_index, repeat_count


def brute_find_best_match(target_row, reference_rows):
    """
    Brute-force search for the closest row in reference_rows.
    Returns ((best_distance, best_index), repeat_count).
    repeat_count tracks exact-distance ties.

    When no reference row shares an observed dimension with the target,
    best_distance is inf, best_index is None and repeat_count is 0.
    """
    best_distance = np.inf
    best_index = None
    repeat_count = 0

    for i, ref_row in enumerate(reference_rows):
        d = euclidean_distance(target_row, ref_row)
        if d < best_distance:
            best_distance = d
            best_index = i
            repeat_count = 1
        elif d == best_distance and best_index is not None:
            repeat_count += 1

    return (best_distance, best_index), repeat_count
