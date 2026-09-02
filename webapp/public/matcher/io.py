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


# A second header / label row — NDA and ABCD exports put variable
# descriptions on line 2 — is text where the rest of the column is numbers.
# Mirrored by webapp/src/lib/csv.ts (looksLikeLabelRow); keep the rule and
# the constants in sync (pinned by tests/test_label_row.py).
LABEL_ROW_NUMERIC_SHARE = 0.8   # share of a column's other observed cells that must be numeric
LABEL_ROW_SAMPLE = 200          # rows inspected when judging a column


def _is_number(cell):
    try:
        return clean_val(cell) is not None
    except ValueError:
        return False


def _is_observed(cell):
    return cell.strip().lower() not in MISSING_TOKENS


def looks_like_label_row(headers, row, other_rows):
    """
    True when `row` reads as a second header or label row rather than data:
    it repeats a column name, or it holds text (not a number, not a missing
    token) in a column that is numeric in the rows that follow, and holds
    no number anywhere. A row with any numeric cell is data.
    """
    names = [h.strip().lower() for h in headers]
    cells = [c.strip() for c in row]
    if any(c and n and c.lower() == n for c, n in zip(cells, names)):
        return True
    observed = [(j, c) for j, c in enumerate(cells) if _is_observed(c)]
    if not observed or any(_is_number(c) for _, c in observed):
        return False
    sample = other_rows[:LABEL_ROW_SAMPLE]
    for j, _ in observed:
        col = [r[j] for r in sample if j < len(r) and _is_observed(r[j])]
        if col and sum(_is_number(c) for c in col) / len(col) >= LABEL_ROW_NUMERIC_SHARE:
            return True
    return False


def drop_label_row(headers, rows, line_numbers, file_label):
    """
    Removes a leading label row (see looks_like_label_row). Returns
    (rows, line_numbers, note): note is a warning string naming the line
    and quoting the row, or None when nothing was dropped. Never silent —
    callers print or record the note, because dropping a real row would be
    the worse failure.
    """
    if not rows or not looks_like_label_row(headers, rows[0], rows[1:]):
        return rows, line_numbers, None
    line = line_numbers[0] if line_numbers else 2
    preview = ", ".join(c.strip() for c in rows[0] if c.strip())[:80]
    note = (
        f"{file_label}: line {line} looks like a second header or label row "
        f"({preview!r}), not data — it was skipped and is not a matched row"
    )
    return rows[1:], (line_numbers[1:] if line_numbers else line_numbers), note


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
