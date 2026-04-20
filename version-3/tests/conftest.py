import pytest
import numpy as np


# ── shared column definitions ─────────────────────────────────────────────────

@pytest.fixture
def simple_common():
    """Two shared columns with known indices."""
    return [
        {"headerName": "feature_a", "header1Index": 1, "header2Index": 0},
        {"headerName": "feature_b", "header1Index": 2, "header2Index": 1},
    ]


# ── small in-memory datasets ──────────────────────────────────────────────────

@pytest.fixture
def tiny_rows_equal():
    """Two identical single-row datasets — expect distance = 0."""
    return [[10.0, 20.0]], [[10.0, 20.0]]


@pytest.fixture
def tiny_rows_known_distance():
    """
    Target row at origin, supplemental row at (3, 4).
    Euclidean distance = 5.0 before standardization.
    """
    return [[0.0, 0.0]], [[3.0, 4.0]]


@pytest.fixture
def reference_pool():
    """
    Small reference pool for brute_find_best_match tests.
    Row 0 is closest to [0, 0], row 2 is farthest.
    """
    return np.array([
        [1.0, 1.0],   # distance ~1.41 from origin
        [5.0, 5.0],   # distance ~7.07
        [10.0, 10.0], # distance ~14.14
    ])