"""
Output completion: missing target cells in SHARED columns are filled from
the matched supplemental row (raw value verbatim) and recorded in the
filled_from_match provenance column. Matching itself never imputes — this
runs after the match, in the emit loop only.
"""

import pytest

from matcher.web_api import assemble_results, coordinate_in_memory, match_shard


# t2: blank a → fillable. t3: 'NA' token b → fillable. t4: all-missing → no match.
TARGET_CSV = """pid,a,b
t1,10,100
t2,,205
t3,31,NA
t4,,
"""

# g4 is missing a — a target matched to it cannot fill a from it.
SUPP_CSV = """geo,a,b,extra
g1,10,100,w
g2,"20,5",205,x
g3,31,310,y
g4,,205,z
"""


def _linked_cell(result, row, col_name):
    return result["linked_rows"][row][result["linked_headers"].index(col_name)]


@pytest.fixture(scope="module")
def result():
    return coordinate_in_memory(TARGET_CSV, SUPP_CSV, threshold=0.8)


def test_observed_cells_untouched(result):
    assert _linked_cell(result, 0, "a") == "10"
    assert _linked_cell(result, 0, "b") == "100"
    assert _linked_cell(result, 0, "filled_from_match") == ""


def test_blank_cell_filled_with_raw_supplemental_string(result):
    row = result["per_target"][1]
    assert row["match_idx"] == 1  # g2 (b=205 exact)
    # Raw cell verbatim — "20,5" keeps its comma, no numeric reformatting.
    assert _linked_cell(result, 1, "a") == "20,5"
    assert _linked_cell(result, 1, "filled_from_match") == "a"
    assert row["filled_from_match"] == ["a"]


def test_na_token_cell_filled(result):
    row = result["per_target"][2]
    assert row["match_idx"] == 2  # g3 (a=31 exact)
    assert _linked_cell(result, 2, "b") == "310"
    assert _linked_cell(result, 2, "filled_from_match") == "b"


def test_no_match_row_not_filled(result):
    assert result["per_target"][3]["no_match"] is True
    assert _linked_cell(result, 3, "a") == ""
    assert _linked_cell(result, 3, "b") == ""
    assert _linked_cell(result, 3, "filled_from_match") == ""


def test_supplemental_missing_cell_stays_blank():
    # Force t2 to match g4 (b=205, a missing on both sides): drop g2/g3.
    supp = """geo,a,b,extra
g1,10,100,w
g4,,205,z
"""
    result = coordinate_in_memory(TARGET_CSV, supp, threshold=0.8)
    row = result["per_target"][1]
    assert row["match_idx"] == 1  # g4
    assert _linked_cell(result, 1, "a") == ""  # nothing to fill from
    assert _linked_cell(result, 1, "filled_from_match") == ""


def test_provenance_lists_columns_in_shared_order():
    # a and b missing, c observed — the match runs on c alone and both
    # missing cells are filled, listed in shared-column order.
    target = """pid,a,b,c
t1,,,50
"""
    supp = """geo,a,b,c
g1,7,8,50
"""
    result = coordinate_in_memory(target, supp, threshold=0.8)
    assert result["per_target"][0]["no_match"] is False
    assert _linked_cell(result, 0, "filled_from_match") == "a; b"
    assert _linked_cell(result, 0, "a") == "7"
    assert _linked_cell(result, 0, "b") == "8"


def test_rejected_row_not_filled():
    target = """pid,a,b
t1,10,100
t2,1000,9999
"""
    supp = """geo,a,b
g1,10,100
g2,20,
"""
    result = coordinate_in_memory(target, supp, threshold=0.8, max_distance=1.0)
    row = result["per_target"][1]
    assert row["rejected"] is True
    assert _linked_cell(result, 1, "filled_from_match") == ""


def test_reserved_name_collision_warns():
    # Shared columns must be numeric; the reserved-name warning is about
    # the header, so the values are plain numbers here.
    target = """pid,filled_from_match,a
t1,1,10
"""
    supp = """geo,filled_from_match,a
g1,1,10
"""
    result = coordinate_in_memory(target, supp, threshold=0.8)
    assert any("filled_from_match" in w for w in result["warnings"])


def test_sharded_equals_single_with_fills():
    shards = [
        match_shard(TARGET_CSV, SUPP_CSV, threshold=0.8, row_lo=lo, row_hi=hi)
        for lo, hi in ((0, 2), (2, 4))
    ]
    sharded = assemble_results(TARGET_CSV, SUPP_CSV, shards, threshold=0.8)
    single = coordinate_in_memory(TARGET_CSV, SUPP_CSV, threshold=0.8)
    assert sharded == single
