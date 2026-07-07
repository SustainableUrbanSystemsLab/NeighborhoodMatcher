# NOTE: Human authorized


def find_common_headers(headers1, headers2, exclude=None):
    """
    Finds columns present in both header lists.
    Returns a list of dicts: {headerName, header1Index, header2Index}.
    Columns in `exclude` are skipped even if shared.
    """
    if exclude is None:
        exclude = []
    h2_lookup = {name: idx for idx, name in enumerate(headers2)}
    return [
        {"headerName": name, "header1Index": i, "header2Index": h2_lookup[name]}
        for i, name in enumerate(headers1)
        if name in h2_lookup and name not in exclude
    ]
