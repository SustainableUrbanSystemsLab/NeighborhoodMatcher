"""
Tool identity and run provenance.

A results package has to answer "which version of what, run when, by whom"
months after the fact — so the identity constants are pinned here, the CLI
must write them next to every run, and the webapp's TypeScript mirror
(webapp/src/lib/about.ts) must not drift from the Python original.
"""

import csv
import pathlib
import re
from datetime import datetime, timezone

import pytest

from matcher import about
from matcher.pipeline import coordinator
from matcher.web_api import coordinate_in_memory

TARGET_CSV = "id,a,b\nt1,1.0,2.0\nt2,3.0,4.0\n"
SUPP_CSV = "a,b,extra\n1.0,2.0,s1\n3.0,4.0,s2\n9.0,9.0,s3\n"

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
TS_ABOUT = REPO_ROOT / "webapp" / "src" / "lib" / "about.ts"


def test_authors_are_the_project_authors():
    assert about.AUTHORS == ("Dr. Benson Ku", "Dr. Patrick Kastner")
    assert about.authors_line() == "Dr. Benson Ku and Dr. Patrick Kastner"


def test_authors_line_handles_one_and_three_names(monkeypatch):
    monkeypatch.setattr(about, "AUTHORS", ("Solo Author",))
    assert about.authors_line() == "Solo Author"
    monkeypatch.setattr(about, "AUTHORS", ("A", "B", "C"))
    assert about.authors_line() == "A, B, and C"


def test_version_is_a_release_string():
    assert re.fullmatch(r"\d+\.\d+\.\d+", about.VERSION)


def test_timestamps_are_iso_and_local():
    moment = datetime(2026, 8, 22, 18, 30, 5, tzinfo=timezone.utc)
    assert about.utc_timestamp(moment) == "2026-08-22T18:30:05Z"
    # Local rendering keeps seconds precision and states its offset.
    assert re.fullmatch(
        r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC[+-]\d{2}:\d{2}",
        about.local_timestamp(moment),
    )


def test_provenance_omits_timestamps_when_asked():
    info = about.provenance(moment=False)
    assert "generated_at_utc" not in info
    assert info["tool"] == about.TOOL_NAME
    assert info["version"] == about.VERSION
    assert info["authors"] == list(about.AUTHORS)


def test_provenance_rows_order_and_extras():
    moment = datetime(2026, 8, 22, 18, 30, 5, tzinfo=timezone.utc)
    rows = about.provenance_rows(moment, extra=[("nndr_threshold", 0.8)])
    keys = [k for k, _ in rows]
    assert keys[:5] == [
        "tool", "tool_version", "authors", "organization", "repository",
    ]
    assert dict(rows)["generated_at_utc"] == "2026-08-22T18:30:05Z"
    assert rows[-1] == ("nndr_threshold", 0.8)


def test_web_api_result_carries_engine_provenance():
    res = coordinate_in_memory(TARGET_CSV, SUPP_CSV)
    prov = res["provenance"]
    assert prov["version"] == about.VERSION
    assert prov["authors_line"] == about.authors_line()
    assert prov["repo_url"] == about.REPO_URL
    # The browser stamps the run time (Pyodide has no timezone of its own).
    assert "generated_at_utc" not in prov


def test_coordinator_writes_run_info(tmp_path):
    target = tmp_path / "t.csv"
    supp = tmp_path / "s.csv"
    target.write_text(TARGET_CSV, encoding="utf-8")
    supp.write_text(SUPP_CSV, encoding="utf-8")
    out = tmp_path / "linked.csv"
    coordinator(str(target), str(supp), output=str(out), threshold=0.75,
                min_confidence="medium")

    with open(tmp_path / "linked_run_info.csv", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    assert rows[0] == ["key", "value"]
    info = dict(r for r in rows[1:])
    assert info["tool"] == about.TOOL_NAME
    assert info["tool_version"] == about.VERSION
    assert info["authors"] == "Dr. Benson Ku; Dr. Patrick Kastner"
    assert info["repository"] == about.REPO_URL
    assert info["generated_at_utc"].endswith("Z")
    # Settings the run actually used, not defaults.
    assert info["nndr_threshold"] == "0.75"
    assert info["min_confidence_filter"] == "Medium"
    assert info["max_distance_cutoff"] == "off"
    assert info["target_file"] == "t.csv"
    assert info["matching_variables"] == "a; b"


def test_run_info_records_only_file_names_not_paths(tmp_path):
    # A shared results folder should not leak the author's directory tree.
    target = tmp_path / "t.csv"
    supp = tmp_path / "s.csv"
    target.write_text(TARGET_CSV, encoding="utf-8")
    supp.write_text(SUPP_CSV, encoding="utf-8")
    out = tmp_path / "linked.csv"
    coordinator(str(target), str(supp), output=str(out))
    text = (tmp_path / "linked_run_info.csv").read_text(encoding="utf-8-sig")
    assert str(tmp_path) not in text


def _ts_literal(name):
    """Reads `export const NAME = "value";` out of the TS mirror."""
    m = re.search(rf'export const {name} =\s*"([^"]*)"', TS_ABOUT.read_text())
    assert m, f"{name} not found in {TS_ABOUT}"
    return m.group(1)


@pytest.mark.skipif(not TS_ABOUT.exists(), reason="webapp not present")
@pytest.mark.parametrize(
    "ts_name,py_value",
    [
        ("TOOL_NAME", about.TOOL_NAME),
        ("ORGANIZATION", about.ORGANIZATION),
        ("REPO_URL", about.REPO_URL),
        ("SITE_URL", about.SITE_URL),
    ],
)
def test_webapp_mirror_matches_python(ts_name, py_value):
    assert _ts_literal(ts_name) == py_value


@pytest.mark.skipif(not TS_ABOUT.exists(), reason="webapp not present")
def test_webapp_mirror_lists_the_same_authors():
    block = re.search(r"export const AUTHORS = \[(.*?)\]", TS_ABOUT.read_text(), re.S)
    assert block
    names = re.findall(r'"([^"]+)"', block.group(1))
    assert tuple(names) == about.AUTHORS
