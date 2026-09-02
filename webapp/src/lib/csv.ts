// HIPAA NOTE: No dataset contents should be logged or persisted.

import Papa from "papaparse";
import type { ParsedDataset } from "@/types";

// A second header / label row — NDA and ABCD exports put variable
// descriptions on line 2 — is text where the rest of the column is numbers.
// Mirrors matcher/io.py (looks_like_label_row); keep the rule and the
// constants in sync (pinned by matcher/tests/test_label_row.py).
const LABEL_ROW_NUMERIC_SHARE = 0.8;
const LABEL_ROW_SAMPLE = 200;
const MISSING_TOKENS = new Set(["", "na", "n/a", "null", "none", "-", ".", "nan", "#n/a"]);

function isObserved(cell: string): boolean {
  return !MISSING_TOKENS.has(cell.trim().toLowerCase());
}

function isNumber(cell: string): boolean {
  const s = cell.replace(/[,$]/g, "").trim();
  if (!s || MISSING_TOKENS.has(s.toLowerCase())) return false;
  return Number.isFinite(Number(s));
}

/**
 * True when `row` reads as a second header or label row rather than data:
 * it repeats a column name, or it holds text (not a number, not a missing
 * token) in a column that is numeric in the rows that follow, and holds no
 * number anywhere. A row with any numeric cell is data.
 */
export function looksLikeLabelRow(
  headers: string[],
  row: string[],
  otherRows: string[][]
): boolean {
  const names = headers.map((h) => h.trim().toLowerCase());
  const cells = row.map((c) => c.trim());
  if (cells.some((c, j) => c !== "" && !!names[j] && c.toLowerCase() === names[j])) {
    return true;
  }
  const observed = cells
    .map((c, j) => [j, c] as const)
    .filter(([, c]) => isObserved(c));
  if (observed.length === 0 || observed.some(([, c]) => isNumber(c))) return false;
  const sample = otherRows.slice(0, LABEL_ROW_SAMPLE);
  for (const [j] of observed) {
    const col = sample.map((r) => r[j] ?? "").filter(isObserved);
    if (col.length > 0 && col.filter(isNumber).length / col.length >= LABEL_ROW_NUMERIC_SHARE) {
      return true;
    }
  }
  return false;
}

export interface ParseOptions {
  /** keep a detected label row in `rows` (the user overrode the skip) */
  keepLabelRow?: boolean;
}

export function parseCSVFile(
  file: File,
  options: ParseOptions = {}
): Promise<ParsedDataset> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      complete(results) {
        // Structural parse errors (unterminated quotes, delimiter chaos)
        // must fail loudly here: Papa.unparse would later pad/truncate the
        // damage into plausible-looking wrong-column data that Python's
        // rectangularity guard can no longer detect.
        if (results.errors.length > 0) {
          const first = results.errors[0]!;
          const where = first.row != null ? ` (row ${first.row + 1})` : "";
          reject(
            new Error(
              `Could not parse ${file.name}: ${first.message}${where}. ` +
                `Fix the file and re-upload.`
            )
          );
          return;
        }

        const data = results.data as string[][];
        if (data.length < 1 || data[0]!.every((c) => !c.trim())) {
          reject(new Error("CSV must have a header row."));
          return;
        }

        const headers = data[0]!;
        const rows = data.slice(1);

        // Trim TRAILING blank rows only. Interior blank-ish rows flow
        // through exactly like the CLI (all-missing rows), keeping
        // target_index aligned with the user's original file.
        while (
          rows.length &&
          rows[rows.length - 1]!.every((cell) => !cell.trim())
        ) {
          rows.pop();
        }

        if (rows.length < 1) {
          reject(new Error("CSV must have at least a header row and one data row."));
          return;
        }

        // Mirror Python's rectangularity guard with the user's real line
        // numbers (header = line 1).
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]!;
          const blank = row.every((cell) => !cell.trim());
          if (!blank && row.length !== headers.length) {
            reject(
              new Error(
                `${file.name}: line ${i + 2} has ${row.length} cells, ` +
                  `expected ${headers.length} (matching the header).`
              )
            );
            return;
          }
        }

        // Line 2 that is labels, not data: skip it (visibly — the upload
        // card shows the row and offers to keep it) so an NDA/ABCD export
        // runs instead of failing on "cannot parse 'pctPoor ' as a number".
        let labelRow: string[] | undefined;
        let labelRowSkipped = false;
        if (rows.length >= 1 && looksLikeLabelRow(headers, rows[0]!, rows.slice(1))) {
          labelRow = rows[0]!;
          if (!options.keepLabelRow) {
            rows.splice(0, 1);
            labelRowSkipped = true;
          }
        }
        if (rows.length < 1) {
          reject(
            new Error(
              `${file.name}: line 2 looks like a label row and there is no data below it.`
            )
          );
          return;
        }

        resolve({
          headers,
          rows,
          fileName: file.name,
          file,
          ...(labelRow ? { labelRow, labelRowSkipped } : {}),
        });
      },
      error(err) {
        reject(err);
      },
    });
  });
}

export function downloadCSV(
  headers: string[],
  rows: string[][],
  filename: string
): void {
  const csv = Papa.unparse({ fields: headers, data: rows });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
