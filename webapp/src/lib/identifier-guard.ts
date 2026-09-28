// Geographic-identifier guard — the webapp mirror of matcher/identifiers.py.
//
// ZIP codes, census tract IDs and other location identifiers are never
// matching variables: a match "on" a tract ID is a match on location, the
// re-identification path this tool exists to avoid (HIPAA / PII). The Python
// engine enforces the rule (auto-linked identifiers are dropped with a
// warning; explicitly linked ones are refused); this module lets the Link
// step show the same verdicts BEFORE a run, so a blocked column is visible
// and explained rather than silently missing.
//
// The pattern lists below are plain strings in JSON form, byte-identical to
// the Python module — matcher/tests/test_identifiers.py parses this file
// and fails if the two drift. Keep the regex dialect to what `re` and
// JavaScript share (\b | ? \d {n} ( ) and literal words).

import { MISSING_TOKENS } from "@/lib/missing";
import type { ColumnLink, IdentifierBlock, IdentifierKind, ParsedDataset } from "@/types";

// [pattern, kind, what the values are]
export const IDENTIFIER_NAME_PATTERNS: ReadonlyArray<[string, IdentifierKind, string]> = [
  ["\\bzip ?code\\b|\\bzip\\b|\\bzcta\\d*\\b|\\bpostal ?code\\b|\\bpostal\\b|\\bpostcode\\b", "zip", "ZIP / postal codes"],
  ["\\bcensus ?tract\\b|\\btract\\b|\\btractce\\b|\\btract ?id\\b|\\bct ?20\\d\\d\\b", "tract", "census tract identifiers"],
  ["\\bgeoid\\d*\\b|\\bgisjoin\\b|\\bfips\\b|\\bstatefp\\b|\\bcountyfp\\b|\\btractfp\\b|\\bblkgrp\\b|\\bblock ?group\\b|\\bbg ?id\\b|\\bcounty (code|id|fips)\\b|\\bstate (code|id|fips)\\b|\\bblock (code|id)\\b", "geoid", "GEOID / FIPS codes"],
  ["\\blat\\b|\\blatitude\\b|\\blon\\b|\\blng\\b|\\blongitude\\b|\\bx ?coord(inate)?\\b|\\by ?coord(inate)?\\b|\\beasting\\b|\\bnorthing\\b", "coordinate", "geographic coordinates"],
  ["\\baddress\\b|\\baddr\\b", "address", "street addresses"],
];

// Anchored shapes applied to stripped cells with a trailing ".0" removed
// (pandas writes int columns that hold a NaN as floats).
export const IDENTIFIER_VALUE_SHAPES: ReadonlyArray<[string, IdentifierKind, string]> = [
  ["^\\d{10,11}$", "tract", "10- or 11-digit census tract GEOIDs"],
  ["^\\d{12}$", "geoid", "12-digit block-group GEOIDs"],
  ["^\\d{15}$", "geoid", "15-digit census block GEOIDs"],
  ["^\\d{5}-\\d{4}$", "zip", "ZIP+4 codes"],
];
// Five-digit codes count only when a leading zero proves they are codes
// rather than counts or dollars (median_income is ≥ 90 % five-digit).
export const FIVE_DIGIT = "^\\d{5}$";
export const FIVE_DIGIT_LEADING_ZERO = "^0\\d{4}$";

export const VALUE_SHAPE_SHARE = 0.9;
export const VALUE_SHAPE_MIN_OBSERVED = 20;
export const VALUE_SHAPE_MIN_DISTINCT = 2;
export const VALUE_SHAPE_SAMPLE = 5000;

const NAME_RES = IDENTIFIER_NAME_PATTERNS.map(
  ([p, kind, what]) => [new RegExp(p), kind, what] as const
);
const SHAPE_RES = IDENTIFIER_VALUE_SHAPES.map(
  ([p, kind, what]) => [new RegExp(p), kind, what] as const
);
const FIVE_DIGIT_RE = new RegExp(FIVE_DIGIT);
const FIVE_DIGIT_LEADING_ZERO_RE = new RegExp(FIVE_DIGIT_LEADING_ZERO);
const FLOAT_ZERO = /\.0+$/;

export interface IdentifierVerdict {
  kind: IdentifierKind;
  /** e.g. "census tract identifiers (by column name)" */
  reason: string;
}

/** 'ZipCode' → 'zip code', 'tract_geoid' → 'tract geoid' (mirrors normalize_name). */
export function normalizeName(header: string): string {
  return header
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_\-./]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function identifierByName(header: string): IdentifierVerdict | null {
  const name = normalizeName(header);
  for (const [re, kind, what] of NAME_RES) {
    if (re.test(name)) return { kind, reason: `${what} (by column name)` };
  }
  return null;
}

function observedCodes(cells: ReadonlyArray<string | undefined>): string[] {
  const out: string[] = [];
  const n = Math.min(cells.length, VALUE_SHAPE_SAMPLE);
  for (let i = 0; i < n; i++) {
    const c = (cells[i] ?? "").trim();
    if (MISSING_TOKENS.has(c.toLowerCase())) continue;
    out.push(c.replace(FLOAT_ZERO, ""));
  }
  return out;
}

export function identifierByValues(
  cells: ReadonlyArray<string | undefined>
): IdentifierVerdict | null {
  const codes = observedCodes(cells);
  if (codes.length < VALUE_SHAPE_MIN_OBSERVED) return null;
  if (new Set(codes).size < VALUE_SHAPE_MIN_DISTINCT) return null;
  const need = VALUE_SHAPE_SHARE * codes.length;
  for (const [re, kind, what] of SHAPE_RES) {
    const hits = codes.filter((c) => re.test(c)).length;
    if (hits >= need) {
      return { kind, reason: `${what} (${hits} of ${codes.length} observed values) (by its values)` };
    }
  }
  const five = codes.filter((c) => FIVE_DIGIT_RE.test(c)).length;
  if (five >= need && codes.some((c) => FIVE_DIGIT_LEADING_ZERO_RE.test(c))) {
    return {
      kind: "zip",
      reason:
        `5-digit codes with leading zeros, i.e. ZIP or FIPS codes ` +
        `(${five} of ${codes.length} observed values) (by its values)`,
    };
  }
  return null;
}

/** One verdict per column of the dataset (null = usable as a variable). */
export function columnVerdicts(dataset: ParsedDataset): (IdentifierVerdict | null)[] {
  return dataset.headers.map((header, i) => {
    const byName = identifierByName(header);
    if (byName) return byName;
    return identifierByValues(dataset.rows.map((row) => row[i]));
  });
}

/**
 * Applies the guard to a link list: a link touching an identifier column on
 * either side comes back `excluded: true` with `blocked` explaining why; any
 * other link is returned unchanged (with a stale `blocked` cleared). Idempotent,
 * so callers can run every link update through it.
 */
export function guardLinks(
  links: ColumnLink[],
  target: ParsedDataset,
  supplemental: ParsedDataset,
  targetVerdicts: (IdentifierVerdict | null)[],
  suppVerdicts: (IdentifierVerdict | null)[]
): ColumnLink[] {
  return links.map((link) => {
    const t = targetVerdicts[link.targetIndex] ?? null;
    const s = suppVerdicts[link.supplementalIndex] ?? null;
    if (!t && !s) {
      if (!link.blocked) return link;
      const { blocked: _dropped, ...rest } = link;
      return rest;
    }
    const side: IdentifierBlock["side"] = t && s ? "both" : t ? "target" : "supplemental";
    const verdict = (t ?? s)!;
    const column =
      side === "supplemental"
        ? supplemental.headers[link.supplementalIndex] ?? link.headerName
        : target.headers[link.targetIndex] ?? link.headerName;
    const blocked: IdentifierBlock = { kind: verdict.kind, side, column, reason: verdict.reason };
    return { ...link, excluded: true, blocked };
  });
}

/** Human sentence for a blocked link, used by the Link step and run_info. */
export function blockedSentence(b: IdentifierBlock): string {
  const where = b.side === "both" ? "" : ` (${b.side} file)`;
  return `${b.column}${where}: ${b.reason}`;
}
