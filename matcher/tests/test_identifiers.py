"""
Geographic identifiers (ZIP codes, census tracts, GEOIDs, coordinates,
addresses) are never matching variables — a match on a tract ID is a match
on location (HIPAA / PII). The guard lives in matcher.identifiers and is
enforced in both entry points; the webapp mirrors the pattern lists.
"""
import csv
import json
import re
from pathlib import Path

import pytest

from matcher import identifiers
from matcher.identifiers import (
    FIVE_DIGIT,
    FIVE_DIGIT_LEADING_ZERO,
    IDENTIFIER_NAME_PATTERNS,
    IDENTIFIER_VALUE_SHAPES,
    VALUE_SHAPE_MIN_DISTINCT,
    VALUE_SHAPE_MIN_OBSERVED,
    VALUE_SHAPE_SAMPLE,
    VALUE_SHAPE_SHARE,
    IdentifierColumnError,
    blocked_links,
    identifier_by_name,
    identifier_by_values,
    normalize_name,
)
from matcher.pipeline import coordinator
from matcher.web_api import coordinate_in_memory, match_shard

ROOT = Path(__file__).resolve().parents[2]
ACS = ROOT / "matcher" / "data" / "acs-test" / "real-data"
TS_GUARD = ROOT / "webapp" / "src" / "lib" / "identifier-guard.ts"


# ---------------------------------------------------------------------------
# Names
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("header,expected", [
    ("ZipCode", "zip code"),
    ("zip_code", "zip code"),
    ("tract-id", "tract id"),
    ("GEOID10", "geoid10"),
    ("  Census Tract ", "census tract"),
    ("pct.poverty/2020", "pct poverty 2020"),
])
def test_normalize_name(header, expected):
    assert normalize_name(header) == expected


@pytest.mark.parametrize("header,kind", [
    ("zip", "zip"), ("ZipCode", "zip"), ("zip_code", "zip"), ("ZCTA5", "zip"),
    ("postal_code", "zip"), ("postcode", "zip"),
    ("census tract", "tract"), ("tract", "tract"), ("tract_geoid", "tract"),
    ("TRACTCE", "tract"), ("CT2010", "tract"), ("tract-id", "tract"),
    ("GEOID", "geoid"), ("GEOID10", "geoid"), ("GISJOIN", "geoid"),
    ("county_fips", "geoid"), ("STATEFP", "geoid"), ("block_group", "geoid"),
    ("blkgrp", "geoid"), ("state code", "geoid"),
    ("lat", "coordinate"), ("Latitude", "coordinate"), ("lon", "coordinate"),
    ("lng", "coordinate"), ("longitude", "coordinate"), ("x_coord", "coordinate"),
    ("address", "address"), ("home_addr", "address"),
    # identifier word last, with or without a qualifier or ID suffix
    ("home_zip", "zip"), ("patient_zip_code", "zip"), ("zip5", "zip"),
    ("census_tract_2010", "tract"), ("TRACTCE10", "tract"),
    # TIGER / NHGIS field names and code words count anywhere
    ("ZCTA5CE10", "zip"), ("GeoID", "geoid"), ("BLKGRPCE10", "geoid"),
    ("lat_lon", "coordinate"),
])
def test_identifier_names(header, kind):
    got = identifier_by_name(header)
    assert got is not None and got[0] == kind


@pytest.mark.parametrize("header", [
    "pct_poverty", "median_income", "population", "Total population ",
    "long_term_unemployment",   # 'long' is not a coordinate
    "street_connectivity",      # a walkability variable, not an address
    "Median age in years", "pctBuilt1970_1979", "HHFElectric_moe",
    "county_population", "state_rank", "blockbuster_stores",
    # tract- / ZIP-level VARIABLES are what the tool matches on
    "tract_poverty_rate", "tract_median_income", "zip_poverty_rate",
    "pct_lat", "lat_pop",       # percent Latino, not latitude
    "postal_service_jobs", "block_count", "geo_identity",
])
def test_ordinary_variable_names_pass(header):
    assert identifier_by_name(header) is None


# ---------------------------------------------------------------------------
# Value shapes
# ---------------------------------------------------------------------------

def _codes(fmt, n=40, start=0):
    return [fmt % (start + i) for i in range(n)]


def test_eleven_digit_geoids_are_tracts():
    got = identifier_by_values(_codes("%011d", start=4013082019))
    assert got is not None and got[0] == "tract"


def test_mixed_ten_and_eleven_digit_geoids_are_tracts():
    # Leading zeros dropped for FIPS states 01-09 mix 10-digit codes into an
    # 11-digit column (matcher/data/acs-test/real-data/datasetb.csv: 13,699
    # ten-digit and 59,357 eleven-digit tracts).
    cells = _codes("%d", n=20, start=1081040603) + _codes("%d", n=30, start=13001000100)
    got = identifier_by_values(cells)
    assert got is not None and got[0] == "tract"


def test_block_group_and_block_geoids():
    assert identifier_by_values(_codes("%012d", start=130890201001))[0] == "geoid"
    assert identifier_by_values(_codes("%015d", start=130890201001001))[0] == "geoid"


def test_zip_plus_four():
    got = identifier_by_values([f"3030{i % 10}-{1000 + i:04d}" for i in range(40)])
    assert got is not None and got[0] == "zip"


def test_five_digit_codes_need_a_leading_zero():
    # New England ZIPs / FIPS counties keep a leading zero — no quantity does.
    zips = [str(30300 + i) for i in range(39)] + ["02134"]
    got = identifier_by_values(zips)
    assert got is not None and got[0] == "zip"


def test_median_income_is_not_an_identifier():
    # Regression guard for the obvious false positive: a five-digit dollar
    # column must never be blocked by its values.
    assert identifier_by_values([str(45000 + 137 * i) for i in range(60)]) is None


def test_too_few_observed_values_is_no_evidence():
    assert identifier_by_values(_codes("%011d", n=VALUE_SHAPE_MIN_OBSERVED - 1)) is None


def test_constant_column_is_a_flag_not_an_identifier():
    assert identifier_by_values(["13089020100"] * 50) is None


def test_missing_tokens_and_float_tails_are_normalized():
    cells = ["4013082019.0", "", "NA", "4013082020.0", "-"] * 10
    got = identifier_by_values(cells)
    assert got is not None and got[0] == "tract"


def test_share_threshold_is_respected():
    n = 100
    hits = int(VALUE_SHAPE_SHARE * n) - 1
    cells = _codes("%011d", n=hits, start=4013082019) + [str(i) for i in range(n - hits)]
    assert identifier_by_values(cells) is None


def test_only_the_sample_is_inspected():
    # Rows past VALUE_SHAPE_SAMPLE never change the verdict.
    cells = _codes("%011d", n=VALUE_SHAPE_SAMPLE, start=1) + ["7"] * VALUE_SHAPE_SAMPLE
    assert identifier_by_values(cells) is not None


# ---------------------------------------------------------------------------
# Links
# ---------------------------------------------------------------------------

H1 = ["pid", "zip", "a", "region"]
H2 = ["geo", "zip", "a", "code"]
R1 = [["t1", "30301", "1.0", "02134"]] * 30
R2 = [["g1", "30302", "1.5", "4013082019"]] * 30


def test_blocked_links_by_name_either_side():
    common = [
        {"headerName": "zip", "header1Index": 1, "header2Index": 1},
        {"headerName": "a", "header1Index": 2, "header2Index": 2},
    ]
    blocked = blocked_links(common, H1, H2, R1, R2)
    assert [b["headerName"] for b in blocked] == ["zip"]
    assert blocked[0]["side"] == "both" and blocked[0]["kind"] == "zip"
    assert "by column name" in blocked[0]["reason"]


def test_blocked_links_by_values_reports_the_offending_side():
    # A manual link between innocently named columns whose VALUES are codes.
    r1 = [["t1", "1", "1.0", f"0{2100 + i:04d}"] for i in range(40)]
    r2 = [["g1", "1", "1.5", "3.5"] for _ in range(40)]
    common = [{"headerName": "region", "header1Index": 3, "header2Index": 3}]
    blocked = blocked_links(common, H1, H2, r1, r2)
    assert len(blocked) == 1
    assert blocked[0]["side"] == "target"
    assert blocked[0]["column"] == "region"
    assert "by its values" in blocked[0]["reason"]


def test_ordinary_links_are_not_blocked():
    common = [{"headerName": "a", "header1Index": 2, "header2Index": 2}]
    assert blocked_links(common, H1, H2, R1, R2) == []


# ---------------------------------------------------------------------------
# CLI pipeline
# ---------------------------------------------------------------------------

def _write_csv(tmp_path, name, headers, rows):
    path = tmp_path / name
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(headers)
        w.writerows(rows)
    return str(path)


def _read_csv(path):
    # Output files carry a UTF-8 BOM (io.dump_csv); the inputs may not.
    with open(path, newline="", encoding="utf-8-sig") as f:
        data = list(csv.reader(f))
    return data[0], data[1:]


def test_coordinator_drops_identifier_columns_and_keeps_them_in_the_output(tmp_path):
    target = _write_csv(tmp_path, "t.csv", ["pid", "zip", "a"],
                        [["t1", "30301", "10"], ["t2", "30302", "20"]])
    supp = _write_csv(tmp_path, "s.csv", ["zip", "a", "extra"],
                      [["30301", "10", "x"], ["30309", "20", "y"], ["30310", "90", "z"]])
    out = str(tmp_path / "out.csv")
    warnings = coordinator(target, supp, output=out)
    assert any("excluded 'zip'" in w and "geographic identifiers" in w for w in warnings)
    headers, rows = _read_csv(out)
    # The target's own zip column is untouched; the supplemental one is a
    # non-matching column and is appended like any other.
    assert headers[:3] == ["pid", "zip", "a"]
    assert "zip" in headers[3:]
    assert float(rows[0][headers.index("euc_distance")]) == 0.0
    _, detail = _read_csv(str(tmp_path / "out_detail.csv"))
    assert detail  # matched on 'a' alone


def test_coordinator_real_acs_files_never_match_on_census_tract(tmp_path):
    out = str(tmp_path / "acs.csv")
    warnings = coordinator(str(ACS / "dataseta.csv"), str(ACS / "datasetb.csv"), output=out)
    note = [w for w in warnings if "excluded 'census tract'" in w]
    assert len(note) == 1 and "by column name" in note[0]
    headers, rows = _read_csv(out)
    assert "census tract" in headers          # passes through
    _, target_rows = _read_csv(str(ACS / "dataseta.csv"))
    assert len(rows) == len(target_rows)
    var_headers, _ = _read_csv(str(tmp_path / "acs_variables.csv"))
    _, variables = _read_csv(str(tmp_path / "acs_variables.csv"))
    assert "census tract" not in {r[var_headers.index("feature")] for r in variables}
    _, info = _read_csv(str(tmp_path / "acs_run_info.csv"))
    blocked = dict(info)["identifier_columns_blocked"]
    assert blocked.startswith("census tract: census tract identifiers (by column name)")


def test_run_info_records_none_when_nothing_was_blocked(tmp_path):
    target = _write_csv(tmp_path, "t.csv", ["pid", "a"], [["t1", "10"]])
    supp = _write_csv(tmp_path, "s.csv", ["a", "b"], [["10", "1"]])
    coordinator(target, supp, output=str(tmp_path / "o.csv"))
    _, info = _read_csv(str(tmp_path / "o_run_info.csv"))
    assert dict(info)["identifier_columns_blocked"] == "none"


def test_coordinator_only_identifier_shared_is_an_explained_error(tmp_path):
    target = _write_csv(tmp_path, "t.csv", ["pid", "tract"], [["t1", "13089020100"]])
    supp = _write_csv(tmp_path, "s.csv", ["tract", "b"], [["13089020100", "1"]])
    with pytest.raises(ValueError, match="geographic identifier"):
        coordinator(target, supp, output=str(tmp_path / "o.csv"))


def test_user_exclude_of_an_identifier_is_silent(tmp_path):
    # Already excluded by the caller: nothing to warn about.
    target = _write_csv(tmp_path, "t.csv", ["pid", "zip", "a"], [["t1", "30301", "10"]])
    supp = _write_csv(tmp_path, "s.csv", ["zip", "a"], [["30301", "10"]])
    warnings = coordinator(target, supp, output=str(tmp_path / "o.csv"), exclude=["zip"])
    assert not any("excluded 'zip'" in w for w in warnings)


# ---------------------------------------------------------------------------
# Web API
# ---------------------------------------------------------------------------

T_CSV = "pid,census tract,a\nt1,13089020100,10\nt2,13089020200,20\n"
S_CSV = "census tract,a,extra\n13089020100,10,x\n13089020300,20,y\n13089020400,90,z\n"


def test_web_api_auto_links_drop_identifiers_with_a_warning():
    result = coordinate_in_memory(T_CSV, S_CSV)
    assert result["feature_names"] == ["a"]
    assert any("excluded 'census tract'" in w for w in result["warnings"])
    assert "census tract" in result["linked_headers"]


def test_web_api_explicit_identifier_link_is_refused():
    links = [
        {"headerName": "census tract", "header1Index": 1, "header2Index": 0},
        {"headerName": "a", "header1Index": 2, "header2Index": 1},
    ]
    with pytest.raises(IdentifierColumnError, match="census tract"):
        coordinate_in_memory(T_CSV, S_CSV, links=links)
    with pytest.raises(IdentifierColumnError, match="never used for matching"):
        match_shard(T_CSV, S_CSV, links=links, row_lo=0, row_hi=1)


def test_web_api_explicit_links_without_identifiers_run():
    links = [{"headerName": "a", "header1Index": 2, "header2Index": 1}]
    result = coordinate_in_memory(T_CSV, S_CSV, links=links)
    assert result["feature_names"] == ["a"]
    assert not any("excluded" in w for w in result["warnings"])


def test_error_message_says_the_column_may_stay():
    err = IdentifierColumnError([{
        "headerName": "zip", "header1Index": 1, "header2Index": 1, "kind": "zip",
        "side": "both", "column": "zip", "reason": "ZIP / postal codes (by column name)",
    }])
    assert "passes through to the output" in str(err)
    assert isinstance(err, ValueError)


# ---------------------------------------------------------------------------
# Webapp mirror
# ---------------------------------------------------------------------------

def _ts_array_of_tuples(text, name):
    m = re.search(name + r"[^=]*=\s*\[(.*?)\n\];", text, re.S)
    assert m, f"{name} not found in {TS_GUARD}"
    body = "\n".join(
        line for line in m.group(1).splitlines() if not line.strip().startswith("//")
    )
    return json.loads("[" + body.strip().rstrip(",") + "]")


def _ts_number(text, name):
    m = re.search(r"export const " + name + r"\s*=\s*([0-9.]+);", text)
    assert m, f"{name} not found in {TS_GUARD}"
    return float(m.group(1))


def _ts_string(text, name):
    m = re.search(r"export const " + name + r'\s*=\s*"((?:[^"\\]|\\.)*)";', text)
    assert m, f"{name} not found in {TS_GUARD}"
    return json.loads('"' + m.group(1) + '"')


@pytest.mark.skipif(not TS_GUARD.exists(), reason="webapp not present")
def test_webapp_mirror_has_the_same_name_patterns():
    text = TS_GUARD.read_text()
    assert _ts_array_of_tuples(text, "IDENTIFIER_NAME_PATTERNS") == [
        list(t) for t in IDENTIFIER_NAME_PATTERNS
    ]


@pytest.mark.skipif(not TS_GUARD.exists(), reason="webapp not present")
def test_webapp_mirror_has_the_same_value_shapes():
    text = TS_GUARD.read_text()
    assert _ts_array_of_tuples(text, "IDENTIFIER_VALUE_SHAPES") == [
        list(t) for t in IDENTIFIER_VALUE_SHAPES
    ]
    assert _ts_string(text, "FIVE_DIGIT") == FIVE_DIGIT
    assert _ts_string(text, "FIVE_DIGIT_LEADING_ZERO") == FIVE_DIGIT_LEADING_ZERO


@pytest.mark.skipif(not TS_GUARD.exists(), reason="webapp not present")
def test_webapp_mirror_has_the_same_thresholds():
    text = TS_GUARD.read_text()
    assert _ts_number(text, "VALUE_SHAPE_SHARE") == VALUE_SHAPE_SHARE
    assert _ts_number(text, "VALUE_SHAPE_MIN_OBSERVED") == VALUE_SHAPE_MIN_OBSERVED
    assert _ts_number(text, "VALUE_SHAPE_MIN_DISTINCT") == VALUE_SHAPE_MIN_DISTINCT
    assert _ts_number(text, "VALUE_SHAPE_SAMPLE") == VALUE_SHAPE_SAMPLE


def test_patterns_use_only_the_shared_regex_dialect():
    # Both engines must read these identically: no lookbehind, no named
    # groups, no Python-only or JS-only syntax.
    forbidden = re.compile(r"\(\?<|\(\?P|\(\?i\)|\\A|\\Z|\\z|\\p\{")
    for pattern, _, _ in list(IDENTIFIER_NAME_PATTERNS) + list(IDENTIFIER_VALUE_SHAPES):
        assert not forbidden.search(pattern), pattern
        re.compile(pattern)
