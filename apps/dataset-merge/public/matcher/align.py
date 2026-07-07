def find_common_headers(headers1, headers2, exclude=None):
    """
    Finds columns present in both header lists.
    Returns a list of dicts: {headerName, header1Index, header2Index}.
    Columns in `exclude` are skipped even if shared.

    Raises ValueError when a shared column name appears more than once in
    either file — a duplicate makes the name→index mapping ambiguous, and
    silently picking one occurrence would link the wrong data.
    """
    if exclude is None:
        exclude = []

    def _duplicates(headers):
        seen, dupes = set(), set()
        for name in headers:
            if name in seen:
                dupes.add(name)
            seen.add(name)
        return dupes

    shared = set(headers1) & set(headers2)
    ambiguous = (_duplicates(headers1) | _duplicates(headers2)) & shared - set(exclude)
    if ambiguous:
        raise ValueError(
            "Duplicate column name(s) shared between the files: "
            + ", ".join(sorted(ambiguous))
            + " — rename or exclude them; matching on an ambiguous column is unsafe."
        )

    h2_lookup = {name: idx for idx, name in enumerate(headers2)}
    return [
        {"headerName": name, "header1Index": i, "header2Index": h2_lookup[name]}
        for i, name in enumerate(headers1)
        if name in h2_lookup and name not in exclude
    ]
