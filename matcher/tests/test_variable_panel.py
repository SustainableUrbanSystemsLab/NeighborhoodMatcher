"""
Per-variable diagnostics wiring: the `variables` key in web_api results,
the distance_share aggregation, and the CLI's <base>_variables.csv.
"""

import csv
import json

import numpy as np
import pytest

from matcher.pipeline import coordinator
from matcher.web_api import assemble_results, coordinate_in_memory, match_shard

TARGET_CSV = (
    "id,a,b\n"
    "t1,1.0,10.0\n"
    "t2,2.0,20.0\n"
    "t3,3.0,30.0\n"
    "t4,4.0,\n"
)
SUPP_CSV = (
    "a,b,extra\n"
    "1.0,11.0,s1\n"
    "2.1,20.0,s2\n"
    "3.0,30.5,s3\n"
    "9.0,90.0,s4\n"
)


def test_result_carries_variables_in_feature_order():
    res = coordinate_in_memory(TARGET_CSV, SUPP_CSV)
    assert [v["feature"] for v in res["variables"]] == res["feature_names"]
    for v in res["variables"]:
        assert "distance_share" in v
        assert "notes" in v
    json.dumps(res["variables"])


def test_distance_share_single_row_equals_contributions():
    # With exactly one matched target row, the aggregate share must equal
    # that row's contribution vector exactly.
    res = coordinate_in_memory("id,a,b\nt1,1.5,12.0\n", SUPP_CSV)
    [pt] = res["per_target"]
    shares = [v["distance_share"] for v in res["variables"]]
    assert shares == pytest.approx(pt["contributions"])


def test_distance_share_matches_definition():
    # share(f) = sum(contrib[i][f] * d1[i]^2) / sum(d1[i]^2) over matched rows.
    res = coordinate_in_memory(TARGET_CSV, SUPP_CSV)
    num = np.zeros(len(res["feature_names"]))
    total = 0.0
    for pt in res["per_target"]:
        if pt["match_idx"] is None:
            continue
        d_sq = pt["best_distance"] ** 2
        num += np.asarray(pt["contributions"]) * d_sq
        total += d_sq
    expected = num / total
    shares = [v["distance_share"] for v in res["variables"]]
    assert shares == pytest.approx(list(expected))
    assert sum(shares) == pytest.approx(1.0)


def test_distance_share_zero_when_all_matches_exact():
    res = coordinate_in_memory(
        "id,a\nt1,1.0\nt2,2.0\n",
        "a,extra\n1.0,x\n2.0,y\n5.0,z\n",
    )
    assert [v["distance_share"] for v in res["variables"]] == [0.0]


def test_variables_identical_sharded_and_single():
    single = coordinate_in_memory(TARGET_CSV, SUPP_CSV)
    shard_a = match_shard(TARGET_CSV, SUPP_CSV, row_lo=0, row_hi=2)
    shard_b = match_shard(TARGET_CSV, SUPP_CSV, row_lo=2, row_hi=None)
    sharded = assemble_results(TARGET_CSV, SUPP_CSV, [shard_b, shard_a])
    assert sharded["variables"] == single["variables"]


def test_coordinator_writes_variables_csv(tmp_path):
    target = tmp_path / "target.csv"
    supp = tmp_path / "supp.csv"
    target.write_text(TARGET_CSV, encoding="utf-8")
    supp.write_text(SUPP_CSV, encoding="utf-8")
    out = tmp_path / "linked.csv"
    coordinator(str(target), str(supp), output=str(out))

    with open(tmp_path / "linked_variables.csv", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    assert rows[0] == [
        "feature", "target_missing_pct", "supp_missing_pct", "offset_smd",
        "spread_ratio", "distance_share", "notes",
    ]
    assert [r[0] for r in rows[1:]] == ["a", "b"]
    # b is 25% missing in the target file
    b_row = rows[2]
    assert float(b_row[1]) == pytest.approx(25.0)
    # distance_share formatted numeric and sums to ~1 across features
    total_share = sum(float(r[5]) for r in rows[1:])
    assert total_share == pytest.approx(1.0, abs=1e-4)


def test_cli_and_web_distance_share_agree(tmp_path):
    target = tmp_path / "target.csv"
    supp = tmp_path / "supp.csv"
    target.write_text(TARGET_CSV, encoding="utf-8")
    supp.write_text(SUPP_CSV, encoding="utf-8")
    out = tmp_path / "linked.csv"
    coordinator(str(target), str(supp), output=str(out))
    with open(tmp_path / "linked_variables.csv", encoding="utf-8-sig", newline="") as f:
        cli_rows = list(csv.reader(f))[1:]

    web = coordinate_in_memory(TARGET_CSV, SUPP_CSV)
    for cli_row, v in zip(cli_rows, web["variables"]):
        assert float(cli_row[5]) == pytest.approx(v["distance_share"], abs=1e-6)
