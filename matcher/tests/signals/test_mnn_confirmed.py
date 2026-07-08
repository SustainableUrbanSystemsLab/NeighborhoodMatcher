import numpy as np
import pytest
from matcher.signals import mnn_confirmed


# ── confirmed match ───────────────────────────────────────────────────────────

def test_symmetric_match_is_confirmed():
    """Target 0 ↔ supp 0: each is the other's nearest."""
    std_rows_1 = np.array([[0.0, 0.0], [10.0, 10.0]])
    std_rows_2 = np.array([[1.0, 1.0], [11.0, 11.0]])
    confirmed, _ = mnn_confirmed(0, 0, std_rows_1, std_rows_2)
    assert confirmed


def test_single_target_row_always_confirmed():
    """With one target row, it is trivially the nearest."""
    std_rows_1 = np.array([[0.0, 0.0]])
    std_rows_2 = np.array([[7.0, 7.0]])
    confirmed, _ = mnn_confirmed(0, 0, std_rows_1, std_rows_2)
    assert confirmed


def test_exact_match_is_confirmed():
    """Identical target and supp rows → distance 0, confirmed."""
    std_rows_1 = np.array([[5.0, 5.0], [100.0, 100.0]])
    std_rows_2 = np.array([[5.0, 5.0]])
    confirmed, _ = mnn_confirmed(0, 0, std_rows_1, std_rows_2)
    assert confirmed


# ── one-directional (not confirmed) ───────────────────────────────────────────

def test_one_directional_match_not_confirmed():
    """Supp's nearest target is row 1, not the passed-in target_idx=0."""
    # supp [10,10]: dist to target 0 = sqrt(200), to target 1 = sqrt(50)
    std_rows_1 = np.array([[0.0, 0.0], [5.0, 5.0]])
    std_rows_2 = np.array([[10.0, 10.0]])
    confirmed, _ = mnn_confirmed(0, 0, std_rows_1, std_rows_2)
    assert not confirmed


# ── ties (Option B / permissive) ──────────────────────────────────────────────

def test_reverse_search_tie_both_targets_confirmed():
    """
    Supp [1,0] is equidistant from targets [0,0] and [2,0].
    Permissive tie handling: both target_idx=0 and target_idx=1 should confirm.
    """
    std_rows_1 = np.array([[0.0, 0.0], [2.0, 0.0]])
    std_rows_2 = np.array([[1.0, 0.0]])

    confirmed_0, _ = mnn_confirmed(0, 0, std_rows_1, std_rows_2)
    confirmed_1, _ = mnn_confirmed(1, 0, std_rows_1, std_rows_2)
    assert confirmed_0
    assert confirmed_1


def test_reverse_repeat_count_on_tie():
    """reverse_repeat_count should reflect tied target rows."""
    std_rows_1 = np.array([[0.0, 0.0], [2.0, 0.0]])
    std_rows_2 = np.array([[1.0, 0.0]])
    _, repeat_count = mnn_confirmed(0, 0, std_rows_1, std_rows_2)
    assert repeat_count == 2


def test_reverse_repeat_count_unique_when_no_tie():
    """reverse_repeat_count should be 1 when the nearest is unique."""
    std_rows_1 = np.array([[0.0, 0.0], [10.0, 10.0]])
    std_rows_2 = np.array([[1.0, 1.0]])
    _, repeat_count = mnn_confirmed(0, 0, std_rows_1, std_rows_2)
    assert repeat_count == 1


# ── boundary: target_idx not involved in tie ─────────────────────────────────

def test_tie_excluding_target_not_confirmed():
    """
    Supp is equidistant from targets 1 and 2, but target_idx=0 is elsewhere.
    target_idx=0 should NOT be confirmed; reverse_repeat_count should be 2.
    """
    # supp [5,0]: target 0 = dist 10, targets 1 and 2 both = dist 1.0
    std_rows_1 = np.array([[-5.0, 0.0], [4.0, 0.0], [6.0, 0.0]])
    std_rows_2 = np.array([[5.0, 0.0]])
    confirmed, repeat_count = mnn_confirmed(0, 0, std_rows_1, std_rows_2)
    assert not confirmed
    assert repeat_count == 2