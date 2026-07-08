import pytest
import numpy as np
from matcher.distance import euclidean_distance, brute_find_best_match, compute_sorted_distances


# ── euclidean_distance ────────────────────────────────────────────────────────

def test_identical_rows_distance_zero():
    a = np.array([1.0, 2.0, 3.0])
    assert euclidean_distance(a, a) == 0.0

def test_known_345_triangle():
    a = np.array([0.0, 0.0])
    b = np.array([3.0, 4.0])
    assert euclidean_distance(a, b) == 5.0

def test_single_feature():
    a = np.array([1.0])
    b = np.array([4.0])
    assert euclidean_distance(a, b) == 3.0

def test_symmetry():
    a = np.array([1.0, 5.0])
    b = np.array([4.0, 1.0])
    assert euclidean_distance(a, b) == euclidean_distance(b, a)


# ── brute_find_best_match ─────────────────────────────────────────────────────

def test_finds_closest_row(reference_pool):
    target = np.array([0.0, 0.0])
    (dist, idx), repeats = brute_find_best_match(target, reference_pool)
    assert idx == 0  # row [1, 1] is closest

def test_repeat_count_one_when_unique(reference_pool):
    target = np.array([0.0, 0.0])
    (_, _), repeats = brute_find_best_match(target, reference_pool)
    assert repeats == 1

def test_repeat_count_on_exact_tie():
    """Two supplemental rows at identical distance should increment repeat_count."""
    target = np.array([0.0, 0.0])
    pool = np.array([
        [1.0, 0.0],   # distance 1.0
        [-1.0, 0.0],  # distance 1.0 — tie
        [5.0, 0.0],   # distance 5.0
    ])
    (dist, idx), repeats = brute_find_best_match(target, pool)
    assert dist == 1.0
    assert repeats == 2

def test_exact_match_distance_zero():
    target = np.array([3.0, 7.0])
    pool = np.array([[3.0, 7.0], [1.0, 1.0]])
    (dist, idx), _ = brute_find_best_match(target, pool)
    assert dist == 0.0
    assert idx == 0


# ── compute_sorted_distances ──────────────────────────────────────────────────

def test_sorted_dists_are_ascending(reference_pool):
    target = np.array([0.0, 0.0])
    sorted_dists, _, _ = compute_sorted_distances(target, reference_pool)
    assert list(sorted_dists) == sorted(sorted_dists)


def test_sorted_dists_length_matches_pool(reference_pool):
    target = np.array([0.0, 0.0])
    sorted_dists, _, _ = compute_sorted_distances(target, reference_pool)
    assert len(sorted_dists) == len(reference_pool)


def test_best_index_is_original_pool_index():
    """best_index must point into the *original* reference_rows, not the sorted output."""
    target = np.array([0.0, 0.0])
    pool = np.array([
        [10.0, 10.0],  # index 0 — farthest
        [1.0, 0.0],    # index 1 — closest
        [5.0, 5.0],    # index 2 — middle
    ])
    _, best_index, _ = compute_sorted_distances(target, pool)
    assert best_index == 1


def test_agrees_with_brute_find_best_match(reference_pool):
    """Closest distance and index must match brute_find_best_match."""
    target = np.array([0.0, 0.0])
    sorted_dists, best_index, _ = compute_sorted_distances(target, reference_pool)
    (brute_dist, brute_idx), _ = brute_find_best_match(target, reference_pool)
    assert sorted_dists[0] == pytest.approx(brute_dist)
    assert best_index == brute_idx


def test_repeat_count_unique_best(reference_pool):
    target = np.array([0.0, 0.0])
    _, _, repeat_count = compute_sorted_distances(target, reference_pool)
    assert repeat_count == 1


def test_repeat_count_on_tie():
    target = np.array([0.0, 0.0])
    pool = np.array([
        [1.0, 0.0],   # distance 1.0
        [-1.0, 0.0],  # distance 1.0 — tie
        [5.0, 0.0],
    ])
    _, _, repeat_count = compute_sorted_distances(target, pool)
    assert repeat_count == 2

# ── missing data (NaN masking) ────────────────────────────────────────────────

def test_nan_dims_charge_missing_penalty():
    """Observed dims contribute squared diffs; missing dims contribute
    MISSING_PENALTY each — a neutral prior, not an optimistic rescale."""
    from matcher.distance import MISSING_PENALTY
    a = np.array([0.0, 0.0, np.nan])
    b = np.array([3.0, 4.0, 1.0])
    # observed: (0-3)^2 + (0-4)^2 = 25; + one missing dim penalty
    assert euclidean_distance(a, b) == pytest.approx(np.sqrt(25 + MISSING_PENALTY))

def test_partial_agreement_cannot_fake_an_exact_match():
    """A row that agrees on observed dims but is missing others must NOT
    beat a complete exact match (the impostor-at-distance-0 regression)."""
    target = np.array([1.0, 2.0])
    complete_exact = np.array([1.0, 2.0])
    partial_agree = np.array([1.0, np.nan])
    assert euclidean_distance(target, complete_exact) == 0.0
    assert euclidean_distance(target, partial_agree) > 0.0

def test_nan_in_either_row_masks_dimension():
    a = np.array([1.0, np.nan])
    b = np.array([np.nan, 1.0])
    assert euclidean_distance(a, b) == np.inf  # no shared observed dims

def test_complete_rows_unchanged_by_masking_logic():
    """Complete rows must take the exact fast path — identical to plain Euclidean."""
    a = np.array([0.0, 0.0])
    b = np.array([3.0, 4.0])
    assert euclidean_distance(a, b) == 5.0

def test_all_missing_target_returns_inf_everywhere():
    target = np.array([np.nan, np.nan])
    pool = np.array([[1.0, 2.0], [3.0, 4.0]])
    sorted_dists, _, repeat_count = compute_sorted_distances(target, pool)
    assert np.all(np.isinf(sorted_dists))
    assert repeat_count == 0  # inf ties are not real ties

def test_brute_find_best_match_all_inf_returns_none_index():
    target = np.array([np.nan, np.nan])
    pool = np.array([[1.0, 2.0], [3.0, 4.0]])
    (dist, idx), repeats = brute_find_best_match(target, pool)
    assert np.isinf(dist)
    assert idx is None
    assert repeats == 0

def test_partial_missing_still_finds_best():
    from matcher.distance import MISSING_PENALTY
    target = np.array([1.0, np.nan])
    pool = np.array([[1.0, 99.0], [50.0, 99.0]])
    (dist, idx), _ = brute_find_best_match(target, pool)
    assert idx == 0
    # observed dim matches exactly; the missing dim still costs its penalty
    assert dist == pytest.approx(np.sqrt(MISSING_PENALTY))
