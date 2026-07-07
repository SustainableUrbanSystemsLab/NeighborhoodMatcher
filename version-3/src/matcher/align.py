def find_common_headers(headers1, headers2, exclude=None):
    """
    Finds columns present in both header lists.
    Returns a list of dicts: {headerName, header1Index, header2Index}.
    Columns in `exclude` are skipped even if shared.

    Names are compared with surrounding whitespace stripped (Excel routinely
    pads headers; a silent non-match here means the column just vanishes
    from the feature set). Empty / whitespace-only names — the artifact of a
    trailing comma on every line — are never linked: an all-missing ''
    feature would charge every pair the missing penalty and distort NNDR.

    Raises ValueError when a shared column name appears more than once in
    either file — a duplicate makes the name→index mapping ambiguous, and
    silently picking one occurrence would link the wrong data.
    """
    if exclude is None:
        exclude = []
    exclude = {e.strip() for e in exclude}

    names1 = [h.strip() for h in headers1]
    names2 = [h.strip() for h in headers2]

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
