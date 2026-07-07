"""
Equivalence tests: the vectorized match_all engine must reproduce the
per-row reference implementation (compute_sorted_distances + cascading_nndr
+ mnn_confirmed) exactly. These reference functions stay in the codebase as
the executable spec of the matching semantics.
"""

import numpy as np
import pytest

from matcher.distance import (
    match_all,
    compute_sorted_distances,
    brute_find_best_match,
)
from matcher.signals import cascading_nndr, mnn_confirmed


def _reference(targets, refs, threshold):
    """Per-row reference results, same shape as match_all output."""
    out = {
        "best_index": [], "best_distance": [], "repeats": [],
        "nndr": [], "near_miss": [], "mnn_confirmed": [],
    }
    for i, row in enumerate(targets):
        sorted_dists, j, repeats = compute_sorted_distances(row, refs)
        nndr, near_miss = cascading_nndr(sorted_dists, threshold)
        if np.isinf(sorted_dists[0]):
            out["best_index"].append(-1)
            out["mnn_confirmed"].append(False)
        else:
            out["best_index"].append(j)
            confirmed, _ = mnn_confirmed(i, j, targets, refs)
            out["mnn_confirmed"].append(confirmed)
        out["best_distance"].append(sorted_dists[0])
        out["repeats"].append(repeats)
        out["nndr"].append(nndr)
        out["near_miss"].append(near_miss)
    return {k: np.asarray(v) for k, v in out.items()}


def _assert_equivalent(targets, refs, threshold=0.8, chunk_size=3):
    got = match_all(targets, refs, threshold=threshold, chunk_size=chunk_size)
    want = _reference(targets, refs, threshold)
    np.testing.assert_array_equal(got["best_index"], want["best_index"])
    np.testing.assert_array_equal(got["repeats"], want["repeats"])
    np.testing.assert_array_equal(got["near_miss"], want["near_miss"])
    np.testing.assert_array_equal(got["mnn_confirmed"], want["mnn_confirmed"])
    # einsum accumulation may differ from np.sum in the last ulp; exact
    # zeros and ties are still exact (identical inputs -> identical entries).
    np.testing.assert_allclose(got["best_distance"], want["best_distance"],
                               rtol=1e-12)
    np.testing.assert_allclose(got["nndr"], want["nndr"], rtol=1e-12)


def test_random_complete_data_exact():
    rng = np.random.default_rng(42)
    targets = rng.normal(size=(25, 5))
    refs = rng.normal(size=(40, 5))
    _assert_equivalent(targets, refs)


def test_exact_matches_and_ties():
    refs = np.array([
        [1.0, 1.0], [1.0, 1.0], [2.0, 2.0], [3.0, 3.0], [3.0, 3.0], [9.0, 9.0],
    ])
    targets = np.array([
        [1.0, 1.0],   # tied exact matches (2 rows)
        [2.0, 2.0],   # unique exact match
        [3.0, 3.0],   # tied exact matches
        [2.5, 2.5],   # equidistant between two rows — repeat tie, no exact
    ])
    _assert_equivalent(targets, refs, chunk_size=2)


def test_missing_data_cases():
    nan = np.nan
    refs = np.array([
        [1.0, 1.0, 1.0],
        [1.0, nan, 1.0],   # partially missing supplemental
        [nan, nan, nan],   # fully missing supplemental
        [5.0, 5.0, 5.0],
    ])
    targets = np.array([
        [1.0, 1.0, 1.0],   # complete
        [1.0, nan, 1.0],   # partially missing target
        [nan, nan, nan],   # fully missing target → no match
        [nan, 5.0, nan],   # single observed feature
    ])
    got = match_all(targets, refs, chunk_size=2)
    want = _reference(targets, refs, 0.8)
    np.testing.assert_array_equal(got["best_index"], want["best_index"])
    np.testing.assert_array_equal(got["repeats"], want["repeats"])
    np.testing.assert_array_equal(got["near_miss"], want["near_miss"])
    np.testing.assert_array_equal(got["mnn_confirmed"], want["mnn_confirmed"])
    np.testing.assert_allclose(got["best_distance"], want["best_distance"],
                               rtol=1e-12)
    assert got["best_index"][2] == -1  # fully-missing target is a no-match


def test_random_data_with_random_missingness():
    rng = np.random.default_rng(7)
    targets = rng.normal(size=(30, 5))
    refs = rng.normal(size=(50, 5))
    targets[rng.random(targets.shape) < 0.15] = np.nan
    refs[rng.random(refs.shape) < 0.15] = np.nan
    got = match_all(targets, refs, chunk_size=7)
    want = _reference(targets, refs, 0.8)
    np.testing.assert_array_equal(got["best_index"], want["best_index"])
    np.testing.assert_array_equal(got["repeats"], want["repeats"])
    np.testing.assert_array_equal(got["near_miss"], want["near_miss"])
    np.testing.assert_array_equal(got["mnn_confirmed"], want["mnn_confirmed"])
    np.testing.assert_allclose(got["best_distance"], want["best_distance"],
                               rtol=1e-12)


def test_single_supplemental_row():
    targets = np.array([[1.0, 2.0], [3.0, 4.0]])
    refs = np.array([[1.0, 2.0]])
    got = match_all(targets, refs)
    assert got["best_index"][0] == 0
    assert got["nndr"][0] == 0.0  # no d2 exists
    assert np.isnan(got["second_distance"][0])


def test_chunk_boundary_does_not_change_results():
    rng = np.random.default_rng(3)
    targets = rng.normal(size=(10, 4))
    refs = rng.normal(size=(20, 4))
    a = match_all(targets, refs, chunk_size=1)
    b = match_all(targets, refs, chunk_size=10)
    c = match_all(targets, refs, chunk_size=3)
    for key in ("best_index", "best_distance", "repeats", "nndr",
                "near_miss", "mnn_confirmed"):
        np.testing.assert_array_equal(a[key], b[key])
        np.testing.assert_array_equal(a[key], c[key])


def test_top_k_and_histograms():
    rng = np.random.default_rng(11)
    targets = rng.normal(size=(4, 3))
    refs = rng.normal(size=(30, 3))
    got = match_all(targets, refs, top_k=5, hist_bins=10)
    assert len(got["top_k"]) == 4
    for i, tk in enumerate(got["top_k"]):
        assert len(tk) == 5
        assert tk == sorted(tk)
        sorted_dists, _, _ = compute_sorted_distances(targets[i], refs)
        np.testing.assert_allclose(tk, sorted_dists[:5], rtol=1e-12)
    counts, edges = got["histograms"][0]
    assert sum(counts) == 30
    assert len(edges) == 11


def test_progress_callback_reaches_one():
    rng = np.random.default_rng(1)
    targets = rng.normal(size=(9, 2))
    refs = rng.normal(size=(5, 2))
    seen = []
    match_all(targets, refs, chunk_size=2, progress_cb=seen.append)
    assert seen[-1] == 1.0
    assert all(0 < f <= 1.0 for f in seen)
    assert seen == sorted(seen)
