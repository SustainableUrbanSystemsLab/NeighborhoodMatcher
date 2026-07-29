// HIPAA NOTE: No dataset contents should be logged or persisted.

import Papa from "papaparse";
import type { ParsedDataset } from "@/types";

export function parseCSVFile(file: File): Promise<ParsedDataset> {
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

        resolve({ headers, rows, fileName: file.name, file });
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
