"""
Identity and provenance of the tool: who wrote it, which version produced a
given set of results, and where to find the source.

Single source of truth. The webapp mirrors these values in
webapp/src/lib/about.ts (kept honest by tests/test_about.py) and gets the
authoritative copy at runtime from the `provenance` key that
web_api.coordinate_in_memory / assemble_results return — so a results
package always reports the version of the engine that actually ran, not
whatever the page was built with.
"""

from datetime import datetime, timezone

TOOL_NAME = "NeighborhoodMatcher"
VERSION = "0.8.4"
AUTHORS = ("Dr. Benson Ku", "Dr. Patrick Kastner")
ORGANIZATION = "Sustainable Urban Systems Lab"
REPO_URL = "https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher"
SITE_URL = "https://nbhdmatch.netlify.app/"
ORGANIZATION_URL = "https://sustainableurbansystems.com/"
# One entry per AUTHORS name that has a public profile to link to; an author
# with no entry is credited by name only. Keyed by the exact AUTHORS string
# so a typo here fails loudly (test_about.py) rather than silently un-linking.
AUTHOR_URLS = {
    "Dr. Benson Ku": "https://med.emory.edu/directory/profile/?u=BSKU",
}

__version__ = VERSION


def authors_line():
    """Authors as one display string: 'A and B' / 'A, B, and C'."""
    names = list(AUTHORS)
    if len(names) <= 1:
        return "".join(names)
    if len(names) == 2:
        return f"{names[0]} and {names[1]}"
    return ", ".join(names[:-1]) + f", and {names[-1]}"


def utc_timestamp(moment=None):
    """
    Run timestamp as an ISO-8601 UTC string, seconds precision
    ('2026-08-22T18:30:05Z'). moment: an aware datetime, or None for now.
    """
    if moment is None:
        moment = datetime.now(timezone.utc)
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def local_timestamp(moment=None):
    """
    The same instant in the machine's local time, with its UTC offset —
    what a researcher recognizes as 'when I ran this'. Falls back to the
    UTC string when the platform reports no local zone (some sandboxes).
    """
    if moment is None:
        moment = datetime.now(timezone.utc)
    local = moment.astimezone()
    stamp = local.strftime("%Y-%m-%d %H:%M:%S")
    offset = local.strftime("%z")
    if not offset:
        return utc_timestamp(moment)
    return f"{stamp} UTC{offset[:3]}:{offset[3:]}"


def provenance(moment=None):
    """
    Identity of the engine, ready to be written into a results package.

    Returns a JSON-safe dict; `generated_at_utc` / `generated_at_local`
    are omitted when moment is False (the browser stamps its own local
    time — Pyodide's clock has no timezone of its own).
    """
    info = {
        "tool": TOOL_NAME,
        "version": VERSION,
        "authors": list(AUTHORS),
        "authors_line": authors_line(),
        "organization": ORGANIZATION,
        "repo_url": REPO_URL,
        "site_url": SITE_URL,
    }
    if moment is not False:
        info["generated_at_utc"] = utc_timestamp(moment)
        info["generated_at_local"] = local_timestamp(moment)
    return info


def provenance_rows(moment=None, extra=None):
    """
    Provenance as ordered (key, value) rows for a CSV or a text header.
    extra: optional list of (key, value) run settings appended at the end.
    """
    info = provenance(moment)
    rows = [
        ("tool", info["tool"]),
        ("tool_version", info["version"]),
        ("authors", "; ".join(info["authors"])),
        ("organization", info["organization"]),
        ("repository", info["repo_url"]),
    ]
    if "generated_at_utc" in info:
        rows.append(("generated_at_utc", info["generated_at_utc"]))
        rows.append(("generated_at_local", info["generated_at_local"]))
    rows.extend(extra or [])
    return rows
