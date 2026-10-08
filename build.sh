#!/bin/sh
# Builds NeighborhoodMatcher: the website, the self-host zip, and the desktop
# app for this computer (macOS: .dmg), all collected in release/.
#
#   ./build.sh              everything
#   ./build.sh --web-only   without the desktop app (no Rust needed)
#   ./build.sh --test       everything, plus all tests and the app's self-test
#   ./build.sh --help       prerequisites and outputs
#
# The steps live in scripts/build-all.mjs, shared with build.bat (Windows).
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "error: Node.js 20 or newer is required: https://nodejs.org/" >&2
  exit 1
fi
exec node scripts/build-all.mjs "$@"
