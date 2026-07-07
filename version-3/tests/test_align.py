import pytest
from matcher.align import find_common_headers


def test_finds_shared_columns():
    h1 = ["id", "feature_a", "feature_b"]
    h2 = ["feature_a", "feature_b", "feature_c"]
    result = find_common_headers(h1, h2)
    names = [r["headerName"] for r in result]
    assert names == ["feature_a", "feature_b"]

def test_correct_indices():
    h1 = ["id", "feature_a", "feature_b"]
    h2 = ["feature_b", "feature_a"]
    result = find_common_headers(h1, h2)
    a = next(r for r in result if r["headerName"] == "feature_a")
    assert a["header1Index"] == 1
    assert a["header2Index"] == 1

def test_exclude_removes_column():
    h1 = ["id", "feature_a", "feature_b"]
    h2 = ["feature_a", "feature_b"]
    result = find_common_headers(h1, h2, exclude=["feature_a"])
    names = [r["headerName"] for r in result]
    assert "feature_a" not in names
    assert "feature_b" in names

def test_no_common_headers():
    result = find_common_headers(["a", "b"], ["c", "d"])
    assert result == []

def test_exclude_defaults_to_empty():
    h1 = ["feature_a"]
    h2 = ["feature_a"]
    result = find_common_headers(h1, h2)
    assert len(result) == 1

def test_duplicate_shared_header_raises():
    import pytest
    with pytest.raises(ValueError, match="pct_poverty"):
        find_common_headers(["id", "pct_poverty", "pct_poverty"], ["pct_poverty", "x"])

def test_duplicate_header_in_supplemental_raises():
    import pytest
    with pytest.raises(ValueError, match="rent"):
        find_common_headers(["rent"], ["rent", "rent"])

def test_duplicate_non_shared_header_is_fine():
    common = find_common_headers(["a", "b"], ["a", "junk", "junk"])
    assert [c["headerName"] for c in common] == ["a"]

def test_duplicate_excluded_header_is_fine():
    common = find_common_headers(["a", "dup", "dup"], ["a", "dup"], exclude=["dup"])
    assert [c["headerName"] for c in common] == ["a"]


def test_whitespace_padded_headers_still_link():
    """Excel pads headers; ' rent ' and 'rent' are the same column."""
    common = find_common_headers([" rent ", "a"], ["rent", "b"])
    assert [c["headerName"] for c in common] == ["rent"]
    assert common[0]["header1Index"] == 0
    assert common[0]["header2Index"] == 0


def test_empty_header_names_never_link():
    """A trailing comma on every line yields a shared '' column; linking it
    would charge every pair the missing penalty."""
    common = find_common_headers(["a", "b", ""], ["a", ""])
    assert [c["headerName"] for c in common] == ["a"]
