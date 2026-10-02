#!/bin/sh
# Installs NeighborhoodMatcher on a Mac without the "Apple could not verify"
# block. macOS vets an app on its first launch only when the file carries the
# quarantine flag that browsers put on downloads; curl sets no such flag, so an
# app installed this way opens like any other. One line, from Terminal:
#
#   curl -fsSL https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/releases/latest/download/install-macos.sh | sh
#
# It downloads the latest release's .dmg, copies the app into /Applications
# (~/Applications when /Applications is not writable), replacing an older copy,
# checks its signature and opens it. Nothing else is changed; uninstall by
# dragging the app to the Trash. The app itself never uses the network.
#
# Environment variables (the build's own test of this script uses them):
#   NBHDMATCH_DMG          a .dmg to install instead of downloading one
#   NBHDMATCH_INSTALL_DIR  where to put the app (default: /Applications)
#   NBHDMATCH_NO_OPEN=1    do not open the app afterwards
set -eu

RELEASE_DMG="https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/releases/latest/download/NeighborhoodMatcher-darwin-aarch64.dmg"
APP="NeighborhoodMatcher.app"

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = Darwin ] || die "this installer is for macOS. Windows: NeighborhoodMatcher-windows-x64-setup.exe from the same release."
# hw.optional.arm64 is 1 on Apple Silicon even in a Rosetta terminal, where uname -m says x86_64.
[ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = 1 ] ||
  die "the desktop app is built for Apple Silicon (M1 or later); this Mac is $(uname -m). The website runs on any Mac: https://nbhdmatch.netlify.app/"

work=$(mktemp -d "${TMPDIR:-/tmp}/nbhdmatch-install.XXXXXX")
mount=""
cleanup() {
  if [ -n "$mount" ]; then
    hdiutil detach "$mount" -quiet 2>/dev/null || hdiutil detach "$mount" -force -quiet 2>/dev/null || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

dmg="${NBHDMATCH_DMG:-}"
if [ -z "$dmg" ]; then
  dmg="$work/NeighborhoodMatcher.dmg"
  say "Downloading the latest NeighborhoodMatcher release..."
  curl -fL --progress-bar -o "$dmg" "$RELEASE_DMG" || die "download failed: $RELEASE_DMG"
elif [ ! -f "$dmg" ]; then
  die "no such file: $dmg"
fi

mount="$work/dmg"
mkdir "$mount"
hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$mount" "$dmg" >/dev/null || die "could not open the disk image $dmg"
[ -d "$mount/$APP" ] || die "$APP is not in the disk image"

dest="${NBHDMATCH_INSTALL_DIR:-}"
if [ -z "$dest" ]; then
  if [ -w /Applications ]; then dest=/Applications; else dest="$HOME/Applications"; fi
fi
mkdir -p "$dest"
target="$dest/$APP"

if pgrep -qf "/$APP/Contents/MacOS/" 2>/dev/null; then
  die "NeighborhoodMatcher is running. Quit it, then run this installer again."
fi

if [ -e "$target" ]; then
  old=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$target/Contents/Info.plist" 2>/dev/null || echo "?")
  say "Replacing NeighborhoodMatcher $old in $dest..."
  rm -rf "$target"
else
  say "Installing into $dest..."
fi
ditto "$mount/$APP" "$target"
# A .dmg downloaded with a browser carries the quarantine flag and so would the
# copy; the installed app must not, or macOS blocks it at first launch.
xattr -dr com.apple.quarantine "$target" 2>/dev/null || true
codesign --verify --deep --strict "$target" 2>/dev/null ||
  die "the installed app failed its signature check. Delete $target and run this installer again."

version=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$target/Contents/Info.plist" 2>/dev/null || echo "?")
say "Installed NeighborhoodMatcher $version: $target"
if [ "${NBHDMATCH_NO_OPEN:-0}" != 1 ]; then
  say "Opening it. Next time, open it from the Applications folder or Launchpad."
  open "$target"
fi
