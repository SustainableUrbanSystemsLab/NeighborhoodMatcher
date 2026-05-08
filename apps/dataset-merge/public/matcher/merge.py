# NOTE: Human authorized


def row_merge(target_row, supplemental_row, common):
    """Appends non-shared supplemental columns to a target row."""
    shared_s_indices = {col["header2Index"] for col in common}
    extras = [val for i, val in enumerate(supplemental_row) if i not in shared_s_indices]
    return target_row + extras


def new_header(target_headers, supplemental_headers, common):
    """Builds the merged header list, excluding shared supplemental columns."""
    shared_s_indices = {col["header2Index"] for col in common}
    return target_headers + [
        h for i, h in enumerate(supplemental_headers) if i not in shared_s_indices
    ]
