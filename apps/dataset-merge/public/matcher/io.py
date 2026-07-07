import csv
import math

# Case-insensitive tokens treated as missing data. Missing cells become None
# (NaN downstream) rather than a numeric stand-in: a raw 0 is an extreme value
# for most ACS variables and silently distorts z-scores and distances.
MISSING_TOKENS = {"", "na", "n/a", "null", "none", "-", ".", "nan", "#n/a"}


def load_csv(filepath):
    """
    Loads a CSV file. Returns (headers, rows).

    utf-8-sig tolerates the BOM that Excel prepends to CSV exports (a BOM
    left in place corrupts the first header name and breaks column matching).
    Raises ValueError for an empty file or a row whose length does not match
    the header, with the offending 1-based line number.
    """
    with open(filepath, "r", encoding="utf-8-sig", newline="") as f:
        data = list(csv.reader(f))
    if not data:
        raise ValueError(f"{filepath}: file is empty (no header row)")
    headers, rows = data[0], data[1:]
    for i, row in enumerate(rows):
        if len(row) != len(headers):
            raise ValueError(
                f"{filepath}: line {i + 2} has {len(row)} cells, "
                f"expected {len(headers)} (matching the header)"
            )
    return headers, rows


def clean_val(v):
    """
    Parses one raw CSV cell into a float, or None when the cell is missing.

    Strips commas, dollar signs, and whitespace. Cells matching
    MISSING_TOKENS (case-insensitive) are missing -> None. Anything else
    must parse as a finite number; otherwise ValueError.
    """
    stripped = v.replace(",", "").replace("$", "").strip()
    if stripped.lower() in MISSING_TOKENS:
        return None
    try:
        value = float(stripped)
    except ValueError:
        raise ValueError(f"cannot parse {v!r} as a number") from None
    if not math.isfinite(value):
        raise ValueError(f"cannot parse {v!r} as a number")
    return value


def dump_csv(filepath, headers, rows):
    """Writes headers and rows to a CSV file."""
    with open(filepath, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(rows)
