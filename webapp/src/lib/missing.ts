// Missing-cell semantics shared by the pre-run column stats and the
// diagnostics CSVs. Must agree with matcher.io.MISSING_TOKENS — a cell the
// matcher treats as missing must not be counted as observed here.

export const MISSING_TOKENS = new Set([
  "", "na", "n/a", "null", "none", "-", ".", "nan", "#n/a",
]);

export function isMissingCell(cell: string | undefined): boolean {
  if (cell === undefined) return true;
  return MISSING_TOKENS.has(
    cell.replace(/,/g, "").replace(/\$/g, "").trim().toLowerCase()
  );
}

export function parseNumeric(cell: string): number | null {
  if (isMissingCell(cell)) return null;
  const cleaned = cell.replace(/,/g, "").replace(/\$/g, "").trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export interface ColumnMissingStats {
  missing: number;
  total: number;
  /** repeated extreme value that looks like a missing-data code (9999, -999, …) */
  suspectSentinel: number | null;
}

// Common numeric missing-data codes. Flagged only when repeated (>1% of
// rows) AND sitting at the column's min or max — an ordinary value that
// happens to equal 99 in the middle of a distribution is not suspicious.
const SENTINEL_VALUES = new Set([
  9, 99, 999, 9999, 99999, -9, -99, -999, -9999,
]);

export function columnMissingStats(
  rows: string[][],
  colIdx: number
): ColumnMissingStats {
  let missing = 0;
  const counts = new Map<number, number>();
  let min = Infinity;
  let max = -Infinity;
  let observed = 0;
  for (const row of rows) {
    const cell = row[colIdx];
    if (isMissingCell(cell)) {
      missing++;
      continue;
    }
    const n = parseNumeric(cell!);
    if (n === null) continue;
    observed++;
    if (n < min) min = n;
    if (n > max) max = n;
    if (SENTINEL_VALUES.has(n)) {
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
  }

  let suspectSentinel: number | null = null;
  for (const [value, count] of counts) {
    if (count > rows.length * 0.01 && (value === min || value === max) && observed > count) {
      suspectSentinel = value;
      break;
    }
  }
  return { missing, total: rows.length, suspectSentinel };
}
