import pytest
import numpy as np
from matcher.standardize import dual_standardize


def test_combined_mean_is_zero():
    """After standardizing, the combined dataset should have mean ~0 per column."""
    rs1 = [[1.0, 10.0], [2.0, 20.0]]
    rs2 = [[3.0, 30.0], [4.0, 40.0]]
    s1, s2 = dual_standardize(rs1, rs2)
    combined = np.vstack([s1, s2])
    np.testing.assert_allclose(combined.mean(axis=0), 0.0, atol=1e-10)

def test_combined_std_is_one():
    """After standardizing, the combined dataset should have std ~1 per column."""
    rs1 = [[1.0, 10.0], [2.0, 20.0]]
    rs2 = [[3.0, 30.0], [4.0, 40.0]]
    s1, s2 = dual_standardize(rs1, rs2)
    combined = np.vstack([s1, s2])
    np.testing.assert_allclose(combined.std(axis=0), 1.0, atol=1e-10)

def test_zero_variance_column_does_not_crash():
    """A constant column should not raise a divide-by-zero error."""
    rs1 = [[5.0, 1.0], [5.0, 2.0]]
    rs2 = [[5.0, 3.0], [5.0, 4.0]]
    s1, s2 = dual_standardize(rs1, rs2)
    # Constant column should be all zeros after standardization
    np.testing.assert_array_equal(s1[:, 0], 0.0)
    np.testing.assert_array_equal(s2[:, 0], 0.0)

def test_split_preserves_row_count():
    rs1 = [[1.0], [2.0], [3.0]]
    rs2 = [[4.0], [5.0]]
    s1, s2 = dual_standardize(rs1, rs2)
    assert s1.shape[0] == 3
    assert s2.shape[0] == 2

# ── missing data (None → NaN) ────────────────────────────────────────────────

def test_missing_values_excluded_from_stats():
    """A missing cell must not shift the column mean the way a zero would."""
    rs1 = [[1.0], [None]]
    rs2 = [[2.0], [3.0]]
    s1, s2 = dual_standardize(rs1, rs2)
    observed = np.array([1.0, 2.0, 3.0])
    expected_mean, expected_std = observed.mean(), observed.std()
    np.testing.assert_allclose(s1[0, 0], (1.0 - expected_mean) / expected_std)
    assert np.isnan(s1[1, 0])  # missing stays missing

def test_all_missing_column_does_not_crash():
    rs1 = [[None, 1.0]]
    rs2 = [[None, 2.0]]
    s1, s2 = dual_standardize(rs1, rs2)
    assert np.isnan(s1[0, 0]) and np.isnan(s2[0, 0])
    assert np.isfinite(s1[0, 1]) and np.isfinite(s2[0, 1])


# ── scale_compatibility_warnings ─────────────────────────────────────────────

from matcher.standardize import scale_compatibility_warnings

def test_scale_warning_fires_on_prestandardized_target():
    """Target spread ~1 vs supplemental spread in the thousands → warn."""
    rs1 = [[-1.2], [0.3], [1.1]]                      # looks z-scored
    rs2 = [[800.0], [1500.0], [2400.0], [3100.0]]     # raw dollars
    warnings = scale_compatibility_warnings(rs1, rs2, ["median_rent"])
    assert len(warnings) == 1
    assert "median_rent" in warnings[0]

def test_scale_warning_quiet_on_compatible_scales():
    rs1 = [[10.0], [20.0], [30.0]]
    rs2 = [[12.0], [22.0], [35.0]]
    assert scale_compatibility_warnings(rs1, rs2, ["pct_poverty"]) == []

def test_scale_warning_skips_constant_and_missing_columns():
    rs1 = [[5.0, None], [5.0, None]]
    rs2 = [[5.0, 1.0], [5.0, 2.0]]
    assert scale_compatibility_warnings(rs1, rs2, ["const", "half_missing"]) == []
