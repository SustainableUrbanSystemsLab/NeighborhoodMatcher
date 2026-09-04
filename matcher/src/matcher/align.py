import unicodedata

# Zero-width characters that make two visually identical headers compare
# unequal: ZWSP, ZWNJ, ZWJ, word joiner, BOM-as-ZWNBSP.
_ZERO_WIDTH = dict.fromkeys(map(ord, "\u200b\u200c\u200d\u2060\ufeff"))


def normalize_header(name):
    """
    Canonical form used for header comparison: Unicode NFC (composed é ==
    decomposed e+́), zero-width characters removed, NBSP folded to a plain
    space, surrounding whitespace stripped. Every variant this touches is
    VISUALLY IDENTICAL to its partner, so normalization only ever links
    columns the user already believes are the same.
    """
    name = unicodedata.normalize("NFC", name)
    name = name.translate(_ZERO_WIDTH).replace("\u00a0", " ")
    return name.strip()


def find_common_headers(headers1, headers2, exclude=None):
    """
    Finds columns present in both header lists.
    Returns a list of dicts: {headerName, header1Index, header2Index}.
    Columns in `exclude` are skipped even if shared.

    Names are compared via normalize_header (whitespace-stripped, Unicode-
    normalized — Excel routinely pads headers, and invisible characters
    silently unlink visually identical columns). Empty / whitespace-only
    names — the artifact of a trailing comma on every line — are never
    linked: an all-missing '' feature would charge every pair the missing
    penalty and distort NNDR.

    Raises ValueError when a shared column name appears more than once in
    either file — a duplicate makes the name→index mapping ambiguous, and
    silently picking one occurrence would link the wrong data. Also raises
    TypeError when `exclude` is a bare string: iterating it would silently
    exclude single characters instead of the intended column name.
    """
    if exclude is None:
        exclude = []
    if isinstance(exclude, str):
        raise TypeError(
            "exclude must be a list of column names, not a string — "
            f"got {exclude!r} (a bare string would exclude its individual characters)"
        )
    exclude = {normalize_header(e) for e in exclude}

    names1 = [normalize_header(h) for h in headers1]
    names2 = [normalize_header(h) for h in headers2]

    def _duplicates(names):
        seen, dupes = set(), set()
        for name in names:
            if name in seen:
                dupes.add(name)
            seen.add(name)
        return dupes

    shared = {n for n in names1 if n} & {n for n in names2 if n}
    ambiguous = (_duplicates(names1) | _duplicates(names2)) & (shared - exclude)
    if ambiguous:
        raise ValueError(
            "Duplicate column name(s) shared between the files: "
            + ", ".join(sorted(ambiguous))
            + " — rename or exclude them; matching on an ambiguous column is unsafe."
        )

    h2_lookup = {name: idx for idx, name in enumerate(names2) if name}
    return [
        {"headerName": name, "header1Index": i, "header2Index": h2_lookup[name]}
        for i, name in enumerate(names1)
        if name and name in h2_lookup and name not in exclude
    ]


def no_shared_columns_error(headers1, headers2):
    """
    Builds the 'No shared columns to match on.' ValueError, enriched with
    the two hints that solve almost every real occurrence:
    - shared-except-for-case pairs ('Rent' vs 'rent'): matching is
      case-sensitive by design, but the user should hear WHY nothing linked;
    - a single header containing ';' or tab: the classic sign the file is
      semicolon/tab-delimited and parsed as one giant column.
    """
    names1 = [normalize_header(h) for h in headers1]
    names2 = [normalize_header(h) for h in headers2]
    hints = []

    by_lower2 = {n.lower(): n for n in names2 if n}
    case_pairs = [
        f"'{n}' vs '{by_lower2[n.lower()]}'"
        for n in names1
        if n and n.lower() in by_lower2 and n != by_lower2[n.lower()]
    ]
    if case_pairs:
        hints.append(
            "these columns differ only by letter case and were not linked "
            "(matching is case-sensitive): " + ", ".join(sorted(set(case_pairs)))
        )

    for label, names in (("target", names1), ("supplemental", names2)):
        if len(names) == 1 and (";" in names[0] or "\t" in names[0]):
            delim = "semicolon" if ";" in names[0] else "tab"
            hints.append(
                f"the {label} file parsed as ONE column named '{names[0]}' — "
                f"is it {delim}-delimited? Save it as comma-separated CSV"
            )

    message = "No shared columns to match on."
    if hints:
        message += " Hint: " + "; ".join(hints)
    return ValueError(message)


def header_warnings(headers1, headers2, feature_names):
    """
    Dataset-level advisories about column names that LOOK like they should
    match but silently don't, plus reserved output names.

    Returns a list of human-readable warning strings:
    - case-only mismatches ('Rent' vs 'rent'): matching is case-sensitive,
      so these never link — a silent no-op the user almost never intends.
    - matched feature names that collide with the matcher's own output
      columns (euc_distance, nndr, flags, ...): the signature of feeding a
      previous run's linked output back in as an input.
    """
    names1 = {normalize_header(h) for h in headers1} - {""}
    names2 = {normalize_header(h) for h in headers2} - {""}
    shared = names1 & names2

    warnings = []

    lower1 = {}
    for n in names1:
        lower1.setdefault(n.lower(), set()).add(n)
    for n in sorted(names2):
        variants = lower1.get(n.lower())
        if variants and n not in variants and n not in shared:
            other = ", ".join(sorted(variants))
            warnings.append(
                f"columns '{other}' and '{n}' differ only by letter case and "
                f"were NOT linked — matching is case-sensitive; rename one if "
                f"they are the same variable"
            )

    reserved = RESERVED_OUTPUT_COLUMNS & {str(f) for f in feature_names}
    if reserved:
        warnings.append(
            "matching feature(s) "
            + ", ".join(sorted(reserved))
            + " have the same name as the matcher's own output columns — "
            "this usually means a previous run's linked output was fed back "
            "in as an input; exclude these columns from matching"
        )
    return warnings


# Column names the pipeline itself appends to the linked output. A shared
# input column with one of these names almost always means a linked output
# was re-fed as an input (see header_warnings).
RESERVED_OUTPUT_COLUMNS = {
    "euc_distance", "repeats", "nndr", "near_miss_count", "mnn_confirmed",
    "features_used", "exact_on_observed", "filled_from_match", "confidence",
    "flags",
}
