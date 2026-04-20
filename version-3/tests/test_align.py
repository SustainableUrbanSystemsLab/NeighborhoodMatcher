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