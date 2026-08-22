"""
variable_report / variable_warnings — per-variable input diagnostics.

The definition-shift check (offset SMD) targets a failure mode reported
from real researcher use: a shared column coded differently in the two
files (poverty measured against 100% vs 180% of the poverty line) has a
similar spread but a systematically shifted mean, passes the spread-ratio
scale check, and silently degrades every match under joint z-scoring.
"""

import json
import math

import pytest

from matcher.signals import (
    variable_report,
    variable_warnings,
    OFFSET_SMD_WARN,
    VARIABLE_WARN_MIN_OBSERVED,
)


def _rows(*cols):
    """Transposes column lists into rows-of-features."""
    return [list(row) for row in zip(*cols)]


def test_offset_smd_hand_computed():
    # target mean 13, supp mean 23, both sample variance 20/3 (ddof=1)
    target = _rows([10.0, 12.0, 14.0, 16.0])
    supp = _rows([20.0, 22.0, 24.0, 26.0])
    [row] = variable_report(target, supp, ["a"])
    pooled_sd = math.sqrt(20.0 / 3.0)
    assert row["offset_smd"] == pytest.approx(10.0 / pooled_sd)
    assert row["target_mean"] == pytest.approx(13.0)
    assert row["supp_mean"] == pytest.approx(23.0)
    assert row["spread_ratio"] == pytest.approx(1.0)


def test_poverty_style_shift_is_noted_but_scale_check_silent():
    # Same spread, shifted mean — the pattern the spread-ratio check misses.
    target = _rows([12.0, 14.0, 16.0, 18.0])          # ~100% FPL rates
    supp = _rows([26.0, 28.0, 30.0, 32.0])            # ~180% FPL rates
    [row] = variable_report(target, supp, ["pct_poverty"])
    assert row["offset_smd"] >= OFFSET_SMD_WARN
    assert "definition/coding difference" in row["notes"]
    assert row["spread_ratio"] == pytest.approx(1.0)  # scale check sees nothing


def test_missing_pct_and_high_missingness_note():
    target = _rows([1.0, None, None, None])           # 75% missing
    supp = _rows([1.0, 2.0, 3.0, 4.0])
    [row] = variable_report(target, supp, ["a"])
    assert row["target_missing"] == 3
    assert row["target_missing_pct"] == pytest.approx(75.0)
    assert row["supp_missing_pct"] == pytest.approx(0.0)
    assert "high missingness (target 75%)" in row["notes"]


def test_scale_mismatch_note():
    target = _rows([0.0, 1.0, 2.0, 3.0])
    supp = _rows([0.0, 1000.0, 2000.0, 3000.0])
    [row] = variable_report(target, supp, ["a"])
    assert "scale mismatch" in row["notes"]


def test_all_missing_side_yields_none_stats():
    target = _rows([None, None])
    supp = _rows([1.0, 2.0])
    [row] = variable_report(target, supp, ["a"])
    assert row["target_mean"] is None
    assert row["offset_smd"] is None
    assert row["target_observed"] == 0


def test_constant_columns_equal_and_different():
    equal_t = _rows([5.0, 5.0])
    equal_s = _rows([5.0, 5.0])
    [row] = variable_report(equal_t, equal_s, ["a"])
    assert row["offset_smd"] == 0.0
    assert row["notes"] == ""

    diff_s = _rows([9.0, 9.0])
    [row] = variable_report(equal_t, diff_s, ["a"])
    assert row["offset_smd"] is None
    assert "constant in both files but with different values" in row["notes"]


def test_report_is_json_safe():
    target = _rows([1.0, None], [5.0, 5.0])
    supp = _rows([2.0, 3.0], [9.0, 9.0])
    report = variable_report(target, supp, ["a", "b"])
    json.dumps(report)  # would raise on numpy scalars


def test_warning_gate_on_observed_count():
    # 10-point shift on unit-variance-ish data — offset SMD far above the
    # threshold. Warning must fire at >= min_n observed on both sides and
    # stay silent below it.
    n = VARIABLE_WARN_MIN_OBSERVED
    target_vals = [float(i % 5) for i in range(n)]
    supp_vals = [10.0 + (i % 5) for i in range(n)]

    report = variable_report(_rows(target_vals), _rows(supp_vals), ["a"])
    assert len(variable_warnings(report)) == 1
    assert "define and code it the same way" in variable_warnings(report)[0]

    report_small = variable_report(
        _rows(target_vals[: n - 1]), _rows(supp_vals), ["a"]
    )
    assert variable_warnings(report_small) == []


def test_no_warning_below_offset_threshold():
    n = VARIABLE_WARN_MIN_OBSERVED
    vals = [float(i % 7) for i in range(n)]
    report = variable_report(_rows(vals), _rows(vals), ["a"])
    assert report[0]["offset_smd"] == pytest.approx(0.0)
    assert variable_warnings(report) == []


def test_report_preserves_feature_order():
    target = _rows([1.0, 2.0], [3.0, 4.0], [5.0, 6.0])
    supp = _rows([1.0, 2.0], [3.0, 4.0], [5.0, 6.0])
    report = variable_report(target, supp, ["x", "y", "z"])
    assert [r["feature"] for r in report] == ["x", "y", "z"]
