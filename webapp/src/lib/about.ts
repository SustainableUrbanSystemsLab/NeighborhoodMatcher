// Who made the tool, where it lives, and which build is serving this page.
//
// The identity constants MIRROR matcher/src/matcher/about.py, which is the
// single source of truth; matcher/tests/test_about.py fails if the two drift.
// For a results package, prefer the `provenance` that travels with the run
// (MatchOutput.provenance): it reports the ENGINE version that actually did
// the matching, which is what a reader of the report needs.

export const TOOL_NAME = "NeighborhoodMatcher";
/** Engine version this build ships (mirrors matcher/about.py VERSION). */
export const MATCHER_VERSION = "0.8.7";
export const AUTHORS = ["Dr. Benson Ku", "Dr. Patrick Kastner"] as const;
export const ORGANIZATION = "Sustainable Urban Systems Lab";
export const REPO_URL =
  "https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher";
export const SITE_URL = "https://nbhdmatch.netlify.app/";
export const ORGANIZATION_URL = "https://sustainableurbansystems.com/";
/** Mirrors matcher/about.py AUTHOR_URLS — one entry per AUTHORS name that has a public profile. */
export const AUTHOR_URLS: Partial<Record<(typeof AUTHORS)[number], string>> = {
  "Dr. Benson Ku": "https://med.emory.edu/directory/profile/?u=BSKU",
  // Same URL as ORGANIZATION_URL, written literally so the object-literal
  // parity test (test_webapp_mirror_matches_python_author_urls) can see it —
  // it reads quoted-string pairs, not identifier references.
  "Dr. Patrick Kastner": "https://sustainableurbansystems.com/",
};

/** Authors as one display string: "A and B" / "A, B, and C". */
export const AUTHORS_LINE =
  AUTHORS.length === 2
    ? `${AUTHORS[0]} and ${AUTHORS[1]}`
    : AUTHORS.length < 2
      ? AUTHORS.join("")
      : `${AUTHORS.slice(0, -1).join(", ")}, and ${AUTHORS[AUTHORS.length - 1]}`;

/** The deployed build (see vite.config.ts `define`). */
export const BUILD = {
  version: __APP_VERSION__,
  commit: __APP_COMMIT__,
  builtAt: __BUILD_TIME__,
} as const;

/** e.g. "v0.1.0 (build 19b1b35)" — omits an unknown commit. */
export function buildLabel(): string {
  return BUILD.commit && BUILD.commit !== "unknown"
    ? `v${BUILD.version} (build ${BUILD.commit})`
    : `v${BUILD.version}`;
}

/** ISO-8601 UTC to the second: "2026-08-22T18:30:05Z". */
export function utcTimestamp(at: Date): string {
  return at.toISOString().replace(/\.\d+Z$/, "Z");
}

/**
 * The same instant in the viewer's local time, with its UTC offset —
 * "2026-08-22 14:30:05 UTC-04:00". This is the "when I ran this" a
 * researcher recognizes; the UTC stamp is the one that sorts.
 */
export function localTimestamp(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
  // getTimezoneOffset() is minutes BEHIND UTC, so the sign flips.
  const offsetMin = -at.getTimezoneOffset();
  const sign = offsetMin < 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  return `${date} ${time} UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * Local date/time as a filename-safe prefix: "20260904-1704". Minute
 * precision, no separators within each part — sorts chronologically and
 * survives every filesystem, unlike localTimestamp's colons and spaces.
 */
export function filenameTimestamp(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `${date}-${time}`;
}
