import numpy as np


def dual_standardize(raw_rows_1, raw_rows_2):
    """
    Z-score normalizes two datasets together so the same raw value
    maps to the same standardized value in both.
    Returns (std_rows_1, std_rows_2) as numpy arrays.

    Missing cells (None) become NaN and are excluded from the mean/std,
    so missing data neither shifts the column statistics nor receives a
    fabricated value — downstream distances mask NaN dimensions.

    NOTE: Uses standardized Euclidean distance (z-score normalization + Euclidean).
    Limitation: does not account for correlations between variables.
    Future consideration: Mahalanobis distance.
    """
    table = np.array(raw_rows_1 + raw_rows_2, dtype=float)  # None -> NaN
    split = len(raw_rows_1)

    # Column stats over observed values only, computed without NaN-warning
    # noise (an all-missing column would make nanmean/nanstd warn).
    observed = ~np.isnan(table)
    counts = observed.sum(axis=0)
    safe_counts = np.maximum(counts, 1)
    means = np.where(counts > 0, np.nansum(table, axis=0) / safe_counts, 0.0)
    variances = np.nansum((table - means) ** 2, axis=0) / safe_counts
    stds = np.sqrt(variances)
    # Guard: constant or all-missing column would cause divide-by-zero.
    stds = np.where(stds == 0, 1.0, stds)

    table = (table - means) / stds
    return table[:split], table[split:]


def scale_compatibility_warnings(raw_rows_1, raw_rows_2, feature_names, ratio_limit=50.0):
    """
    Detects columns whose spread differs wildly between the two datasets —
    the signature of a unit mismatch or an already-standardized input file.

    Joint standardization silently swallows this failure mode: when one side
    is pre-z-scored (spread ~1) and the other is raw dollars (spread in the
    thousands), pooled stats are dominated by the raw side and the narrow
    side collapses onto a single standardized point, matching everything to
    the same few rows with confident-looking output.

    Returns a list of human-readable warning strings, one per suspect column
    (empty when scales look compatible). Uses the observed-value standard
    deviation per side; columns that are constant or all-missing on either
    side are skipped (no ratio to compare).
    """
    a = np.array(raw_rows_1, dtype=float)
    b = np.array(raw_rows_2, dtype=float)

    def _observed_std(table):
        counts = (~np.isnan(table)).sum(axis=0)
        safe = np.maximum(counts, 1)
        mean = np.where(counts > 0, np.nansum(table, axis=0) / safe, 0.0)
        var = np.nansum((table - mean) ** 2, axis=0) / safe
        return np.sqrt(var), counts

    std_a, count_a = _observed_std(a)
    std_b, count_b = _observed_std(b)

    warnings = []
    for i, name in enumerate(feature_names):
        if count_a[i] == 0 or count_b[i] == 0 or std_a[i] == 0 or std_b[i] == 0:
            continue
        ratio = std_a[i] / std_b[i]
        if ratio > ratio_limit or ratio < 1.0 / ratio_limit:
            warnings.append(
                f"possible scale mismatch in column '{name}': target spread "
                f"(std {std_a[i]:.4g}) vs supplemental spread (std {std_b[i]:.4g}) "
                f"differ by more than {ratio_limit:g}x — check that both files "
                f"use the same units and neither is already standardized"
            )
    return warnings
