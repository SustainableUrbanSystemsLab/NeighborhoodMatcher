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