import numpy as np
from matcher.signals import build_flags


_CLEAN_SMD = np.array([0.05, 0.05, 0.05, 0.05])
_NAMES = ["a", "b", "c", "d"]


# ── no-match rows must not claim a match used anything ───────────────────────

def test_no_match_with_missing_features_omits_observed_features_tail():
    """A no-match row reports the missing count without the matched-path
    'match uses observed features only' tail (there is no match)."""
    result = build_flags(
        nndr=1.0, near_miss_count=0, threshold=0.8,
        repeat_count=0, smd_per_feature=_CLEAN_SMD, feature_names=_NAMES,
        target_missing=4, no_match=True,
    )
    assert "no valid match" in result
    assert "missing 4 of 4 shared feature(s)" in result
    assert "match uses observed features only" not in result


def test_no_match_without_missing_reports_warning_only():
    result = build_flags(
        nndr=1.0, near_miss_count=0, threshold=0.8,
        repeat_count=0, smd_per_feature=_CLEAN_SMD, feature_names=_NAMES,
        target_missing=0, no_match=True,
    )
    assert result == (
        "WARNING: no valid match — target shares no observed features "
        "with any supplemental row"
    )


def test_matched_path_keeps_observed_features_tail():
    """The matched-row message is unchanged: partial missingness still
    explains that the match used observed features only."""
    result = build_flags(
        nndr=0.3, near_miss_count=0, threshold=0.8,
        repeat_count=0, smd_per_feature=_CLEAN_SMD, feature_names=_NAMES,
        target_missing=2,
    )
    assert "missing 2 of 4 shared feature(s); match uses observed features only" in result
