// HIPAA NOTE: No dataset contents should be logged or persisted.

import Papa from "papaparse";
import type { ParsedDataset } from "@/types";

export function parseCSVFile(file: File): Promise<ParsedDataset> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      complete(results) {
        const data = results.data as string[][];
        if (data.length < 2) {
          reject(new Error("CSV must have at least a header row and one data row."));
          return;
        }

        const headers = data[0]!;
        // Filter out empty trailing rows
        const rows = data.slice(1).filter((row) =>
          row.some((cell) => cell.trim() !== "")
        );

        resolve({ headers, rows, fileName: file.name });
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
