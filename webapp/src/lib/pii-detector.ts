// Direct-identifier column names (names, SSNs, dates of birth, contact
// details, record numbers) — advisory only: these are not matching
// variables in any sane run, and the data-use agreement already excludes
// them. Geographic identifiers (ZIP, census tract, GEOID, coordinates,
// address) are HARD-BLOCKED instead — see lib/identifier-guard.ts.

import type { PIIWarning } from "@/types";

const PII_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bfirst.?name\b/i, reason: "May contain first names" },
  { pattern: /\blast.?name\b/i, reason: "May contain last names" },
  { pattern: /\bname\b/i, reason: "May contain personal names" },
  { pattern: /\bssn\b/i, reason: "May contain Social Security Numbers" },
  { pattern: /\bdob\b|\bbirth/i, reason: "May contain dates of birth" },
  { pattern: /\bphone\b/i, reason: "May contain phone numbers" },
  { pattern: /\bemail\b/i, reason: "May contain email addresses" },
  { pattern: /\bpatient\b/i, reason: "May contain patient identifiers" },
  { pattern: /\bmrn\b/i, reason: "May contain medical record numbers" },
];

export function detectPII(
  headers: string[],
  datasetLabel: "target" | "supplemental"
): PIIWarning[] {
  const warnings: PIIWarning[] = [];

  for (const header of headers) {
    for (const { pattern, reason } of PII_PATTERNS) {
      // snake_case/kebab-case headers (zip_code, patient-id) hide word
      // boundaries from \b; normalize separators to spaces before testing.
      const normalized = header.replace(/[_\-]+/g, " ");
      if (pattern.test(normalized)) {
        warnings.push({ columnName: header, datasetLabel, reason });
        break; // One warning per column
      }
    }
  }

  return warnings;
}
