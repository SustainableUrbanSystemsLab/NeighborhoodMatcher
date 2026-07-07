import numpy as np


def euclidean_distance(row_a, row_b):
    """Euclidean distance between two standardized numpy rows."""
    return np.sqrt(np.sum((row_a - row_b) ** 2))


def compute_sorted_distances(target_row, reference_rows):
    """
    Computes distances from target_row to every reference row.
    Returns (sorted_dists, best_index, repeat_count).

    sorted_dists : 1-D array of all distances, ascending.
    best_index   : index of the closest row in the *original* reference_rows.
    repeat_count : number of rows tied at the minimum distance.
    """
    dists = np.array([euclidean_distance(target_row, ref) for ref in reference_rows])
    order = np.argsort(dists, kind='stable')
    sorted_dists = dists[order]
    best_index = int(order[0])
    repeat_count = int(np.sum(dists == sorted_dists[0]))
    return sorted_dists, best_index, repeat_count


def brute_find_best_match(target_row, reference_rows):
    """
    Brute-force search for the closest row in reference_rows.
    Returns ((best_distance, best_index), repeat_count).
    repeat_count tracks exact-distance ties.
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
        elif d == best_distance:
            repeat_count += 1

    return (best_distance, best_index), repeat_count
