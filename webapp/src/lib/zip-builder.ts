// Builds the MVP results zip as specified in
// matcher/docs/output_format.md.
// All work is client-side; the zip blob is handed to the browser for download.

import JSZip from "jszip";
import Papa from "papaparse";
import type { AblationReport, MatchOutput, ParsedDataset } from "@/types";
import {
  AGREEMENT_TEXT,
  CONTACT_TEXT,
  buildDataStatsCsv,
  buildFeatureSmdCsv,
  buildMatchStatsCsv,
  buildReadmeText,
  buildRunInfoCsv,
  buildVariableDiagnosticsCsv,
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
  supplemental: ParsedDataset,
  ablation: AblationReport | null = null,
  /** when the package was generated; injected for deterministic tests */
  generatedAt: Date = new Date()
): Promise<Blob> {
  const zip = new JSZip();

  zip.file("README.txt", withBom(buildReadmeText(output, generatedAt)));
  // Report metadata at the root: which tool version processed the data,
  // when, by whom, and under which settings.
  zip.file(
    "run_info.csv",
    withBom(buildRunInfoCsv(output, target, supplemental, generatedAt, ablation))
  );

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
  zip.file(
    "diagnostics/variable_diagnostics.csv",
    withBom(buildVariableDiagnosticsCsv(output, ablation))
  );
  // Dataset-level warnings previously lived only in the UI — a researcher
  // reading the zip alone should see them too.
  zip.file(
    "diagnostics/warnings.txt",
    withBom(
      output.warnings.length > 0
        ? output.warnings.map((w) => `WARNING: ${w}`).join("\n") + "\n"
        : "No dataset-level warnings were raised for this run.\n"
    )
  );

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
