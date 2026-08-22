import csv
import math

# Case-insensitive tokens treated as missing data. Missing cells become None
# (NaN downstream) rather than a numeric stand-in: a raw 0 is an extreme value
# for most ACS variables and silently distorts z-scores and distances.
MISSING_TOKENS = {"", "na", "n/a", "null", "none", "-", ".", "nan", "#n/a"}

# Magnitude cap for parsed values. Squaring a deviation larger than
# ~1.34e154 overflows float64, which silently zeroes (or NaNs) the whole
# column during standardization; 1e100 is far above any real-world variable
# and far below the danger zone.
MAX_ABS_VALUE = 1e100


def load_csv(filepath, with_line_numbers=False):
    """
    Loads a CSV file. Returns (headers, rows), or
    (headers, rows, line_numbers) when with_line_numbers is True —
    line_numbers[i] is the 1-based line in the ORIGINAL file for rows[i],
    so error messages stay correct after blank lines are skipped.

    utf-8-sig tolerates the BOM that Excel prepends to CSV exports (a BOM
    left in place corrupts the first header name and breaks column matching).
    Raises ValueError for an empty file or a row whose length does not match
    the header, with the offending 1-based line number.
    """
    with open(filepath, "r", encoding="utf-8-sig", newline="") as f:
        data = list(csv.reader(f))
    if not data:
        raise ValueError(f"{filepath}: file is empty (no header row)")
    headers, raw_rows = data[0], data[1:]
    rows = []
    line_numbers = []
    for i, row in enumerate(raw_rows):
        if not row:  # blank line (common as a trailing artifact) — skip
            continue
        if len(row) != len(headers):
            raise ValueError(
                f"{filepath}: line {i + 2} has {len(row)} cells, "
                f"expected {len(headers)} (matching the header)"
            )
        rows.append(row)
        line_numbers.append(i + 2)
    if with_line_numbers:
        return headers, rows, line_numbers
    return headers, rows


def clean_val(v):
    """
    Parses one raw CSV cell into a float, or None when the cell is missing.

    Strips commas, dollar signs, and whitespace. Cells matching
    MISSING_TOKENS (case-insensitive) are missing -> None. Anything else
    must parse as a finite number of sane magnitude; otherwise ValueError.

    Documented hazard: commas are treated as thousands separators and
    stripped anywhere, so a European decimal comma ("3,14") reads as 314.
    """
    stripped = v.replace(",", "").replace("$", "").strip()
    if stripped.lower() in MISSING_TOKENS:
        return None
    try:
        value = float(stripped)
    except ValueError:
        raise ValueError(f"cannot parse {v!r} as a number") from None
    if not math.isfinite(value):
        raise ValueError(f"{v!r} is not a finite number")
    if abs(value) > MAX_ABS_VALUE:
        raise ValueError(
            f"{v!r} is too large to standardize safely (magnitude cap {MAX_ABS_VALUE:g})"
        )
    return value


def dump_csv(filepath, headers, rows):
    """
    Writes headers and rows to a CSV file as UTF-8 with a BOM.

    The BOM is for Excel: without it, Windows Excel decodes the file as
    ANSI and the em dashes in the flags column render as mojibake ("â€”").
    load_csv reads utf-8-sig, so the round trip is unaffected.
    """
    with open(filepath, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(rows)
