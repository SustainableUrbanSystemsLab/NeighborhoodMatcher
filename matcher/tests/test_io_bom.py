"""
UTF-8 BOM on written CSVs.

The flags column carries em dashes; without a BOM, Windows Excel decodes the
file as ANSI and renders them as mojibake ("â€”") — reported from real
researcher use. dump_csv therefore writes utf-8-sig, and every file the
coordinator produces must start with the BOM. load_csv reads utf-8-sig, so
round trips are unaffected.
"""

import csv

from matcher.io import dump_csv, load_csv
from matcher.pipeline import coordinator

BOM = b"\xef\xbb\xbf"


def _starts_with_bom(path):
    with open(path, "rb") as f:
        return f.read(3) == BOM


def test_dump_csv_starts_with_bom(tmp_path):
    out = str(tmp_path / "bom.csv")
    dump_csv(out, ["a", "b"], [["1", "2"]])
    assert _starts_with_bom(out)


def test_dump_csv_bom_round_trips_through_load_csv(tmp_path):
    out = str(tmp_path / "roundtrip.csv")
    dump_csv(out, ["name"], [["ambiguous match — NNDR 0.92"]])
    headers, rows = load_csv(out)
    assert headers == ["name"]
    assert rows == [["ambiguous match — NNDR 0.92"]]


def test_bom_invisible_to_plain_utf8_sig_reader(tmp_path):
    # A consumer reading with utf-8-sig (pandas, Excel, load_csv) must see
    # the first header clean, not "﻿a".
    out = str(tmp_path / "clean.csv")
    dump_csv(out, ["a"], [["1"]])
    with open(out, "r", encoding="utf-8-sig", newline="") as f:
        headers = next(csv.reader(f))
    assert headers == ["a"]


def test_coordinator_outputs_start_with_bom(tmp_path):
    target = tmp_path / "target.csv"
    supplemental = tmp_path / "supp.csv"
    target.write_text("id,a,b\n1,1.0,2.0\n2,3.0,4.0\n", encoding="utf-8")
    supplemental.write_text(
        "a,b,extra\n1.0,2.0,x\n3.0,4.0,y\n9.0,9.0,z\n", encoding="utf-8"
    )
    out = tmp_path / "linked.csv"
    coordinator(str(target), str(supplemental), output=str(out))
    assert _starts_with_bom(out)
    assert _starts_with_bom(tmp_path / "linked_detail.csv")
    assert _starts_with_bom(tmp_path / "linked_variables.csv")
