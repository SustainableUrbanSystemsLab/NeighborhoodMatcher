import numpy as np
import pytest
from matcher.signals import per_row_feature_contribution


# ── core behavior ────────────────────────────────────────────────────────────

def test_contributions_sum_to_one():
    """Proportions across all features must sum to 1.0."""
    target = np.array([1.0, 2.0, 3.0])
    matched = np.array([1.0, 4.0, 0.0])
    contribs = per_row_feature_contribution(target, matched)
    assert contribs.sum() == pytest.approx(1.0)


def test_known_decomposition():
    """Hand-computed example: diffs² = [0, 4, 9], total=13."""
    target = np.array([1.0, 2.0, 3.0])
    matched = np.array([1.0, 4.0, 0.0])
    contribs = per_row_feature_contribution(target, matched)
    assert contribs[0] == pytest.approx(0.0)
    assert contribs[1] == pytest.approx(4 / 13)
    assert contribs[2] == pytest.approx(9 / 13)


def test_single_feature_drives_full_distance():
    """When only one feature differs, it should receive 100% of contribution."""
    target = np.array([5.0, 5.0, 5.0])
    matched = np.array([5.0, 10.0, 5.0])
    contribs = per_row_feature_contribution(target, matched)
    assert contribs[0] == 0.0
    assert contribs[1] == pytest.approx(1.0)
    assert contribs[2] == 0.0


# ── sign invariance ──────────────────────────────────────────────────────────

def test_sign_of_difference_does_not_matter():
    """Squaring means +3 and -3 contribute equally."""
    target_a = np.array([0.0, 0.0])
    matched_a = np.array([3.0, 4.0])

    target_b = np.array([3.0, 4.0])
    matched_b = np.array([0.0, 0.0])

    contribs_a = per_row_feature_contribution(target_a, matched_a)
    contribs_b = per_row_feature_contribution(target_b, matched_b)
    np.testing.assert_array_equal(contribs_a, contribs_b)


# ── exact match ──────────────────────────────────────────────────────────────

def test_exact_match_returns_zeros():
    """No distance to decompose → all zeros, no NaN, no warning."""
    target = np.array([1.0, 2.0, 3.0])
    matched = np.array([1.0, 2.0, 3.0])
    contribs = per_row_feature_contribution(target, matched)
    np.testing.assert_array_equal(contribs, np.zeros(3))


def test_exact_match_length_preserved():
    """Zero-distance fallback should match input length."""
    target = np.array([0.0, 0.0, 0.0, 0.0, 0.0])
    matched = np.array([0.0, 0.0, 0.0, 0.0, 0.0])
    contribs = per_row_feature_contribution(target, matched)
    assert len(contribs) == 5


# ── edge: single-feature input ───────────────────────────────────────────────

def test_single_feature_nonzero():
    """One feature, nonzero difference → contribution = 1.0."""
    target = np.array([0.0])
    matched = np.array([2.5])
    contribs = per_row_feature_contribution(target, matched)
    assert contribs == pytest.approx([1.0])


def test_single_feature_exact_match():
    """One feature, equal → contribution = 0.0 (no distance)."""
    target = np.array([2.5])
    matched = np.array([2.5])
    contribs = per_row_feature_contribution(target, matched)
    assert contribs == pytest.approx([0.0])