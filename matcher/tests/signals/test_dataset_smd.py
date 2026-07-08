import numpy as np
import pytest
from matcher.signals import dataset_smd


# ── perfect balance ──────────────────────────────────────────────────────────

def test_perfect_balance_returns_zero():
    """When matched rows are identical to targets, every feature SMD = 0."""
    targets = np.array([[1.0, 3.0], [3.0, 5.0]])
    supp    = np.array([[1.0, 3.0], [3.0, 5.0]])
    smd = dataset_smd(targets, [0, 1], supp)
    np.testing.assert_array_almost_equal(smd, [0.0, 0.0])


# ── known hand-computable result ─────────────────────────────────────────────

def test_known_smd_single_feature():
    """
    Two-row datasets, one feature.

    targets col 0: [0, 2] → mean=1.0, sample var=2.0
    matched col 0: [4, 6] → mean=5.0, sample var=2.0
    pooled SD = sqrt((2+2)/2) = sqrt(2) ≈ 1.4142
    SMD = |1 - 5| / sqrt(2) = 4 / sqrt(2) ≈ 2.828
    """
    targets = np.array([[0.0], [2.0]])
    supp    = np.array([[4.0], [6.0]])
    smd = dataset_smd(targets, [0, 1], supp)
    assert smd[0] == pytest.approx(4.0 / np.sqrt(2.0), rel=1e-6)


# ── per-feature independence ─────────────────────────────────────────────────

def test_imbalance_isolated_to_one_feature():
    """
    Feature 0 is heavily imbalanced; feature 1 is perfectly balanced.
    Only SMD[0] should be nonzero.
    """
    targets = np.array([[0.0, 2.0], [2.0, 2.0]])
    supp    = np.array([[5.0, 2.0], [7.0, 2.0]])
    smd = dataset_smd(targets, [0, 1], supp)
    assert smd[0] > 0.0
    assert smd[1] == pytest.approx(0.0)


def test_output_length_matches_feature_count():
    """Returned array must have one entry per feature."""
    targets = np.array([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]])
    supp    = np.array([[1.5, 2.5, 3.5], [4.5, 5.5, 6.5]])
    smd = dataset_smd(targets, [0, 1], supp)
    assert smd.shape == (3,)


# ── matched_indices selects the correct supplemental rows ────────────────────

def test_matched_indices_used_correctly():
    """
    supp has four rows.  matched_indices=[0,1] picks a well-matched group
    (mean ≈ target mean → SMD ≈ 0); matched_indices=[2,3] picks a biased
    group (mean far from target mean → large SMD).
    Confirms the function uses the indexed rows, not the full supplemental pool.
    """
    targets = np.array([[0.0], [2.0]])          # target mean = 1.0
    supp    = np.array([[0.5], [1.5],           # rows 0,1: mean = 1.0 (well matched)
                        [8.5], [9.5]])           # rows 2,3: mean = 9.0 (biased)

    smd_well_matched = dataset_smd(targets, [0, 1], supp)
    smd_biased       = dataset_smd(targets, [2, 3], supp)

    assert smd_well_matched[0] == pytest.approx(0.0)
    assert smd_biased[0] > 1.0


# ── constant feature ─────────────────────────────────────────────────────────

def test_constant_feature_returns_zero():
    """
    If a feature has the same value everywhere in both groups, pooled SD = 0
    and SMD is undefined — return 0.0 rather than NaN or inf.
    """
    targets = np.array([[7.0, 1.0], [7.0, 3.0]])
    supp    = np.array([[7.0, 5.0], [7.0, 7.0]])
    smd = dataset_smd(targets, [0, 1], supp)
    assert smd[0] == pytest.approx(0.0)   # constant col → zero
    assert not np.isnan(smd[0])
    assert not np.isinf(smd[0])


# ── degenerate inputs ────────────────────────────────────────────────────────

def test_single_pair_returns_zeros():
    """
    With only one matched pair, sample variance is undefined (ddof=1, n=1).
    Return zeros — SMD is not computable from a single pair.
    """
    targets = np.array([[1.0, 2.0]])
    supp    = np.array([[9.0, 8.0]])
    smd = dataset_smd(targets, [0], supp)
    np.testing.assert_array_equal(smd, [0.0, 0.0])


# ── threshold benchmarks (Austin PMC3472075) ──────────────────────────────────

def test_smd_above_poor_threshold():
    """
    Construct a dataset where the gap is large enough to exceed 0.25.

    targets col 0: [0,1,2,3,4] → mean=2.0, sample var=2.5
    matched col 0: [0.5,1.5,2.5,3.5,4.5] → mean=2.5, sample var=2.5
    pooled SD = sqrt(2.5) ≈ 1.581
    SMD = 0.5 / 1.581 ≈ 0.316 > 0.25
    """
    targets = np.array([[0.0], [1.0], [2.0], [3.0], [4.0]])
    supp    = np.array([[0.5], [1.5], [2.5], [3.5], [4.5]])
    smd = dataset_smd(targets, [0, 1, 2, 3, 4], supp)
    assert smd[0] == pytest.approx(0.5 / np.sqrt(2.5), rel=1e-6)
    assert smd[0] > 0.25


def test_smd_below_imbalance_threshold():
    """
    Tiny mean shift → SMD well below 0.10.

    targets col 0: [0,1,2,3,4] → mean=2.0, sample var=2.5
    matched col 0: [0.05,1.05,2.05,3.05,4.05] → mean=2.05, same var
    SMD ≈ 0.05 / sqrt(2.5) ≈ 0.032 < 0.10
    """
    targets = np.array([[0.0], [1.0], [2.0], [3.0], [4.0]])
    supp    = np.array([[0.05], [1.05], [2.05], [3.05], [4.05]])
    smd = dataset_smd(targets, [0, 1, 2, 3, 4], supp)
    assert smd[0] == pytest.approx(0.05 / np.sqrt(2.5), rel=1e-6)
    assert smd[0] < 0.10


# ── sign invariance ───────────────────────────────────────────────────────────

def test_direction_of_bias_does_not_affect_magnitude():
    """
    SMD is absolute — matched group running high vs. low yields the same value.
    """
    targets = np.array([[2.0], [4.0]])
    supp_high = np.array([[5.0], [7.0]])   # matched mean > target mean
    supp_low  = np.array([[-1.0], [1.0]])  # matched mean < target mean

    smd_high = dataset_smd(targets, [0, 1], supp_high)
    smd_low  = dataset_smd(targets, [0, 1], supp_low)

    assert smd_high[0] == pytest.approx(smd_low[0], rel=1e-6)