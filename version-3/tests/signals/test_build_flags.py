import numpy as np
import pytest
from matcher.signals import build_flags


# helpers — base values that produce no flags
_CLEAN_SMD   = np.array([0.05, 0.05])
_CLEAN_NAMES = ["income", "education"]


# ── clean match — no flags ────────────────────────────────────────────────────

def test_clean_match_returns_empty_string():
    """All signals well within bounds → empty string, not None or whitespace."""
    result = build_flags(
        nndr=0.3, near_miss_count=0, threshold=0.8,
        repeat_count=0, smd_per_feature=_CLEAN_SMD, feature_names=_CLEAN_NAMES,
    )
    assert result == ""


# ── NNDR flag ─────────────────────────────────────────────────────────────────

def test_nndr_above_threshold_raises_flag():
    """nndr >= threshold → ambiguous match message containing the ratio."""
    result = build_flags(
        nndr=0.85, near_miss_count=0, threshold=0.8,
        repeat_count=0, smd_per_feature=_CLEAN_SMD, feature_names=_CLEAN_NAMES,
    )
    assert "ambiguous match" in result
    assert "0.85" in result


def test_nndr_exactly_at_threshold_raises_flag():
    """Boundary is inclusive — nndr == threshold should flag."""
    result = build_flags(
        nndr=0.8, near_miss_count=0, threshold=0.8,
        repeat_count=0, smd_per_feature=_CLEAN_SMD, feature_names=_CLEAN_NAMES,
    )
    assert "ambiguous match" in result


def test_nndr_below_threshold_no_flag():
    """nndr just below threshold → no ambiguity flag."""
    result = build_flags(
        nndr=0.79, near_miss_count=0, threshold=0.8,
        repeat_count=0, smd_per_feature=_CLEAN_SMD, feature_names=_CLEAN_NAMES,
    )
    assert "ambiguous" not in result


def test_custom_threshold_respected():
    """
    nndr=0.75 flags at threshold=0.7 but not at threshold=0.8.
    Confirms the function uses the passed threshold, not a hardcoded default.
    """
    flagged = build_flags(
        nndr=0.75, near_miss_count=0, threshold=0.7,
        repeat_count=0, smd_per_feature=_CLEAN_SMD, feature_names=_CLEAN_NAMES,
    )
    clean = build_flags(
        nndr=0.75, near_miss_count=0, threshold=0.8,
        repeat_count=0, smd_per_feature=_CLEAN_SMD, feature_names=_CLEAN_NAMES,
    )
    assert "ambiguous match" in flagged
    assert "ambiguous match" not in clean


# ── near-miss flag ────────────────────────────────────────────────────────────

def test_near_miss_count_reported():
    """near_miss_count > 0 → message includes the count."""
    result = build_flags(
        nndr=0.3, near_miss_count=4, threshold=0.8,
        repeat_count=0, smd_per_feature=_CLEAN_SMD, feature_names=_CLEAN_NAMES,
    )
    assert "4 near-miss" in result


def test_zero_near_misses_no_flag():
    result = build_flags(
        nndr=0.3, near_miss_count=0, threshold=0.8,
        repeat_count=0, smd_per_feature=_CLEAN_SMD, feature_names=_CLEAN_NAMES,
    )
    assert "near-miss" not in result


# ── repeat / tie flag ─────────────────────────────────────────────────────────

def test_repeat_count_of_one_no_flag():
    """repeat_count=1 means a unique best match — no tie flag."""
    result = build_flags(
        nndr=0.3, near_miss_count=0, threshold=0.8,
        repeat_count=1, smd_per_feature=_CLEAN_SMD, feature_names=_CLEAN_NAMES,
    )
    assert "tie" not in result


def test_repeat_count_of_two_flags_tie():
    """repeat_count=2 means a genuine tie — flag it."""
    result = build_flags(
        nndr=0.3, near_miss_count=0, threshold=0.8,
        repeat_count=2, smd_per_feature=_CLEAN_SMD, feature_names=_CLEAN_NAMES,
    )
    assert "2 exact-distance tie(s)" in result


# ── SMD poor flag (|SMD| > 0.25) ─────────────────────────────────────────────

def test_smd_poor_names_the_offending_feature():
    """Feature with SMD > 0.25 → 'poor feature balance' with the feature name."""
    smd = np.array([0.30, 0.05])
    result = build_flags(
        nndr=0.3, near_miss_count=0, threshold=0.8,
        repeat_count=0, smd_per_feature=smd, feature_names=["income", "education"],
    )
    assert "poor feature balance" in result
    assert "income" in result
    assert "education" not in result


def test_smd_poor_multiple_features_both_named():
    """Two features above 0.25 → both appear in the poor flag message."""
    smd = np.array([0.30, 0.40])
    result = build_flags(
        nndr=0.3, near_miss_count=0, threshold=0.8,
        repeat_count=0, smd_per_feature=smd, feature_names=["income", "education"],
    )
    assert "income" in result
    assert "education" in result


# ── SMD warn flag (0.10 < |SMD| <= 0.25) ────────────────────────────────────

def test_smd_warn_names_the_offending_feature():
    """Feature with SMD between 0.10 and 0.25 → 'feature imbalance' message."""
    smd = np.array([0.15, 0.05])
    result = build_flags(
        nndr=0.3, near_miss_count=0, threshold=0.8,
        repeat_count=0, smd_per_feature=smd, feature_names=["income", "education"],
    )
    assert "feature imbalance" in result
    assert "income" in result


def test_smd_poor_feature_not_duplicated_in_warn():
    """A feature above 0.25 should appear only in 'poor', not also in 'warn'."""
    smd = np.array([0.30])
    result = build_flags(
        nndr=0.3, near_miss_count=0, threshold=0.8,
        repeat_count=0, smd_per_feature=smd, feature_names=["income"],
    )
    assert "poor feature balance" in result
    assert "feature imbalance" not in result


def test_smd_at_exactly_010_no_flag():
    """SMD == 0.10 is not > 0.10 — no flag should be raised."""
    smd = np.array([0.10])
    result = build_flags(
        nndr=0.3, near_miss_count=0, threshold=0.8,
        repeat_count=0, smd_per_feature=smd, feature_names=["income"],
    )
    assert result == ""


# ── multiple flags — separator ────────────────────────────────────────────────

def test_multiple_flags_joined_with_pipe():
    """When several conditions trigger, messages are separated by ' | '."""
    smd = np.array([0.30, 0.05])
    result = build_flags(
        nndr=0.9, near_miss_count=3, threshold=0.8,
        repeat_count=2, smd_per_feature=smd, feature_names=["income", "education"],
    )
    parts = result.split(" | ")
    assert len(parts) >= 3
    assert any("ambiguous" in p for p in parts)
    assert any("near-miss" in p for p in parts)
    assert any("tie" in p for p in parts)