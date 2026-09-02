"""
Leave-one-variable-out ablation.

Key correctness fact pinned here: joint z-scoring is per-column, so column
re-slicing of the prepared standardized arrays is equivalent to a fresh run
with that link excluded (the anchor-equivalence tests).

The reproduction fixture mirrors the real-use failure that motivated the
signal: one shared variable mostly missing on the target side collapsed
MNN confirmation (28.2% vs 99.9%) because observed-variable targets beat
missing-variable targets in the reverse search wherever the real
differences were smaller than the missing-data penalty.
"""

import json

import numpy as np
import pytest

from matcher.ablation import (
    ABLATION_MARGIN_PCT,
    ABLATION_MIN_ROWS,
    ablation_sample_indices,
    ablation_suite,
    build_recommendations,
    variant_metrics,
)
from matcher.standardize import dual_standardize
from matcher.web_api import ablation_variant, assemble_ablation, coordinate_in_memory


def _csv(headers, rows):
    lines = [",".join(headers)]
    for row in rows:
        lines.append(",".join("" if v is None else str(v) for v in row))
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Anchor equivalence: re-slice == fresh run with the link excluded
# ---------------------------------------------------------------------------

ANCHOR_T_HEADERS = ["id", "a", "b", "c"]
ANCHOR_T_ROWS = [
    ["t0", 1.0, 50.0, 7.0],
    ["t1", 2.0, None, 9.0],
    ["t2", 3.0, 70.0, 11.0],
    ["t3", 8.0, 90.0, None],
    ["t4", 9.0, 55.0, 13.0],
]
ANCHOR_S_HEADERS = ["a", "b", "c", "extra"]
ANCHOR_S_ROWS = [
    [1.0, 50.0, 7.0, "s0"],
    [2.1, 61.0, 9.0, "s1"],
    [3.0, None, 11.5, "s2"],
    [8.2, 90.0, 12.0, "s3"],
    [9.0, 55.0, 13.0, "s4"],
    [20.0, 200.0, 40.0, "s5"],
]
ANCHOR_TARGET = _csv(ANCHOR_T_HEADERS, ANCHOR_T_ROWS)
ANCHOR_SUPP = _csv(ANCHOR_S_HEADERS, ANCHOR_S_ROWS)
ANCHOR_FEATURES = ["a", "b", "c"]


def _metrics_from_result(res):
    """Derives variant_metrics' fields from a coordinate_in_memory result."""
    matched = [pt for pt in res["per_target"] if pt["match_idx"] is not None]
    nndrs = [pt["nndr"] for pt in matched]
    return {
        "n_rows": res["summary"]["total"],
        "mnn_confirmed": res["summary"]["mnn_confirmed"],
        "no_match": res["summary"]["no_match"],
        "tiers": res["summary"]["tiers"],
        "median_nndr": (float(np.median(nndrs)) if nndrs else None),
        "mean_best_distance": res["summary"]["mean_best_distance"],
    }


@pytest.mark.parametrize("drop", [0, 1, 2])
def test_variant_equals_fresh_run_with_link_excluded(drop):
    filtered_t = [row[1:] for row in ANCHOR_T_ROWS]
    filtered_s = [row[:3] for row in ANCHOR_S_ROWS]
    std1, std2 = dual_standardize(filtered_t, filtered_s)
    variant = variant_metrics(std1, std2, threshold=0.8, drop_index=drop)

    fresh = coordinate_in_memory(
        ANCHOR_TARGET, ANCHOR_SUPP, exclude=[ANCHOR_FEATURES[drop]]
    )
    expected = _metrics_from_result(fresh)

    assert variant["n_rows"] == expected["n_rows"]
    assert variant["mnn_confirmed"] == expected["mnn_confirmed"]
    assert variant["no_match"] == expected["no_match"]
    assert variant["tiers"] == expected["tiers"]
    assert variant["median_nndr"] == pytest.approx(expected["median_nndr"])
    assert variant["mean_best_distance"] == pytest.approx(
        expected["mean_best_distance"]
    )


def test_baseline_variant_matches_full_run():
    filtered_t = [row[1:] for row in ANCHOR_T_ROWS]
    filtered_s = [row[:3] for row in ANCHOR_S_ROWS]
    std1, std2 = dual_standardize(filtered_t, filtered_s)
    variant = variant_metrics(std1, std2, threshold=0.8)
    full = _metrics_from_result(coordinate_in_memory(ANCHOR_TARGET, ANCHOR_SUPP))
    assert variant["mnn_confirmed"] == full["mnn_confirmed"]
    assert variant["tiers"] == full["tiers"]


# ---------------------------------------------------------------------------
# Sampling arithmetic
# ---------------------------------------------------------------------------

def test_sample_full_range_when_budget_allows():
    indices, sampled = ablation_sample_indices(100, m=50, d=3, budget=10**9)
    assert indices == list(range(100))
    assert sampled is False


def test_sample_evenly_spaced_and_deterministic():
    indices, sampled = ablation_sample_indices(
        10_000, m=5_000, d=10, budget=6_000_000_000
    )
    assert sampled is True
    # budget // (5000*10*11) = 10909 -> capped at 2000 rows, first to last.
    assert len(indices) == 2000
    assert indices[0] == 0 and indices[-1] == 9_999
    gaps = {b - a for a, b in zip(indices, indices[1:])}
    assert gaps <= {5, 6}, gaps
    again, _ = ablation_sample_indices(10_000, m=5_000, d=10, budget=6_000_000_000)
    assert again == indices


def test_sample_respects_floor_and_cap():
    # Tiny budget: still samples at least the floor.
    indices, sampled = ablation_sample_indices(10_000, m=10**6, d=20, budget=1)
    assert sampled is True
    assert len(indices) == 200
    # Huge budget: capped at the target cap.
    indices, sampled = ablation_sample_indices(100_000, m=10, d=2, budget=10**18)
    assert sampled is True
    assert len(indices) == 2000


def test_sample_delivers_exact_size_when_n_barely_exceeds_t():
    """
    Regression: range(0, n, ceil(n/t)) returned ~t/2 rows whenever n was just
    above t (201 rows at a 200-row floor gave 101), silently halving the
    sample the verdict margins are calibrated on.
    """
    indices, sampled = ablation_sample_indices(201, m=10**6, d=10, budget=1)
    assert sampled is True
    assert len(indices) == 200
    assert indices[0] == 0 and indices[-1] == 200
    assert len(set(indices)) == len(indices)          # distinct rows
    assert indices == sorted(indices)                 # in file order

    # t just under n from the budget itself: budget // (1e5*10*11) = 545
    indices, sampled = ablation_sample_indices(546, m=10**5, d=10)
    assert sampled is True
    assert len(indices) == 545


def test_sample_empty_targets():
    assert ablation_sample_indices(0, m=10, d=2) == ([], False)


# ---------------------------------------------------------------------------
# Recommendation rule
# ---------------------------------------------------------------------------

def _m(mnn_pct, high_pct, n_rows=100):
    return {
        "n_rows": n_rows,
        "mnn_confirmed_pct": mnn_pct,
        "high_pct": high_pct,
        "tiers": {},
        "no_match": 0,
        "median_nndr": None,
        "mean_best_distance": None,
    }


def test_recommendation_margins_and_veto():
    baseline = _m(50.0, 50.0)
    cases = [
        (_m(50.0 + ABLATION_MARGIN_PCT, 50.0), "consider_excluding"),  # at margin
        (_m(59.9, 50.0), "neutral"),                                   # just under
        (_m(50.0, 62.0), "consider_excluding"),                        # via High%
        (_m(65.0, 50.0 - ABLATION_MARGIN_PCT), "load_bearing"),        # veto -> conservative
        (_m(62.0, 41.0), "consider_excluding"),                        # mild counter-signal ok
        (_m(38.0, 50.0), "load_bearing"),
        (_m(50.0, 50.0), "neutral"),
    ]
    for metrics, expected in cases:
        [rec] = build_recommendations(baseline, [metrics], ["x"])
        assert rec["verdict"] == expected, (metrics, expected)


def test_recommendation_insufficient_rows():
    baseline = _m(20.0, 20.0, n_rows=ABLATION_MIN_ROWS - 1)
    [rec] = build_recommendations(
        baseline, [_m(90.0, 90.0, n_rows=ABLATION_MIN_ROWS - 1)], ["x"]
    )
    assert rec["verdict"] == "insufficient_rows"
    assert rec["delta_mnn_pct"] == pytest.approx(70.0)  # deltas still reported


def test_saturated_baseline_never_flags():
    baseline = _m(100.0, 100.0)
    [rec] = build_recommendations(baseline, [_m(100.0, 100.0)], ["x"])
    assert rec["verdict"] == "neutral"


# ---------------------------------------------------------------------------
# Reproduction of the motivating collapse
# ---------------------------------------------------------------------------

def _collapse_fixture(n=60):
    """
    Three clean shared columns (a, b, c) where target row i matches
    supplemental row i exactly, plus svi_extra: fully observed in the
    supplemental file, observed in the target file only when i % 10 == 0
    (values agreeing with the supplemental side).
    """
    t_rows = []
    s_rows = []
    for i in range(n):
        a = float(i)
        b = 2.0 * i + (i % 3)
        c = 50.0 - i
        svi = 3.0 * i
        t_rows.append([f"t{i}", a, b, c, svi if i % 10 == 0 else None])
        s_rows.append([a, b, c, svi, f"s{i}"])
    target = _csv(["id", "a", "b", "c", "svi_extra"], t_rows)
    supp = _csv(["a", "b", "c", "svi_extra", "extra"], s_rows)
    return target, supp


def test_collapse_fixture_reproduces_mnn_collapse():
    target, supp = _collapse_fixture()
    with_svi = coordinate_in_memory(target, supp)
    without_svi = coordinate_in_memory(target, supp, exclude=["svi_extra"])
    n = with_svi["summary"]["total"]
    assert without_svi["summary"]["mnn_confirmed"] == n
    # With the mostly-missing variable, most reverse searches prefer an
    # observed-svi target over the true partner: confirmation collapses.
    assert with_svi["summary"]["mnn_confirmed"] < n * 0.3


def test_suite_flags_exactly_the_harmful_variable():
    target, supp = _collapse_fixture()
    res = ablation_variant(target, supp)  # baseline payload for shapes
    assert res["sampled"] is False

    variants = [ablation_variant(target, supp, drop_index=i) for i in range(4)]
    report = assemble_ablation(
        [res] + variants, ["a", "b", "c", "svi_extra"], threshold=0.8
    )
    verdicts = {v["feature"]: v["verdict"] for v in report["variables"]}
    assert verdicts["svi_extra"] == "consider_excluding"
    assert all(verdicts[f] != "consider_excluding" for f in ("a", "b", "c"))
    svi = next(v for v in report["variables"] if v["feature"] == "svi_extra")
    assert svi["delta_mnn_pct"] >= 50.0


def test_suite_serial_equals_assembled_variants():
    target, supp = _collapse_fixture()
    filtered_t = [[float(i), 2.0 * i + (i % 3), 50.0 - i,
                   (3.0 * i if i % 10 == 0 else None)] for i in range(60)]
    filtered_s = [[float(i), 2.0 * i + (i % 3), 50.0 - i, 3.0 * i]
                  for i in range(60)]
    std1, std2 = dual_standardize(filtered_t, filtered_s)
    serial = ablation_suite(
        std1, std2, ["a", "b", "c", "svi_extra"], 0.8,
        sample_indices=list(range(60)),
    )

    payloads = [ablation_variant(target, supp)] + [
        ablation_variant(target, supp, drop_index=i) for i in range(4)
    ]
    assembled = assemble_ablation(payloads, ["a", "b", "c", "svi_extra"])
    assert assembled["baseline"] == serial["baseline"]
    assert assembled["variables"] == serial["variables"]


def test_load_bearing_variable_detected():
    # One discriminating variable + one constant: dropping the constant
    # changes nothing; dropping the discriminator collapses everything into
    # ties.
    n = 60
    t_rows = [[f"t{i}", float(i), 1.0] for i in range(n)]
    s_rows = [[float(i), 1.0, f"s{i}"] for i in range(n)]
    target = _csv(["id", "a", "flat"], t_rows)
    supp = _csv(["a", "flat", "extra"], s_rows)

    payloads = [ablation_variant(target, supp)] + [
        ablation_variant(target, supp, drop_index=i) for i in range(2)
    ]
    report = assemble_ablation(payloads, ["a", "flat"])
    verdicts = {v["feature"]: v["verdict"] for v in report["variables"]}
    assert verdicts["a"] == "load_bearing"
    assert verdicts["flat"] == "neutral"


# ---------------------------------------------------------------------------
# Assembly validation and payloads
# ---------------------------------------------------------------------------

def _small_payloads():
    target, supp = _collapse_fixture(12)
    return [ablation_variant(target, supp)] + [
        ablation_variant(target, supp, drop_index=i) for i in range(4)
    ]


def test_assemble_is_order_independent():
    payloads = _small_payloads()
    forward = assemble_ablation(payloads, ["a", "b", "c", "svi_extra"])
    reverse = assemble_ablation(payloads[::-1], ["a", "b", "c", "svi_extra"])
    assert forward == reverse


def test_assemble_rejects_bad_version():
    payloads = _small_payloads()
    payloads[1] = dict(payloads[1], ablation_version=99)
    with pytest.raises(ValueError, match="engine version"):
        assemble_ablation(payloads, ["a", "b", "c", "svi_extra"])


def test_assemble_rejects_threshold_mismatch():
    payloads = _small_payloads()
    with pytest.raises(ValueError, match="threshold"):
        assemble_ablation(payloads, ["a", "b", "c", "svi_extra"], threshold=0.5)


def test_assemble_rejects_sample_mismatch():
    payloads = _small_payloads()
    payloads[2] = dict(payloads[2], sample_size=999)
    with pytest.raises(ValueError, match="sample"):
        assemble_ablation(payloads, ["a", "b", "c", "svi_extra"])


def test_assemble_rejects_missing_or_duplicate_variants():
    payloads = _small_payloads()
    with pytest.raises(ValueError, match="baseline"):
        assemble_ablation(payloads[1:], ["a", "b", "c", "svi_extra"])
    with pytest.raises(ValueError, match="cover"):
        assemble_ablation(payloads[:-1], ["a", "b", "c", "svi_extra"])


def test_variant_payload_is_json_safe():
    target, supp = _collapse_fixture(12)
    payload = ablation_variant(target, supp, drop_index=1)
    json.dumps(payload)
    assert payload["drop_feature"] == "b"


def test_variant_rejects_single_feature_and_bad_drop_index():
    target = "id,a\nt0,1.0\nt1,2.0\n"
    supp = "a,extra\n1.0,x\n2.0,y\n"
    with pytest.raises(ValueError, match="at least two linked variables"):
        ablation_variant(target, supp)
    t2, s2 = _collapse_fixture(6)
    with pytest.raises(ValueError, match="drop_index"):
        ablation_variant(t2, s2, drop_index=4)


# ---------------------------------------------------------------------------
# CLI integration
# ---------------------------------------------------------------------------

def test_coordinator_ablation_writes_csv_and_prints_table(tmp_path, capsys):
    from matcher.pipeline import coordinator

    target_csv, supp_csv = _collapse_fixture()
    target = tmp_path / "target.csv"
    supp = tmp_path / "supp.csv"
    target.write_text(target_csv, encoding="utf-8")
    supp.write_text(supp_csv, encoding="utf-8")
    out = tmp_path / "linked.csv"
    coordinator(str(target), str(supp), output=str(out), ablation=True)

    import csv as _csv
    with open(tmp_path / "linked_ablation.csv", encoding="utf-8-sig", newline="") as f:
        rows = list(_csv.reader(f))
    assert rows[0] == [
        "feature", "sample_size", "sampled", "baseline_mnn_pct",
        "mnn_pct_without", "delta_mnn_pct", "baseline_high_pct",
        "high_pct_without", "delta_high_pct", "median_nndr_without",
        "no_match_without", "verdict",
    ]
    by_feature = {r[0]: r for r in rows[1:]}
    assert by_feature["svi_extra"][-1] == "consider_excluding"

    printed = capsys.readouterr().out
    assert "Variable ablation" in printed
    assert "consider excluding" in printed


def test_coordinator_ablation_default_off_writes_no_csv(tmp_path):
    from matcher.pipeline import coordinator

    target_csv, supp_csv = _collapse_fixture(6)
    target = tmp_path / "target.csv"
    supp = tmp_path / "supp.csv"
    target.write_text(target_csv, encoding="utf-8")
    supp.write_text(supp_csv, encoding="utf-8")
    out = tmp_path / "linked.csv"
    coordinator(str(target), str(supp), output=str(out))
    assert not (tmp_path / "linked_ablation.csv").exists()
