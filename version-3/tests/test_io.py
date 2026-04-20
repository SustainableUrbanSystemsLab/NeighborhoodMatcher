import pytest
from matcher.io import clean_val


def test_clean_val_removes_commas():
    assert clean_val("1,234") == "1234"

def test_clean_val_removes_dollar_sign():
    assert clean_val("$45,609") == "45609"

def test_clean_val_na_to_zero():
    assert clean_val("NA") == "0"

def test_clean_val_na_case_insensitive():
    assert clean_val("na") == "0"

def test_clean_val_empty_to_zero():
    assert clean_val("") == "0"

def test_clean_val_strips_whitespace():
    assert clean_val("  42.5  ") == "42.5"

def test_clean_val_normal_value_unchanged():
    assert clean_val("18.3") == "18.3"