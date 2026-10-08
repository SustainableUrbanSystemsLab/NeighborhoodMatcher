"""
min_confidence — the minimum-confidence reporting filter.

Contract: purely a reporting filter. It never changes which matches are
found or any run-level statistic (SMD, tier counts, MNN/NNDR aggregates,
variables); a row below the minimum is written unlinked with a
"link withheld" flag while the detail file and per_target keep the nearest
row's full diagnostics.
"""

import csv

import pytest

from matcher.pipeline import coordinator
from matcher.signals import validate_min_confidence
from matcher.web_api import assemble_results, coordinate_in_memory, match_shard

# Rows engineered per tier:
#   t1 -> exact unique match, all features observed        => High
#   t2 -> exact on observed dims, missing c, isolated from
#         every competitor (nndr well below threshold)     => Medium
#   t3 -> single observed feature, three-way distance tie  => Low
#   t4 -> exact-distance tie between two identical rows    => Low
TARGET_CSV = (
    "id,a,b,c\n"
    "t1,0.0,0.0,0.0\n"
    "t2,100.0,100.0,\n"
    "t3,20.0,,\n"
    "t4,42.0,30.0,5.0\n"
)
SUPP_CSV = (
    "a,b,c,extra\n"
    "0.0,0.0,0.0,s0\n"
    "100.0,100.0,7.0,s1\n"
    "60.0,50.0,9.0,s2\n"
    "40.0,30.0,5.0,s3\n"
    "40.0,30.0,5.0,s4\n"
)


def _tiers(res):
    return [pt["confidence"] for pt in res["per_target"]]


def test_fixture_produces_expected_tiers():
    res = coordinate_in_memory(TARGET_CSV, SUPP_CSV)
    assert _tiers(res) == ["High", "Medium", "Low", "Low"]


def test_off_is_identical_to_base_run():
    base = coordinate_in_memory(TARGET_CSV, SUPP_CSV)
    off = coordinate_in_memory(TARGET_CSV, SUPP_CSV, min_confidence=None)
    assert off == base


def test_medium_withholds_exactly_the_low_rows():
    base = coordinate_in_memory(TARGET_CSV, SUPP_CSV)
    res = coordinate_in_memory(TARGET_CSV, SUPP_CSV, min_confidence="medium")

    withheld = [pt for pt in res["per_target"] if pt["withheld"]]
    assert [pt["target_idx"] for pt in withheld] == [2, 3]
    for pt in withheld:
        base_pt = base["per_target"][pt["target_idx"]]
        assert pt["match_idx"] is None
        assert pt["nearest_idx"] == base_pt["match_idx"]
        assert pt["no_match"] is False and pt["rejected"] is False
        assert pt["confidence"] == "Low"  # true tier preserved
        assert pt["filled_from_match"] == []
        # Diagnostics preserved
        assert pt["best_distance"] == base_pt["best_distance"]
        assert pt["nndr"] == base_pt["nndr"]

    # Linked row unlinked: supplemental cells blank, confidence annotated,
    # withheld flag prepended, real flags still present after it.
    idx_conf = res["linked_headers"].index("confidence")
    idx_flags = res["linked_headers"].index("flags")
    idx_extra = res["linked_headers"].index("extra")
    row = res["linked_rows"][3]
    assert row[idx_conf] == "Low (withheld)"
    assert row[idx_flags].startswith("link withheld — confidence Low is below your minimum (Medium)")
    assert "exact-distance tie" in row[idx_flags]
    assert row[idx_extra] == ""
    assert row[res["linked_headers"].index("euc_distance")] == ""

    # Detail row keeps diagnostics, with the annotated confidence cell.
    d_conf = res["detail_headers"].index("confidence")
    d_dist = res["detail_headers"].index("euc_distance")
    assert res["detail_rows"][3][d_conf] == "Low (withheld)"
    assert res["detail_rows"][3][d_dist] == base["detail_rows"][3][d_dist]


def test_high_also_withholds_medium():
    res = coordinate_in_memory(TARGET_CSV, SUPP_CSV, min_confidence="high")
    assert [pt["withheld"] for pt in res["per_target"]] == [False, True, True, True]
    assert res["summary"]["withheld"] == 3
    assert res["summary"]["min_confidence"] == "High"


def test_run_level_statistics_unchanged():
    base = coordinate_in_memory(TARGET_CSV, SUPP_CSV)
    res = coordinate_in_memory(TARGET_CSV, SUPP_CSV, min_confidence="high")
    assert res["smd"] == base["smd"]
    assert res["variables"] == base["variables"]
    assert res["summary"]["tiers"] == base["summary"]["tiers"]
    assert res["summary"]["mnn_confirmed"] == base["summary"]["mnn_confirmed"]
    assert res["summary"]["mean_nndr"] == base["summary"]["mean_nndr"]
    assert res["summary"]["mean_best_distance"] == base["summary"]["mean_best_distance"]
    assert res["summary"]["no_match"] == base["summary"]["no_match"]
    # Non-withheld rows byte-identical to the base run
    for base_pt, pt in zip(base["per_target"], res["per_target"]):
        if not pt["withheld"]:
            assert pt == base_pt
    assert res["linked_rows"][0] == base["linked_rows"][0]


def test_precedence_cutoff_rejection_beats_withholding():
    # A tiny cutoff rejects every match; rejection must win — rows report
    # "No match", never "withheld".
    res = coordinate_in_memory(
        TARGET_CSV, SUPP_CSV, max_distance=1e-9, min_confidence="high"
    )
    assert all(not pt["withheld"] for pt in res["per_target"])
    assert res["summary"]["withheld"] == 0
    assert res["summary"]["rejected"] >= 1


def test_no_fill_on_withheld_rows():
    # t3 has missing b and c cells that a normal run fills from the match;
    # when the row is withheld it must go out unfilled.
    base = coordinate_in_memory(TARGET_CSV, SUPP_CSV)
    assert base["per_target"][2]["filled_from_match"] == ["b", "c"]
    res = coordinate_in_memory(TARGET_CSV, SUPP_CSV, min_confidence="medium")
    assert res["per_target"][2]["withheld"] is True
    assert res["per_target"][2]["filled_from_match"] == []
    idx_b = res["linked_headers"].index("b")
    assert res["linked_rows"][2][idx_b] == ""


@pytest.mark.parametrize("bad", ["low", "Low", "LOW"])
def test_validation_rejects_low(bad):
    with pytest.raises(ValueError, match="withhold nothing"):
        validate_min_confidence(bad)


@pytest.mark.parametrize("bad", ["", "hi", 0.5, True, "No match"])
def test_validation_rejects_garbage(bad):
    with pytest.raises(ValueError, match="min_confidence"):
        validate_min_confidence(bad)


def test_validation_canonicalizes():
    assert validate_min_confidence(None) is None
    assert validate_min_confidence("medium") == "Medium"
    assert validate_min_confidence("HIGH") == "High"


def test_sharded_equals_single_with_filter():
    single = coordinate_in_memory(TARGET_CSV, SUPP_CSV, min_confidence="medium")
    shard_a = match_shard(TARGET_CSV, SUPP_CSV, row_lo=0, row_hi=2)
    shard_b = match_shard(TARGET_CSV, SUPP_CSV, row_lo=2, row_hi=None)
    sharded = assemble_results(
        TARGET_CSV, SUPP_CSV, [shard_b, shard_a], min_confidence="medium"
    )
    assert sharded == single


def test_cli_web_parity_with_filter(tmp_path):
    target = tmp_path / "target.csv"
    supp = tmp_path / "supp.csv"
    target.write_text(TARGET_CSV, encoding="utf-8")
    supp.write_text(SUPP_CSV, encoding="utf-8")
    out = tmp_path / "linked.csv"
    coordinator(str(target), str(supp), output=str(out), min_confidence="medium")

    web = coordinate_in_memory(TARGET_CSV, SUPP_CSV, min_confidence="medium")

    with open(out, encoding="utf-8-sig", newline="") as f:
        cli_rows = list(csv.reader(f))
    assert cli_rows[0] == web["linked_headers"]
    assert cli_rows[1:] == web["linked_rows"]

    with open(tmp_path / "linked_detail.csv", encoding="utf-8-sig", newline="") as f:
        cli_detail = list(csv.reader(f))
    assert cli_detail[0] == web["detail_headers"]
    assert cli_detail[1:] == web["detail_rows"]
