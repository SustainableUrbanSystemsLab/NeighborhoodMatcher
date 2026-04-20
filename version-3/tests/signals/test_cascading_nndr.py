import numpy as np
import pytest
from matcher.signals import cascading_nndr


# ── degenerate inputs ─────────────────────────────────────────────────────────

def test_single_supplemental_row_returns_zero():
    """With only one supplemental row, no d2 exists — return (0.0, 0)."""
    nndr, near_miss_count = cascading_nndr(np.array([1.5]))
    assert nndr == 0.0
    assert near_miss_count == 0


def test_empty_input_returns_zero():
    """Empty array should not raise — return (0.0, 0)."""
    nndr, near_miss_count = cascading_nndr(np.array([]))
    assert nndr == 0.0
    assert near_miss_count == 0


def test_exact_match_returns_zero():
    """d1 == 0 means an exact match; nndr is 0 and no near misses possible."""
    nndr, near_miss_count = cascading_nndr(np.array([0.0, 1.0, 2.0]))
    assert nndr == 0.0
    assert near_miss_count == 0


# ── clear unique match ────────────────────────────────────────────────────────

def test_clear_unique_match_low_nndr():
    """d1 much smaller than d2 → low nndr, zero near misses."""
    dists = np.array([0.1, 1.0, 2.0, 5.0])
    nndr, near_miss_count = cascading_nndr(dists, threshold=0.8)
    assert nndr == pytest.approx(0.1)
    assert near_miss_count == 0


# ── ambiguous match ───────────────────────────────────────────────────────────

def test_ambiguous_match_high_nndr():
    """d1 ≈ d2 → nndr near 1.0 and the d2 row counts as a near miss."""
    dists = np.array([0.95, 1.0, 5.0])
    nndr, near_miss_count = cascading_nndr(dists, threshold=0.8)
    assert nndr == pytest.approx(0.95)
    assert near_miss_count == 1


def test_cascades_through_multiple_near_misses():
    """Several rows within threshold → all counted until one falls below."""
    # ratios: 1.0/1.0=1.0, 1.0/1.1≈0.91, 1.0/1.2≈0.83, 1.0/5.0=0.20
    dists = np.array([1.0, 1.0, 1.1, 1.2, 5.0])
    nndr, near_miss_count = cascading_nndr(dists, threshold=0.8)
    assert near_miss_count == 3  # d2, d3, d4 all >= 0.8; d5 breaks the chain


def test_stops_at_first_non_near_miss():
    """Once a ratio drops below threshold, later rows are not counted."""
    # ratios: 1.0/1.1≈0.91, 1.0/2.0=0.50, 1.0/1.05≈0.95 (but never reached)
    dists = np.array([1.0, 1.1, 2.0, 1.05])  # intentionally not sorted past d2
    nndr, near_miss_count = cascading_nndr(dists, threshold=0.8)
    assert near_miss_count == 1  # only d2 counted; loop breaks at d3


# ── threshold sensitivity ────────────────────────────────────────────────────

def test_lower_threshold_catches_more_near_misses():
    """Lower threshold = lower bar to be flagged → equal or more near misses."""
    dists = np.array([1.0, 1.1, 1.3, 5.0])
    _, count_high = cascading_nndr(dists, threshold=0.9)
    _, count_low = cascading_nndr(dists, threshold=0.5)
    assert count_low >= count_high


def test_threshold_boundary_inclusive():
    """Ratio exactly equal to threshold should count as a near miss."""
    # d1/d2 = 0.5/1.0 = 0.5 exactly
    dists = np.array([0.5, 1.0, 10.0])
    _, near_miss_count = cascading_nndr(dists, threshold=0.5)
    assert near_miss_count == 1


# ── flat-landscape edge case ─────────────────────────────────────────────────

def test_all_distances_equal():
    """All ratios = 1.0 → every row after d1 is a near miss."""
    dists = np.array([2.0, 2.0, 2.0, 2.0])
    nndr, near_miss_count = cascading_nndr(dists, threshold=0.8)
    assert nndr == pytest.approx(1.0)
    assert near_miss_count == 3