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