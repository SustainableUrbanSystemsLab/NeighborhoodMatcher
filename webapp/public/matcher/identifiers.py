"""
Geographic-identifier guard.

ZIP codes, census tract IDs and other location identifiers can never be
matching variables. A "match" on a tract ID is a match on location — the
exact re-identification path this tool exists to avoid (HIPAA / PII) — and
the standardized distance would treat the code as a quantity anyway.

Columns are judged two ways, and a link is blocked when EITHER side fails
either test:

- by NAME: the header, normalized (case, camelCase, _-./ separators), matches
  one of IDENTIFIER_NAME_PATTERNS;
- by VALUE SHAPE: at least VALUE_SHAPE_SHARE of the observed cells are
  digit strings of an identifier's length — 10- or 11-digit tract GEOIDs
  (10 where a leading zero was lost, and real files mix the two), 12-digit
  block groups, 15-digit blocks, ZIP+4 — or five-digit codes where at least
  one cell keeps a leading zero, which no quantity does. Plain five-digit
  integers are NOT a shape: median_income is ≥ 90 % five-digit and must
  stay usable.

There is deliberately no override. Blocked columns are not removed from the
files: like every other non-matching column they pass through to the output
unchanged, and the warning / error text says so.

The webapp mirrors this module in webapp/src/lib/identifier-guard.ts;
tests/test_identifiers.py pins the two pattern lists to each other, so the
regexes here use only the dialect both `re` and JavaScript share
(\\b | ? \\d {n} ( ) and literal words).
"""
import re

from .io import MISSING_TOKENS

# ---------------------------------------------------------------------------
# Names
# ---------------------------------------------------------------------------

# (pattern, kind, what the values are). `kind` groups the families for the UI.
IDENTIFIER_NAME_PATTERNS = [
    (r"\bzip ?code\b|\bzip\b|\bzcta\d*\b|\bpostal ?code\b|\bpostal\b|\bpostcode\b",
     "zip", "ZIP / postal codes"),
    (r"\bcensus ?tract\b|\btract\b|\btractce\b|\btract ?id\b|\bct ?20\d\d\b",
     "tract", "census tract identifiers"),
    (r"\bgeoid\d*\b|\bgisjoin\b|\bfips\b|\bstatefp\b|\bcountyfp\b|\btractfp\b"
     r"|\bblkgrp\b|\bblock ?group\b|\bbg ?id\b|\bcounty (code|id|fips)\b"
     r"|\bstate (code|id|fips)\b|\bblock (code|id)\b",
     "geoid", "GEOID / FIPS codes"),
    (r"\blat\b|\blatitude\b|\blon\b|\blng\b|\blongitude\b|\bx ?coord(inate)?\b"
     r"|\by ?coord(inate)?\b|\beasting\b|\bnorthing\b",
     "coordinate", "geographic coordinates"),
    (r"\baddress\b|\baddr\b",
     "address", "street addresses"),
]

_NAME_RES = [(re.compile(p), kind, what) for p, kind, what in IDENTIFIER_NAME_PATTERNS]
_CAMEL = re.compile(r"([a-z0-9])([A-Z])")
_SEPARATORS = re.compile(r"[_\-./]+")
_SPACES = re.compile(r"\s+")


def normalize_name(header):
    """
    'ZipCode' -> 'zip code', 'tract_geoid' -> 'tract geoid', 'CT2010' ->
    'ct2010': lowercase, camelCase split, separators folded to one space.
    Mirrored by normalizeName in identifier-guard.ts.
    """
    name = _CAMEL.sub(r"\1 \2", str(header))
    name = _SEPARATORS.sub(" ", name.lower())
    return _SPACES.sub(" ", name).strip()


def identifier_by_name(header):
    """(kind, description) when the header names an identifier, else None."""
    name = normalize_name(header)
    for regex, kind, what in _NAME_RES:
        if regex.search(name):
            return kind, what
    return None


# ---------------------------------------------------------------------------
# Value shapes
# ---------------------------------------------------------------------------

VALUE_SHAPE_SHARE = 0.9        # share of observed cells that must fit one shape
VALUE_SHAPE_MIN_OBSERVED = 20  # fewer observed cells: too little evidence, no block
VALUE_SHAPE_MIN_DISTINCT = 2   # a constant column is a flag value, not an identifier
VALUE_SHAPE_SAMPLE = 5000      # rows inspected per column

# (pattern, kind, what the values are). Anchored; applied to stripped cells
# with a trailing ".0" removed (pandas writes int columns that hold a NaN as
# floats).
IDENTIFIER_VALUE_SHAPES = [
    (r"^\d{10,11}$", "tract", "10- or 11-digit census tract GEOIDs"),
    (r"^\d{12}$", "geoid", "12-digit block-group GEOIDs"),
    (r"^\d{15}$", "geoid", "15-digit census block GEOIDs"),
    (r"^\d{5}-\d{4}$", "zip", "ZIP+4 codes"),
]
# Five-digit codes are only an identifier shape when a leading zero proves
# they are codes rather than counts or dollars.
FIVE_DIGIT = r"^\d{5}$"
FIVE_DIGIT_LEADING_ZERO = r"^0\d{4}$"

_SHAPE_RES = [(re.compile(p), kind, what) for p, kind, what in IDENTIFIER_VALUE_SHAPES]
_FIVE_DIGIT_RE = re.compile(FIVE_DIGIT)
_FIVE_DIGIT_LEADING_ZERO_RE = re.compile(FIVE_DIGIT_LEADING_ZERO)
_FLOAT_ZERO = re.compile(r"\.0+$")


def _observed_codes(cells):
    """Stripped, observed cells with a float-export '.0' tail removed."""
    out = []
    for cell in cells[:VALUE_SHAPE_SAMPLE]:
        c = str(cell).strip()
        if c.lower() in MISSING_TOKENS:
            continue
        out.append(_FLOAT_ZERO.sub("", c))
    return out


def identifier_by_values(cells):
    """
    (kind, description) when the column's observed cells look like codes,
    else None. `cells` is the raw string column (one entry per row).
    """
    codes = _observed_codes(cells)
    if len(codes) < VALUE_SHAPE_MIN_OBSERVED or len(set(codes)) < VALUE_SHAPE_MIN_DISTINCT:
        return None
    need = VALUE_SHAPE_SHARE * len(codes)
    for regex, kind, what in _SHAPE_RES:
        hits = sum(1 for c in codes if regex.match(c))
        if hits >= need:
            return kind, f"{what} ({hits} of {len(codes)} observed values)"
    five = sum(1 for c in codes if _FIVE_DIGIT_RE.match(c))
    if five >= need and any(_FIVE_DIGIT_LEADING_ZERO_RE.match(c) for c in codes):
        return "zip", (f"5-digit codes with leading zeros, i.e. ZIP or FIPS codes "
                       f"({five} of {len(codes)} observed values)")
    return None


# ---------------------------------------------------------------------------
# Links
# ---------------------------------------------------------------------------

def _column(rows, index):
    return [row[index] if index < len(row) else "" for row in rows]


def _judge(header, rows, index):
    by_name = identifier_by_name(header)
    if by_name:
        kind, what = by_name
        return kind, f"{what} (by column name)"
    by_values = identifier_by_values(_column(rows, index))
    if by_values:
        kind, what = by_values
        return kind, f"{what} (by its values)"
    return None


def blocked_links(common, headers1, headers2, rows1, rows2):
    """
    The links in `common` that touch an identifier column on either side.
    Returns dicts: headerName, header1Index, header2Index, kind, side
    ('target' | 'supplemental' | 'both'), column (the offending header as
    written), reason (human-readable, names the test that fired).
    """
    blocked = []
    for link in common:
        i1, i2 = link["header1Index"], link["header2Index"]
        h1 = headers1[i1] if i1 < len(headers1) else link["headerName"]
        h2 = headers2[i2] if i2 < len(headers2) else link["headerName"]
        t = _judge(h1, rows1, i1)
        s = _judge(h2, rows2, i2)
        if not t and not s:
            continue
        if t and s:
            side, column, (kind, reason) = "both", h1, t
        elif t:
            side, column, (kind, reason) = "target", h1, t
        else:
            side, column, (kind, reason) = "supplemental", h2, s
        blocked.append({
            "headerName": link["headerName"],
            "header1Index": i1,
            "header2Index": i2,
            "kind": kind,
            "side": side,
            "column": column,
            "reason": reason,
        })
    return blocked


def without_blocked(common, blocked):
    """`common` minus the blocked links (matched on both indices)."""
    keys = {(b["header1Index"], b["header2Index"]) for b in blocked}
    return [c for c in common if (c["header1Index"], c["header2Index"]) not in keys]


def blocked_warning(entry):
    """One dataset-level warning per auto-linked identifier column."""
    where = "" if entry["side"] == "both" else f" ({entry['side']} file)"
    return (
        f"excluded '{entry['column']}'{where} from matching: {entry['reason']} — "
        "geographic identifiers (HIPAA / PII) can never be matching variables. "
        "The column still passes through to the output unchanged; if it is not "
        "an identifier, rename it (name match) or rescale it (value match)"
    )


class IdentifierColumnError(ValueError):
    """Raised when explicitly requested column links include an identifier."""

    def __init__(self, blocked):
        self.blocked = blocked
        parts = [f"'{b['column']}': {b['reason']}" for b in blocked]
        noun = "column" if len(blocked) == 1 else "columns"
        super().__init__(
            f"Cannot match on {noun} " + "; ".join(parts) + ". ZIP codes, census "
            "tracts and other geographic identifiers are never used for matching "
            "(HIPAA / PII). Remove the link — the column can stay in the file and "
            "passes through to the output unchanged."
        )
