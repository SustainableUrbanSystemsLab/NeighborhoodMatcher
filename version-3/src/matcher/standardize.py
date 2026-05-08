import numpy as np


def dual_standardize(raw_rows_1, raw_rows_2):
    """
    Z-score normalizes two datasets together so the same raw value
    maps to the same standardized value in both.
    Returns (std_rows_1, std_rows_2) as numpy arrays.

    NOTE: Uses standardized Euclidean distance (z-score normalization + Euclidean).
    Limitation: does not account for correlations between variables.
    Future consideration: Mahalanobis distance.
    """
    table = np.array(raw_rows_1 + raw_rows_2, dtype=float)
    split = len(raw_rows_1)

    means = np.mean(table, axis=0)
    stds = np.std(table, axis=0)
    stds[stds == 0] = 1  # Guard: constant column would cause divide-by-zero

    table = (table - means) / stds
    return table[:split], table[split:]
