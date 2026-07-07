import pytest
from matcher.io import clean_val, load_csv, dump_csv


# ── clean_val: numeric parsing ────────────────────────────────────────────────

def test_clean_val_removes_commas():
    assert clean_val("1,234") == 1234.0

def test_clean_val_removes_dollar_sign():
    assert clean_val("$45,609") == 45609.0

def test_clean_val_strips_whitespace():
    assert clean_val("  42.5  ") == 42.5

def test_clean_val_normal_value():
    assert clean_val("18.3") == 18.3

def test_clean_val_negative_value():
    assert clean_val("-3.2") == -3.2

def test_clean_val_zero_is_a_value_not_missing():
    """A literal 0 is data; only blank/NA-style tokens are missing."""
    assert clean_val("0") == 0.0


# ── clean_val: missing tokens → None ─────────────────────────────────────────

@pytest.mark.parametrize("token", [
    "", "NA", "na", "N/A", "n/a", "null", "NULL", "None", "-", ".", "NaN", "nan", "#N/A",
])
def test_clean_val_missing_tokens_return_none(token):
    assert clean_val(token) is None

def test_clean_val_missing_token_with_whitespace():
    assert clean_val("  NA  ") is None


# ── clean_val: garbage → ValueError ──────────────────────────────────────────

@pytest.mark.parametrize("garbage", ["abc", "12x", "1.2.3", "inf", "-inf", "1e999"])
def test_clean_val_garbage_raises(garbage):
    """Non-numeric junk must fail loudly, not silently poison the pipeline.
    Includes non-finite parses (inf overflows) — a distance of inf from a
    data cell is never meaningful."""
    with pytest.raises(ValueError):
        clean_val(garbage)


# ── load_csv ──────────────────────────────────────────────────────────────────

def _write(tmp_path, name, text, encoding="utf-8"):
    p = tmp_path / name
    p.write_bytes(text.encode(encoding))
    return str(p)

def test_load_csv_roundtrip(tmp_path):
    path = _write(tmp_path, "basic.csv", "a,b\n1,2\n3,4\n")
    headers, rows = load_csv(path)
    assert headers == ["a", "b"]
    assert rows == [["1", "2"], ["3", "4"]]

def test_load_csv_strips_excel_bom(tmp_path):
    """Excel prepends a BOM to CSV exports; it must not corrupt the first
    header name (a BOM'd header silently fails column matching)."""
    path = _write(tmp_path, "bom.csv", "﻿a,b\n1,2\n")
    headers, _ = load_csv(path)
    assert headers[0] == "a"

def test_load_csv_empty_file_raises(tmp_path):
    path = _write(tmp_path, "empty.csv", "")
    with pytest.raises(ValueError, match="empty"):
        load_csv(path)

def test_load_csv_header_only_is_valid(tmp_path):
    path = _write(tmp_path, "header_only.csv", "a,b\n")
    headers, rows = load_csv(path)
    assert headers == ["a", "b"]
    assert rows == []

def test_load_csv_ragged_row_raises_with_line_number(tmp_path):
    path = _write(tmp_path, "ragged.csv", "a,b,c\n1,2,3\n4,5\n")
    with pytest.raises(ValueError, match="line 3"):
        load_csv(path)

def test_load_csv_crlf(tmp_path):
    path = _write(tmp_path, "crlf.csv", "a,b\r\n1,2\r\n")
    headers, rows = load_csv(path)
    assert headers == ["a", "b"]
    assert rows == [["1", "2"]]

def test_dump_then_load_roundtrip(tmp_path):
    out = str(tmp_path / "out.csv")
    dump_csv(out, ["x", "y"], [["1", "2"], ["3", "4"]])
    headers, rows = load_csv(out)
    assert headers == ["x", "y"]
    assert rows == [["1", "2"], ["3", "4"]]
