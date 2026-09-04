"""
Second header / label rows (NDA and ABCD exports put variable descriptions
on line 2). Reported by the PI on a real file: "line 2, column 'pctPoor':
cannot parse 'pctPoor ' as a number".
"""
import csv
from pathlib import Path

import pytest

from matcher.io import (
    LABEL_ROW_NUMERIC_SHARE,
    LABEL_ROW_SAMPLE,
    drop_label_row,
    looks_like_label_row,
)
from matcher.pipeline import coordinator
from matcher.web_api import coordinate_in_memory

H = ["id", "pctPoor", "medInc"]
DATA = [["t1", "12.5", "50000"], ["t2", "8.0", "61000"], ["t3", "20.1", "39000"]]


# ---------------------------------------------------------------------------
# Detection rule
# ---------------------------------------------------------------------------

def test_header_echo_is_a_label_row():
    # The PI's case: line 2 repeats the names (one with a trailing space).
    assert looks_like_label_row(H, ["id", "pctPoor ", "medInc"], DATA)


def test_description_row_is_a_label_row():
    assert looks_like_label_row(
        H, ["Subject", "Percent below poverty", "Median income"], DATA
    )


def test_numeric_first_row_is_data():
    assert not looks_like_label_row(H, ["t0", "3.2", "45000"], DATA)


def test_text_only_in_a_text_column_is_data():
    # Text where the column is text everywhere (ids) does not count.
    assert not looks_like_label_row(H, ["tract A", "", "NA"], DATA)


def test_any_number_makes_it_data():
    assert not looks_like_label_row(H, ["Subject", "Percent", "42"], DATA)


def test_all_missing_first_row_is_data():
    assert not looks_like_label_row(H, ["", "NA", "-"], DATA)


def test_without_other_rows_only_a_name_echo_counts():
    assert not looks_like_label_row(H, ["x", "text", "text"], [])
    assert looks_like_label_row(H, ["ID", "", ""], [])   # case-insensitive echo


def test_numeric_share_threshold():
    # A column that is numeric in only half its other rows is not "numeric".
    other = [["a", "1", "x"], ["b", "2", "y"], ["c", "3", "5"], ["d", "4", "6"]]
    assert not looks_like_label_row(H, ["e", "", "label"], other)   # medInc 50% numeric
    assert looks_like_label_row(H, ["e", "label", ""], other)       # pctPoor 100% numeric


# ---------------------------------------------------------------------------
# Dropping it
# ---------------------------------------------------------------------------

def test_drop_label_row_shifts_line_numbers_and_notes():
    rows = [["Subject", "Percent below poverty", "Median income"]] + DATA
    out_rows, out_lines, note = drop_label_row(H, rows, [2, 3, 4, 5], "target file")
    assert out_rows == DATA
    assert out_lines == [3, 4, 5]
    assert note.startswith("target file: line 2 looks like a second header or label row")
    assert "Percent below poverty" in note and "skipped" in note


def test_drop_label_row_leaves_data_alone():
    out_rows, out_lines, note = drop_label_row(H, DATA, [2, 3, 4], "target file")
    assert out_rows == DATA and out_lines == [2, 3, 4] and note is None


# ---------------------------------------------------------------------------
# CLI: skipped loudly; web path: descriptive error
# ---------------------------------------------------------------------------

def _write(tmp_path, name, rows):
    p = tmp_path / name
    with open(p, "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows(rows)
    return str(p)


def test_coordinator_skips_label_row_and_records_it(tmp_path, capsys):
    target = _write(tmp_path, "t.csv", [H, ["Subject", "Percent below poverty", "Median income"]] + DATA)
    supp = _write(tmp_path, "s.csv", [H] + [["s1", "12.0", "52000"], ["s2", "9.0", "60000"], ["s3", "19.0", "40000"]])
    out = str(tmp_path / "o.csv")
    warnings = coordinator(target, supp, output=out, exclude=["id"])
    assert any("target file: line 2 looks like a second header or label row" in w for w in warnings)
    assert "label row" in capsys.readouterr().err
    with open(out, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    assert len(rows) - 1 == len(DATA)            # the label row is not a matched row
    info = dict(csv.reader(open(tmp_path / "o_run_info.csv", encoding="utf-8-sig", newline="")))
    assert info["label_rows_skipped"] == "target file: line 2"


def test_coordinator_can_be_told_not_to_skip(tmp_path):
    target = _write(tmp_path, "t.csv", [H, ["id", "pctPoor ", "medInc"]] + DATA)
    supp = _write(tmp_path, "s.csv", [H] + DATA)
    with pytest.raises(ValueError, match="repeats the column names"):
        coordinator(target, supp, output=str(tmp_path / "o.csv"), exclude=["id"],
                    skip_label_row=False)


def test_web_error_names_a_second_header_row():
    # The web app removes a detected label row itself; when a user chooses to
    # keep it, the engine's error must say what the line is.
    target_csv = "id,pctPoor,medInc\nid,pctPoor ,medInc\nt1,12.5,50000\n"
    supp_csv = "id,pctPoor,medInc\ns1,12.0,52000\ns2,9,60000\n"
    with pytest.raises(ValueError) as exc:
        coordinate_in_memory(target_csv, supp_csv, exclude=["id"])
    msg = str(exc.value)
    assert "line 2, column 'pctPoor': cannot parse 'pctPoor '" in msg
    assert "second header or label row" in msg


def test_web_error_hints_label_row_for_a_description_line():
    target_csv = "id,pctPoor,medInc\nSubject,Percent poor,Median income\nt1,12.5,50000\n"
    supp_csv = "id,pctPoor,medInc\ns1,12.0,52000\ns2,9,60000\n"
    with pytest.raises(ValueError, match="label or description row"):
        coordinate_in_memory(target_csv, supp_csv, exclude=["id"])


def test_web_empty_line_placeholder_keeps_original_line_numbers():
    # The web app replaces a skipped label row with an EMPTY line so later
    # parse errors still cite the user's own line numbers: the bad cell
    # below is on line 4 of the user's file (header, label, t1, t2).
    target_csv = "id,pctPoor,medInc\n\nt1,12.5,50000\nt2,oops,61000\n"
    supp_csv = "id,pctPoor,medInc\ns1,12.0,52000\ns2,9,60000\n"
    with pytest.raises(ValueError, match="line 4, column 'pctPoor'"):
        coordinate_in_memory(target_csv, supp_csv, exclude=["id"])


# ---------------------------------------------------------------------------
# The webapp mirrors the rule; pin the constants
# ---------------------------------------------------------------------------

TS_CSV = Path(__file__).resolve().parents[2] / "webapp" / "src" / "lib" / "csv.ts"


@pytest.mark.skipif(not TS_CSV.exists(), reason="webapp not present")
def test_webapp_mirror_uses_the_same_constants():
    text = TS_CSV.read_text(encoding="utf-8")
    assert f"LABEL_ROW_NUMERIC_SHARE = {LABEL_ROW_NUMERIC_SHARE}" in text
    assert f"LABEL_ROW_SAMPLE = {LABEL_ROW_SAMPLE}" in text
