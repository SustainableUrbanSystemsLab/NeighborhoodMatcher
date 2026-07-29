"""
Edge cases surfaced by the July 2026 repo sweep — parameter validation,
API misuse, adversarial-but-realistic data. Each test pins behavior that
was empirically probed; several capture bugs found (and fixed) during the
sweep: shard-order crashes with empty shards, near_miss = -1 at
out-of-domain thresholds, negative link indices silently matching the
wrong column, float-dust repelling exact-twin matches, and 1e308 values
silently zeroing a column.
"""

import csv
import json

import numpy as np
import pytest

from matcher.align import find_common_headers, header_warnings
from matcher.distance import compute_sorted_distances, match_all, validate_threshold
from matcher.io import clean_val, load_csv
from matcher.pipeline import coordinator
from matcher.signals import cascading_nndr
from matcher.standardize import dual_standardize, scale_compatibility_warnings
from matcher.web_api import assemble_results, coordinate_in_memory, match_shard


T_CSV = "pid,a,b\nt1,10,100\nt2,20,200\nt3,30,300\nt4,40,400\nt5,50,500\nt6,60,600\n"
S_CSV = "geo,a,b\ng1,10,100\ng2,20,200\ng3,30,300\ng4,90,900\n"


def _write_csv(tmp_path, name, headers, rows):
    path = tmp_path / name
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(headers)
        w.writerows(rows)
    return str(path)


# ── threshold domain ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", [0, -1, 1.5, float("nan"), float("inf"), "0.8"])
def test_threshold_out_of_domain_rejected_everywhere(tmp_path, bad):
    with pytest.raises(ValueError, match="threshold"):
        coordinate_in_memory(T_CSV, S_CSV, threshold=bad)
    with pytest.raises(ValueError, match="threshold"):
        match_shard(T_CSV, S_CSV, threshold=bad)
    with pytest.raises(ValueError, match="threshold"):
        assemble_results(T_CSV, S_CSV, [], threshold=bad)
    target = _write_csv(tmp_path, "t.csv", ["a"], [["1"]])
    supp = _write_csv(tmp_path, "s.csv", ["a"], [["1"]])
    with pytest.raises(ValueError, match="threshold"):
        coordinator(target, supp, output=str(tmp_path / "o.csv"), threshold=bad)


def test_threshold_one_is_legal_ties_only_mode():
    """threshold=1.0 counts exact ties only — and engine matches spec there."""
    res = coordinate_in_memory(T_CSV, S_CSV, threshold=1.0)
    assert all(p["near_miss"] >= 0 for p in res["per_target"])
    targets = np.array([[0.0]])
    refs = np.array([[1.0], [1.0], [2.0]])
    got = match_all(targets, refs, threshold=1.0)
    sorted_dists, _, _ = compute_sorted_distances(targets[0], refs)
    want_nndr, want_near = cascading_nndr(sorted_dists, threshold=1.0)
    assert got["near_miss"][0] == want_near == 1
    assert got["nndr"][0] == want_nndr


def test_engine_near_miss_clamped_even_for_raw_out_of_domain_threshold():
    """Belt-and-braces: match_all called directly (validation bypassed) must
    never emit a negative near-miss count."""
    got = match_all(np.array([[0.0]]), np.array([[1.0], [2.0]]), threshold=1.5)
    assert got["near_miss"][0] >= 0


# ── clean_val numerics ───────────────────────────────────────────────────────

def test_clean_val_magnitude_cap():
    with pytest.raises(ValueError, match="too large"):
        clean_val("1e308")
    assert clean_val("1e99") == 1e99


def test_clean_val_nonfinite_parse_message():
    with pytest.raises(ValueError, match="not a finite number"):
        clean_val("Infinity")


@pytest.mark.parametrize("cell,expected", [
    ("1,23,4", 1234.0),   # malformed grouping: commas stripped globally (documented)
    ("3,14", 314.0),      # European decimal comma hazard — documented, deliberate
    ("$-5", -5.0),
    ("-$5", -5.0),
    ("+42", 42.0),
    ("1_000", 1000.0),    # PEP 515 underscores parse — pinned, deterministic
    ("１２３", 123.0),     # full-width digits: CPython float() accepts Unicode Nd
])
def test_clean_val_documented_parse_quirks(cell, expected):
    assert clean_val(cell) == expected


@pytest.mark.parametrize("cell", [",", "$", "$,", "   "])
def test_clean_val_stripped_to_nothing_is_missing(cell):
    """Strip-then-token order: cells that strip to '' are treated as missing."""
    assert clean_val(cell) is None


# ── float dust and overflow ──────────────────────────────────────────────────

def test_float_dust_column_does_not_repel_exact_twin():
    """A 1e-13 rounding artifact in an otherwise-constant column must not
    blow up into z-units and flip the match away from the exact twin."""
    t = "id,a,b\nT1,5.0,10\n"
    s = ("sid,a,b\n"
         "TWIN,5.0000000000001,10\n"
         "NEAR,5.0,10.5\n"
         "F1,5.0,50\n"
         "F2,5.0,50\n")
    res = coordinate_in_memory(t, s)
    assert res["per_target"][0]["match_idx"] == 0  # TWIN, not NEAR


def test_huge_values_warn_instead_of_silently_zeroing(tmp_path):
    """Direct standardize API: deviations beyond sqrt(DBL_MAX) overflow the
    variance; the scale check must say so instead of staying silent."""
    f1, f2 = [[1e200], [-1e200]], [[1e200], [0.0]]
    warnings = scale_compatibility_warnings(f1, f2, ["big"])
    assert any("too large to standardize" in w for w in warnings)
    # And the pipeline path is closed off at ingestion (magnitude cap):
    target = _write_csv(tmp_path, "t.csv", ["a"], [["1e300"]])
    supp = _write_csv(tmp_path, "s.csv", ["a"], [["1"]])
    with pytest.raises(ValueError, match="too large"):
        coordinator(target, supp, output=str(tmp_path / "o.csv"))


# ── header normalization and hints ───────────────────────────────────────────

def test_headers_link_across_unicode_noise():
    assert find_common_headers(["re​nt"], ["rent"])          # zero-width space
    assert find_common_headers(["caf\xe9"], ["café"])       # NFC vs NFD
    assert find_common_headers(["median rent"], ["median rent"])  # NBSP


def test_no_shared_columns_hints_case_and_delimiter():
    with pytest.raises(ValueError, match="differ only by letter case"):
        coordinate_in_memory("name,Rent\nA,1\n", "sname,rent\nB,1\n")
    with pytest.raises(ValueError, match="semicolon-delimited"):
        coordinate_in_memory("a;b;c\n1;2;3\n", "a,b,c\n1,2,3\n")


def test_case_mismatch_warns_even_when_other_columns_link():
    res = coordinate_in_memory(
        "pid,a,Rent\nt1,1,5\n", "geo,a,rent\ng1,1,5\ng2,2,9\n"
    )
    assert any("differ only by letter case" in w for w in res["warnings"])


def test_refed_linked_output_triggers_reserved_column_warning(tmp_path):
    """Feeding a previous run's linked output back in is the classic way to
    silently match on diagnostic columns — the run must warn."""
    warnings = header_warnings(
        ["pid", "a", "euc_distance", "nndr"], ["geo", "a", "euc_distance", "nndr"],
        ["a", "euc_distance", "nndr"],
    )
    assert any("output columns" in w for w in warnings)
    res = coordinate_in_memory(
        "pid,a,nndr\nt1,1,0.5\n", "geo,a,nndr\ng1,1,0.5\ng2,2,0.9\n"
    )
    assert any("output columns" in w for w in res["warnings"])


def test_constant_vs_varying_column_warns():
    warnings = scale_compatibility_warnings(
        [[5.0], [5.0]], [[1.0], [9.0]], ["mystery"]
    )
    assert any("constant in the target file" in w for w in warnings)


# ── exclude parameter ────────────────────────────────────────────────────────

def test_exclude_rejects_bare_string(tmp_path):
    with pytest.raises(TypeError, match="exclude"):
        find_common_headers(["rent", "a"], ["rent", "a"], exclude="rent")
    target = _write_csv(tmp_path, "t.csv", ["rent", "a"], [["1", "2"]])
    supp = _write_csv(tmp_path, "s.csv", ["rent", "a"], [["1", "2"]])
    with pytest.raises(TypeError, match="exclude"):
        coordinator(target, supp, output=str(tmp_path / "o.csv"), exclude="rent")


def test_excluding_every_shared_column_hits_no_shared_guard(tmp_path):
    target = _write_csv(tmp_path, "t.csv", ["a", "b"], [["1", "2"]])
    supp = _write_csv(tmp_path, "s.csv", ["a", "b"], [["1", "2"]])
    with pytest.raises(ValueError, match="No shared columns"):
        coordinator(target, supp, output=str(tmp_path / "o.csv"),
                    exclude=["  a  ", "b", "not_a_column"])


# ── links validation (web API) ───────────────────────────────────────────────

def test_negative_link_index_rejected():
    """JS indexOf() returns -1 for not-found; it must never index from the end."""
    with pytest.raises(ValueError, match="out of range"):
        coordinate_in_memory(
            "pid,a,b\nt1,10,999\n", "geo,a\ng1,999\ng2,10\n",
            links=[{"headerName": "a", "header1Index": -1, "header2Index": 1}])


def test_out_of_range_link_index_rejected_with_context():
    with pytest.raises(ValueError, match="out of range"):
        coordinate_in_memory(
            "pid,a\nt1,10\n", "geo,a\ng1,10\n",
            links=[{"headerName": "a", "header1Index": 9, "header2Index": 1}])


def test_non_integer_link_index_rejected():
    with pytest.raises(ValueError, match="not an integer"):
        coordinate_in_memory(
            T_CSV, S_CSV,
            links=[{"headerName": "a", "header1Index": 1.9, "header2Index": 1}])


def test_empty_link_name_rejected():
    with pytest.raises(ValueError, match="empty column name"):
        coordinate_in_memory(
            T_CSV, S_CSV,
            links=[{"headerName": "  ", "header1Index": 1, "header2Index": 1}])


def test_duplicate_link_name_and_index_rejected():
    dup_idx = [{"headerName": "a", "header1Index": 1, "header2Index": 1},
               {"headerName": "b", "header1Index": 2, "header2Index": 1}]
    dup_name = [{"headerName": "a", "header1Index": 1, "header2Index": 1},
                {"headerName": "a", "header1Index": 2, "header2Index": 2}]
    for links in (dup_idx, dup_name):
        with pytest.raises(ValueError, match="Ambiguous column links"):
            coordinate_in_memory(T_CSV, S_CSV, links=links)


# ── shard API misuse ─────────────────────────────────────────────────────────

def test_empty_shards_assemble_in_any_order():
    """Pool > row count yields empty shards sharing a row_lo with a real
    shard; workers finish in nondeterministic order. (Regression: sorting
    by row_lo alone crashed on the reversed order.)"""
    single = coordinate_in_memory(T_CSV, S_CSV, threshold=0.8)
    shards = [match_shard(T_CSV, S_CSV, row_lo=lo, row_hi=hi)
              for lo, hi in [(0, 2), (2, 2), (2, 6)]]
    assert assemble_results(T_CSV, S_CSV, shards) == single
    assert assemble_results(T_CSV, S_CSV, list(reversed(shards))) == single


@pytest.mark.parametrize("lo,hi", [(-1, 2), (2, 1), (0, 99)])
def test_invalid_shard_ranges_rejected(lo, hi):
    with pytest.raises(ValueError, match="invalid shard range"):
        match_shard(T_CSV, S_CSV, row_lo=lo, row_hi=hi)


def test_foreign_shard_rejected():
    foreign = match_shard(T_CSV, "geo,a,b\nx,1,2\n", row_lo=0, row_hi=6)
    with pytest.raises(ValueError, match="col_min"):
        assemble_results(T_CSV, S_CSV, [foreign])


def test_truncated_shard_payload_rejected():
    shard = match_shard(T_CSV, S_CSV, row_lo=0, row_hi=6)
    shard["nndr"] = shard["nndr"][:-1]
    with pytest.raises(ValueError, match="truncated or corrupted"):
        assemble_results(T_CSV, S_CSV, [shard])


def test_threshold_mismatched_shard_rejected():
    shard = match_shard(T_CSV, S_CSV, threshold=0.9)
    with pytest.raises(ValueError, match="recompute the shards"):
        assemble_results(T_CSV, S_CSV, [shard], threshold=0.5)


# ── result-dict discipline ───────────────────────────────────────────────────

def test_assembled_result_is_json_safe_even_with_single_supplemental_row():
    """M == 1 means no second distance exists; the result must encode that
    as None (JSON-safe), never NaN."""
    res = coordinate_in_memory("pid,a\nt1,10\n", "geo,a\ng1,12\n")
    json.dumps(res, allow_nan=False)  # raises on any NaN/inf leakage
    assert res["per_target"][0]["second_distance"] is None


# ── degenerate-but-legal data, end to end ────────────────────────────────────

def test_single_row_each_side_end_to_end(tmp_path):
    target = _write_csv(tmp_path, "t.csv", ["a", "b"], [["10", "100"]])
    supp = _write_csv(tmp_path, "s.csv", ["a", "b"], [["12", "120"]])
    out = str(tmp_path / "o.csv")
    coordinator(target, supp, output=out)
    headers, rows = load_csv(out)
    assert rows[0][headers.index("nndr")] == "0.0"
    assert rows[0][headers.index("flags")] == ""


def test_all_rows_identical_is_flagged_maximally_ambiguous(tmp_path):
    target = _write_csv(tmp_path, "t.csv", ["a"], [["5"], ["5"]])
    supp = _write_csv(tmp_path, "s.csv", ["a"], [["5"], ["5"], ["5"]])
    out = str(tmp_path / "o.csv")
    coordinator(target, supp, output=out)
    headers, rows = load_csv(out)
    flags = rows[0][headers.index("flags")]
    assert "ambiguous match" in flags and "3 exact-distance tie(s)" in flags
    assert rows[0][headers.index("near_miss_count")] == "2"


def test_quoted_comma_newline_cells_survive_roundtrip(tmp_path):
    target = _write_csv(tmp_path, "t.csv", ["a"], [["10"]])
    supp = _write_csv(tmp_path, "s.csv", ["a", "notes"],
                      [["10", "123 Main St, Apt 2\nSecond line"]])
    out = str(tmp_path / "o.csv")
    coordinator(target, supp, output=out)
    headers, rows = load_csv(out)
    assert rows[0][headers.index("notes")] == "123 Main St, Apt 2\nSecond line"


def test_single_finite_candidate_is_confident():
    """d2 = inf (only one row shares observed features) mirrors the
    single-row case: maximally confident, zero near misses."""
    nndr, near_miss = cascading_nndr(np.array([2.0, np.inf]))
    assert (nndr, near_miss) == (0.0, 0)


def test_hist_bins_and_top_k_nonpositive_is_clean_skip():
    p = coordinate_in_memory(T_CSV, S_CSV, hist_bins=0, top_k=-5)["per_target"][0]
    assert p["hist_counts"] == [] and p["top_k_distances"] == []


# ── error message quality ────────────────────────────────────────────────────

def test_parse_error_cites_original_line_after_interior_blanks(tmp_path):
    path = tmp_path / "t.csv"
    path.write_text("a,b\n1,2\n\n\nbad,3\n")
    supp = _write_csv(tmp_path, "s.csv", ["a", "b"], [["1", "2"]])
    with pytest.raises(ValueError, match="line 5"):
        coordinator(str(path), supp, output=str(tmp_path / "o.csv"))


def test_empty_web_csv_says_empty_not_no_shared_columns():
    with pytest.raises(ValueError, match="file is empty"):
        coordinate_in_memory("", S_CSV)


def test_coordinator_refuses_to_overwrite_inputs(tmp_path):
    target = _write_csv(tmp_path, "t.csv", ["a"], [["1"]])
    supp = _write_csv(tmp_path, "s.csv", ["a"], [["1"]])
    with pytest.raises(ValueError, match="overwrite an input"):
        coordinator(target, supp, output=target)


def test_coordinator_fails_fast_on_missing_output_directory(tmp_path):
    target = _write_csv(tmp_path, "t.csv", ["a"], [["1"]])
    supp = _write_csv(tmp_path, "s.csv", ["a"], [["1"]])
    with pytest.raises(ValueError, match="output directory"):
        coordinator(target, supp, output=str(tmp_path / "nope" / "o.csv"))


def test_dual_standardize_accepts_numpy_arrays():
    """np.vstack semantics: array inputs must stack rows, never add
    elementwise (list + would concatenate; array + would broadcast)."""
    s1, s2 = dual_standardize(np.array([[1.0, 2.0]]), np.array([[3.0, 4.0]]))
    assert s1.shape == (1, 2) and s2.shape == (1, 2)
    assert not np.allclose(s1, s2)
