import csv

import pytest
from matcher.pipeline import coordinator


def _write_csv(tmp_path, name, headers, rows):
    path = tmp_path / name
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(headers)
        w.writerows(rows)
    return str(path)


def _read_csv(path):
    with open(path, newline="") as f:
        data = list(csv.reader(f))
    return data[0], data[1:]


@pytest.fixture
def small_run(tmp_path):
    """Two shared columns; supplemental row 0 is an exact match for target 0."""
    target = _write_csv(tmp_path, "target.csv",
                        ["pid", "a", "b"],
                        [["t1", "10", "100"],
                         ["t2", "20", "200"]])
    supp = _write_csv(tmp_path, "supp.csv",
                      ["geo", "a", "b", "extra"],
                      [["g1", "10", "100", "x"],
                       ["g2", "20", "200", "y"],
                       ["g3", "90", "900", "z"]])
    out = str(tmp_path / "out.csv")
    return target, supp, out


def test_coordinator_end_to_end(small_run):
    target, supp, out = small_run
    warnings = coordinator(target, supp, output=out)
    assert warnings == []
    headers, rows = _read_csv(out)
    assert len(rows) == 2
    dist_col = headers.index("euc_distance")
    assert float(rows[0][dist_col]) == 0.0  # exact match


def test_mnn_flag_reaches_flags_column(tmp_path):
    """Two targets whose best supplemental row is the same; the losing target
    must carry the MNN flag in the flags STRING, not only the column
    (regression: the flag text was silently dropped in the CLI pipeline)."""
    target = _write_csv(tmp_path, "t.csv", ["a"],
                        [["10"], ["11"], ["30"], ["50"], ["70"]])
    supp = _write_csv(tmp_path, "s.csv", ["a", "tag"],
                      [["10", "g1"], ["31", "g2"], ["51", "g3"], ["71", "g4"]])
    out = str(tmp_path / "o.csv")
    coordinator(target, supp, output=out)
    headers, rows = _read_csv(out)
    mnn_col = headers.index("mnn_confirmed")
    flags_col = headers.index("flags")
    unconfirmed = [r for r in rows if r[mnn_col] == "0"]
    assert unconfirmed, "expected at least one MNN-unconfirmed row"
    for r in unconfirmed:
        assert "MNN not confirmed" in r[flags_col]


def test_missing_target_features_are_flagged(tmp_path):
    target = _write_csv(tmp_path, "t.csv", ["a", "b"],
                        [["10", ""], ["20", "200"]])
    supp = _write_csv(tmp_path, "s.csv", ["a", "b"],
                      [["10", "100"], ["20", "200"], ["90", "900"]])
    out = str(tmp_path / "o.csv")
    coordinator(target, supp, output=out)
    headers, rows = _read_csv(out)
    flags_col = headers.index("flags")
    assert "missing 1 of 2 shared feature(s)" in rows[0][flags_col]
    assert "missing" not in rows[1][flags_col]


def test_all_missing_target_is_no_match_not_confident(tmp_path):
    """An all-blank target must NOT silently 'exact-match' anything
    (regression: zero-fill matched it at distance 0 with no flags)."""
    target = _write_csv(tmp_path, "t.csv", ["a", "b"],
                        [["", ""], ["20", "200"]])
    supp = _write_csv(tmp_path, "s.csv", ["a", "b"],
                      [["10", "100"], ["20", "200"], ["90", "900"]])
    out = str(tmp_path / "o.csv")
    coordinator(target, supp, output=out)
    headers, rows = _read_csv(out)
    flags_col = headers.index("flags")
    dist_col = headers.index("euc_distance")
    assert "no valid match" in rows[0][flags_col]
    assert rows[0][dist_col] == ""  # no fabricated distance


def test_all_missing_supplemental_rows_never_matched(tmp_path):
    """All-blank supplemental rows (Census-suppressed) must not act as an
    attractor for anything."""
    target = _write_csv(tmp_path, "t.csv", ["a", "b"],
                        [["10", "100"], ["25", "250"]])
    supp = _write_csv(tmp_path, "s.csv", ["a", "b", "geo"],
                      [["", "", "blank1"], ["", "", "blank2"],
                       ["12", "120", "real1"], ["24", "240", "real2"]])
    out = str(tmp_path / "o.csv")
    coordinator(target, supp, output=out)
    headers, rows = _read_csv(out)
    geo_col = headers.index("geo")
    assert {rows[0][geo_col], rows[1][geo_col]} == {"real1", "real2"}


def test_no_shared_columns_raises(tmp_path):
    target = _write_csv(tmp_path, "t.csv", ["a"], [["1"]])
    supp = _write_csv(tmp_path, "s.csv", ["b"], [["1"]])
    with pytest.raises(ValueError, match="No shared columns"):
        coordinator(target, supp, output=str(tmp_path / "o.csv"))


def test_empty_target_rows_raises(tmp_path):
    target = _write_csv(tmp_path, "t.csv", ["a"], [])
    supp = _write_csv(tmp_path, "s.csv", ["a"], [["1"]])
    with pytest.raises(ValueError, match="no rows"):
        coordinator(target, supp, output=str(tmp_path / "o.csv"))


def test_parse_error_names_file_line_and_column(tmp_path):
    target = _write_csv(tmp_path, "t.csv", ["a", "b"],
                        [["1", "2"], ["oops", "3"]])
    supp = _write_csv(tmp_path, "s.csv", ["a", "b"], [["1", "2"]])
    with pytest.raises(ValueError, match=r"line 3, column 'a'.*'oops'"):
        coordinator(target, supp, output=str(tmp_path / "o.csv"))


def test_scale_mismatch_warning_returned(tmp_path):
    """Pre-z-scored target vs raw supplemental must produce a warning."""
    target = _write_csv(tmp_path, "t.csv", ["rent"],
                        [["-1.1"], ["0.2"], ["0.9"]])
    supp = _write_csv(tmp_path, "s.csv", ["rent"],
                      [["800"], ["1500"], ["2400"], ["3100"]])
    out = str(tmp_path / "o.csv")
    warnings = coordinator(target, supp, output=out)
    assert any("scale mismatch" in w for w in warnings)


def test_detail_file_has_missing_columns(small_run):
    target, supp, out = small_run
    coordinator(target, supp, output=out)
    headers, rows = _read_csv(out.replace(".csv", "_detail.csv"))
    assert "target_missing" in headers
    assert "match_missing" in headers
