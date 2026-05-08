// Builds the MVP results zip as specified in
// version-3/docs/match_quality_brainstorm.md (Output Format section).
// All work is client-side; the zip blob is handed to the browser for download.

import JSZip from "jszip";
import Papa from "papaparse";
import type { MatchOutput, ParsedDataset } from "@/types";
import {
  AGREEMENT_TEXT,
  CONTACT_TEXT,
  README_TEXT,
  buildDataStatsCsv,
  buildFeatureSmdCsv,
  buildMatchStatsCsv,
} from "./summary";

function headerRowsToCsv(headers: string[], rows: string[][]): string {
  return Papa.unparse({ fields: headers, data: rows });
}

export async function buildResultsZip(
  output: MatchOutput,
  target: ParsedDataset,
  supplemental: ParsedDataset
): Promise<Blob> {
  const zip = new JSZip();

  zip.file("README.txt", README_TEXT);

  zip.file(
    "linked_dataset.csv",
    headerRowsToCsv(output.linked_headers, output.linked_rows)
  );

  zip.file(
    "results/match_detail.csv",
    headerRowsToCsv(output.detail_headers, output.detail_rows)
  );

  zip.file("diagnostics/data_stats.csv", buildDataStatsCsv(target, supplemental));
  zip.file("diagnostics/match_stats.csv", buildMatchStatsCsv(output));
  zip.file("diagnostics/feature_smd.csv", buildFeatureSmdCsv(output));

  // Preserve the exact bytes of the original uploads for reproducibility.
  zip.file("inputs/original_target.csv", target.file);
  zip.file("inputs/original_supplemental.csv", supplemental.file);

  zip.file("agreements/agreement.txt", AGREEMENT_TEXT);
  zip.file("agreements/contact.txt", CONTACT_TEXT);

  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Release the object URL on the next tick so the click completes first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
