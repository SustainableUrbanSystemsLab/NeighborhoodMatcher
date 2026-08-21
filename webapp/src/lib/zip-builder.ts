// Builds the MVP results zip as specified in
// matcher/docs/output_format.md.
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

// Flag strings contain em-dashes; without a BOM, Excel on Windows opens
// UTF-8 CSVs as ANSI and renders them as mojibake. Both import paths
// (PapaParse and the matcher's utf-8-sig reader) strip the BOM on re-feed.
function withBom(text: string): string {
  return "\uFEFF" + text;
}

export async function buildResultsZip(
  output: MatchOutput,
  target: ParsedDataset,
  supplemental: ParsedDataset
): Promise<Blob> {
  const zip = new JSZip();

  zip.file("README.txt", withBom(README_TEXT));

  zip.file(
    "linked_dataset.csv",
    withBom(headerRowsToCsv(output.linked_headers, output.linked_rows))
  );

  zip.file(
    "results/match_detail.csv",
    withBom(headerRowsToCsv(output.detail_headers, output.detail_rows))
  );

  zip.file("diagnostics/data_stats.csv", withBom(buildDataStatsCsv(target, supplemental)));
  zip.file("diagnostics/match_stats.csv", withBom(buildMatchStatsCsv(output)));
  zip.file("diagnostics/feature_smd.csv", withBom(buildFeatureSmdCsv(output)));

  // Preserve the exact bytes of the original uploads for reproducibility —
  // deliberately no BOM added here.
  zip.file("inputs/original_target.csv", target.file);
  zip.file("inputs/original_supplemental.csv", supplemental.file);

  zip.file("agreements/agreement.txt", withBom(AGREEMENT_TEXT));
  zip.file("agreements/contact.txt", withBom(CONTACT_TEXT));

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
