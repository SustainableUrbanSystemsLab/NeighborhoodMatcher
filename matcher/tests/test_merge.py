import pytest
from matcher.merge import row_merge, new_header


def test_row_merge_appends_non_shared(simple_common):
    """Non-shared supplemental columns should be appended to target row."""
    target = ["T_id", "10", "20", "T_only"]
    supplemental = ["10", "20", "S_only"]
    result = row_merge(target, supplemental, simple_common)
    assert result == ["T_id", "10", "20", "T_only", "S_only"]

def test_row_merge_excludes_shared(simple_common):
    """Shared supplemental columns should not be duplicated."""
    target = ["T_id", "10", "20"]
    supplemental = ["10", "20"]
    result = row_merge(target, supplemental, simple_common)
    assert result == ["T_id", "10", "20"]

def test_new_header_structure(simple_common):
    t_headers = ["t_id", "feature_a", "feature_b", "t_only"]
    s_headers = ["feature_a", "feature_b", "s_only"]
    result = new_header(t_headers, s_headers, simple_common)
    assert result == ["t_id", "feature_a", "feature_b", "t_only", "s_only"]

def test_new_header_no_extras(simple_common):
    """When supplemental has no extra columns, header stays as target's."""
    t_headers = ["t_id", "feature_a", "feature_b"]
    s_headers = ["feature_a", "feature_b"]
    result = new_header(t_headers, s_headers, simple_common)
    assert result == t_headers