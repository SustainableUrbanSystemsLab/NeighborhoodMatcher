import type { PIIWarning } from "@/types";

const PII_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bfirst.?name\b/i, reason: "May contain first names" },
  { pattern: /\blast.?name\b/i, reason: "May contain last names" },
  { pattern: /\bname\b/i, reason: "May contain personal names" },
  { pattern: /\bssn\b/i, reason: "May contain Social Security Numbers" },
  { pattern: /\bdob\b|\bbirth/i, reason: "May contain dates of birth" },
  { pattern: /\baddress\b/i, reason: "May contain street addresses" },
  { pattern: /\bphone\b/i, reason: "May contain phone numbers" },
  { pattern: /\bemail\b/i, reason: "May contain email addresses" },
  { pattern: /\bzip\b/i, reason: "May contain ZIP codes" },
  { pattern: /\bpatient\b/i, reason: "May contain patient identifiers" },
  { pattern: /\bmrn\b/i, reason: "May contain medical record numbers" },
  { pattern: /\bgeoid\b/i, reason: "May contain geographic identifiers" },
  { pattern: /\btract\b/i, reason: "May contain census tract IDs" },
];

export function detectPII(
  headers: string[],
  datasetLabel: "target" | "supplemental"
): PIIWarning[] {
  const warnings: PIIWarning[] = [];

  for (const header of headers) {
    for (const { pattern, reason } of PII_PATTERNS) {
      if (pattern.test(header)) {
        warnings.push({ columnName: header, datasetLabel, reason });
        break; // One warning per column
      }
    }
  }

  return warnings;
}
