#!/usr/bin/env python3
"""
Bump the tool version everywhere it is declared — every change ships with a
version bump (see README "Versioning"), and CI refuses a pull request that
changes shipped code without one.

    python scripts/bump_version.py patch|minor|major   # bump
    python scripts/bump_version.py --set 1.2.3         # set explicitly
    python scripts/bump_version.py --check             # verify all copies agree

Semantic versioning: PATCH for fixes, copy and visual polish; MINOR for new
behaviour (a new signal, control, output column or file); MAJOR when an
output format or the CLI/Python API changes incompatibly.
"""
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEMVER = r"(\d+)\.(\d+)\.(\d+)"
SYNC_SCRIPT = ROOT / "webapp" / "scripts" / "sync-assets.mjs"

# (path, regex with one capture group around the version)
DECLARATIONS = [
    ("matcher/src/matcher/about.py", r'^VERSION = "(' + SEMVER + r')"$'),
    ("webapp/src/lib/about.ts", r'^export const MATCHER_VERSION = "(' + SEMVER + r')";$'),
    ("webapp/package.json", r'^  "version": "(' + SEMVER + r')",$'),
    ("matcher/pyproject.toml", r'^version = "(' + SEMVER + r')"$'),
    ("pyproject.toml", r'^version = "(' + SEMVER + r')"$'),
]


def read(path):
    raw = (ROOT / path).read_bytes().decode("utf-8")
    return raw.replace("\r\n", "\n"), "\r\n" in raw


def write(path, text, crlf):
    (ROOT / path).write_bytes((text.replace("\n", "\r\n") if crlf else text).encode("utf-8"))


def current():
    found = {}
    for path, pattern in DECLARATIONS:
        text, _ = read(path)
        m = re.search(pattern, text, re.M)
        if not m:
            sys.exit(f"{path}: no version declaration matching {pattern!r}")
        found[path] = m.group(1)
    versions = set(found.values())
    if len(versions) != 1:
        lines = "\n".join(f"  {p}: {v}" for p, v in found.items())
        sys.exit(f"version declarations disagree:\n{lines}")
    return versions.pop()


def bump(old, part):
    major, minor, patch = (int(x) for x in old.split("."))
    if part == "major":
        return f"{major + 1}.0.0"
    if part == "minor":
        return f"{major}.{minor + 1}.0"
    if part == "patch":
        return f"{major}.{minor}.{patch + 1}"
    sys.exit(f"unknown part {part!r} (patch|minor|major)")


def set_version(new):
    if not re.fullmatch(SEMVER, new):
        sys.exit(f"{new!r} is not MAJOR.MINOR.PATCH")
    for path, pattern in DECLARATIONS:
        text, crlf = read(path)
        text, n = re.subn(pattern, lambda m: m.group(0).replace(m.group(1), new), text, count=1, flags=re.M)
        assert n == 1, path
        write(path, text, crlf)
    resync_webapp_copy()


def resync_webapp_copy():
    """
    webapp/public/matcher/*.py is a build-time COPY of matcher/src/matcher/
    (made by sync-assets.mjs, normally run as vite's predev/prebuild hook),
    not a second declaration this script rewrites directly. A version bump
    edits the source (about.py) but never touches the copy, so without this
    step the copy silently falls behind — exactly the failure this function
    exists to make impossible: CI's "webapp matcher copy is in sync" check
    diffs the two and fails on any drift, version included.
    """
    node = shutil.which("node")
    if node is None:
        print(
            "warning: node not found, could not re-sync webapp/public/matcher/ — "
            "run `pnpm build` (or `node webapp/scripts/sync-assets.mjs`) before committing",
            file=sys.stderr,
        )
        return
    subprocess.run([node, str(SYNC_SCRIPT)], cwd=ROOT, check=True)


def main(argv):
    old = current()
    if argv == ["--check"] or not argv:
        print(old)
        return
    if argv[0] == "--set" and len(argv) == 2:
        new = argv[1]
    elif len(argv) == 1:
        new = bump(old, argv[0])
    else:
        sys.exit(__doc__)
    set_version(new)
    print(f"{old} -> {new}")
    for path, _ in DECLARATIONS:
        print(f"  {path}")


if __name__ == "__main__":
    main(sys.argv[1:])
