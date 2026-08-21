"""
confidence_tier: one plain verdict per row synthesized from the signals.
Rule table (first match wins): No match / Low / Medium / High — see the
function docstring for the full conditions.
"""

from matcher.signals import confidence_tier
from matcher.web_api import coordinate_in_memory


def _tier(**overrides):
    base = dict(
        no_match=False, rejected=False, nndr=0.3, threshold=0.8,
        repeat_count=1, mnn_confirmed=True, near_miss_count=0,
        features_used=4, n_features=4,
    )
    base.update(overrides)
    return confidence_tier(**base)


# ── one test per rule row ─────────────────────────────────────────────────────

def test_clean_row_is_high():
    assert _tier() == "High"


def test_no_match_wins():
    assert _tier(no_match=True) == "No match"


def test_rejected_wins():
    assert _tier(rejected=True) == "No match"


def test_tie_is_low():
    assert _tier(repeat_count=2) == "Low"


def test_mnn_not_confirmed_is_low():
    assert _tier(mnn_confirmed=False) == "Low"


def test_nndr_at_threshold_is_low():
    assert _tier(nndr=0.8) == "Low"


def test_single_feature_of_many_is_low():
    assert _tier(features_used=1, n_features=4) == "Low"


def test_near_miss_is_medium():
    assert _tier(near_miss_count=2) == "Medium"


def test_partial_missingness_is_medium():
    assert _tier(features_used=3, n_features=4) == "Medium"


# ── precedence ────────────────────────────────────────────────────────────────

def test_rejected_beats_tie():
    assert _tier(rejected=True, repeat_count=5) == "No match"


def test_tie_beats_near_miss():
    assert _tier(repeat_count=3, near_miss_count=2) == "Low"


def test_single_feature_run_can_be_high():
    # features_used == 1 is only Low when MORE features were linked.
    assert _tier(features_used=1, n_features=1) == "High"


# ── end-to-end: CSV column mirrors per_target ────────────────────────────────

def test_csv_confidence_matches_per_target():
    target = """pid,a,b
t1,10,100
t2,,
"""
    supp = """geo,a,b
g1,10,100
g2,30,300
"""
    result = coordinate_in_memory(target, supp, threshold=0.8)
    conf_col = result["linked_headers"].index("confidence")
    d_conf_col = result["detail_headers"].index("confidence")
    for i, row in enumerate(result["per_target"]):
        assert result["linked_rows"][i][conf_col] == row["confidence"]
        assert result["detail_rows"][i][d_conf_col] == row["confidence"]
    assert result["per_target"][0]["confidence"] == "High"
    assert result["per_target"][1]["confidence"] == "No match"
    tiers = result["summary"]["tiers"]
    assert tiers["High"] == 1 and tiers["No match"] == 1
