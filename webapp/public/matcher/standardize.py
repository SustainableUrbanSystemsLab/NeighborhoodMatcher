import numpy as np


def dual_standardize(raw_rows_1, raw_rows_2):
    """
    Z-score normalizes two datasets together so the same raw value
    maps to the same standardized value in both.
    Returns (std_rows_1, std_rows_2) as numpy arrays.

    Missing cells (None) become NaN and are excluded from the mean/std,
    so missing data neither shifts the column statistics nor receives a
    fabricated value — downstream distances mask NaN dimensions.

    Columns whose relative spread is float rounding dust (std below
    ~1e-12 x |mean|) are treated as constant: double precision carries
    ~1e-16 relative error, so such a "spread" is arithmetic noise, and
    dividing by it would blow the noise up into z-units and let a
    1e-13 artifact repel an exact-twin match.

    NOTE: Uses standardized Euclidean distance (z-score normalization + Euclidean).
    Limitation: does not account for correlations between variables.
    Future consideration: Mahalanobis distance.
    """
    # vstack (not +) so numpy-array inputs stack rows instead of silently
    # adding elementwise, which list-concatenation semantics would allow.
    table = np.vstack([
        np.asarray(raw_rows_1, dtype=float),
        np.asarray(raw_rows_2, dtype=float),
    ])  # None -> NaN
    split = len(raw_rows_1)

    # Column stats over observed values only, computed without NaN-warning
    # noise (an all-missing column would make nanmean/nanstd warn).
    observed = ~np.isnan(table)
    counts = observed.sum(axis=0)
    safe_counts = np.maximum(counts, 1)
    means = np.where(counts > 0, np.nansum(table, axis=0) / safe_counts, 0.0)
    variances = np.nansum((table - means) ** 2, axis=0) / safe_counts
    stds = np.sqrt(variances)
    # Guard: constant, all-missing, or rounding-dust column would cause
    # divide-by-(near-)zero and z-score explosions.
    dust = stds <= 1e-12 * np.abs(means)
    stds = np.where((stds == 0) | dust, 1.0, stds)

    table = (table - means) / stds
    return table[:split], table[split:]


# Spread ratio beyond which two files are judged to be on different scales.
# Shared with signals.variable_report so the per-variable note and the
# dataset-level warning can never disagree on the same column.
SCALE_RATIO_LIMIT = 50.0


def observed_column_std(table):
    """
    Per-column population standard deviation and observed count over a float
    array (NaN = missing). The scale-check convention: a column whose spread
    is float rounding dust relative to its mean is reported as exactly 0
    (constant), so dust never produces an arbitrary spread ratio.
    """
    counts = (~np.isnan(table)).sum(axis=0)
    safe = np.maximum(counts, 1)
    mean = np.where(counts > 0, np.nansum(table, axis=0) / safe, 0.0)
    with np.errstate(over="ignore"):
        var = np.nansum((table - mean) ** 2, axis=0) / safe
    std = np.sqrt(var)
    dust = std <= 1e-12 * np.abs(mean)
    return np.where(dust, 0.0, std), counts


def scale_compatibility_warnings(raw_rows_1, raw_rows_2, feature_names,
                                 ratio_limit=SCALE_RATIO_LIMIT):
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
    deviation per side. Columns that are constant (or rounding-dust
    constant) or all-missing on BOTH sides are skipped; a column constant on
    exactly one side while clearly varying on the other gets its own warning
    — that is the most extreme spread mismatch possible, and the ratio test
    cannot express it.
    """
    a = np.asarray(raw_rows_1, dtype=float)
    b = np.asarray(raw_rows_2, dtype=float)

    std_a, count_a = observed_column_std(a)
    std_b, count_b = observed_column_std(b)

    warnings = []
    for i, name in enumerate(feature_names):
        if count_a[i] == 0 or count_b[i] == 0:
            continue
        if not (np.isfinite(std_a[i]) and np.isfinite(std_b[i])):
            warnings.append(
                f"column '{name}' contains values too large to standardize — "
                f"its spread overflows double precision and the column would "
                f"carry no weight in matching"
            )
            continue
        a_const, b_const = std_a[i] == 0, std_b[i] == 0
        if a_const and b_const:
            continue
        if a_const != b_const:
            const_side = "target" if a_const else "supplemental"
            vary_side = "supplemental" if a_const else "target"
            vary_std = std_b[i] if a_const else std_a[i]
            warnings.append(
                f"column '{name}' is constant in the {const_side} file but "
                f"varies in the {vary_side} file (std {vary_std:.4g}) — "
                f"check that both files use the same units and encoding"
            )
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
