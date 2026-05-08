// Summary CSV generators for the results zip package.
// All work is client-side; no dataset contents leave the browser.

import Papa from "papaparse";
import type { MatchOutput, ParsedDataset } from "@/types";

const SMD_WARN = 0.10;
const SMD_POOR = 0.25;

function isMissingCell(cell: string | undefined): boolean {
  if (cell === undefined) return true;
  const v = cell.trim();
  return v === "" || v.toUpperCase() === "NA";
}

function parseNumeric(cell: string): number | null {
  const cleaned = cell.replace(/,/g, "").replace(/\$/g, "").trim();
  if (cleaned === "" || cleaned.toUpperCase() === "NA") return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function columnStats(rows: string[][], colIdx: number) {
  let count = 0;
  let missing = 0;
  const nums: number[] = [];
  for (const row of rows) {
    const cell = row[colIdx];
    if (isMissingCell(cell)) {
      missing++;
      continue;
    }
    count++;
    const n = parseNumeric(cell!);
    if (n !== null) nums.push(n);
  }

  if (nums.length === 0) {
    return { count, missing, mean: "", std: "", min: "", max: "" };
  }
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance =
    nums.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, nums.length - 1);
  const std = Math.sqrt(variance);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return {
    count,
    missing,
    mean: mean.toFixed(6),
    std: std.toFixed(6),
    min: min.toFixed(6),
    max: max.toFixed(6),
  };
}

export function buildDataStatsCsv(
  target: ParsedDataset,
  supplemental: ParsedDataset
): string {
  const header = [
    "dataset",
    "column",
    "count_nonmissing",
    "missing",
    "mean",
    "std",
    "min",
    "max",
  ];
  const rows: (string | number)[][] = [];

  for (let i = 0; i < target.headers.length; i++) {
    const s = columnStats(target.rows, i);
    rows.push([
      "target",
      target.headers[i]!,
      s.count,
      s.missing,
      s.mean,
      s.std,
      s.min,
      s.max,
    ]);
  }
  for (let i = 0; i < supplemental.headers.length; i++) {
    const s = columnStats(supplemental.rows, i);
    rows.push([
      "supplemental",
      supplemental.headers[i]!,
      s.count,
      s.missing,
      s.mean,
      s.std,
      s.min,
      s.max,
    ]);
  }

  return Papa.unparse({ fields: header, data: rows });
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo]!;
  const frac = idx - lo;
  return sortedAsc[lo]! * (1 - frac) + sortedAsc[hi]! * frac;
}

export function buildMatchStatsCsv(output: MatchOutput): string {
  const { summary, per_target } = output;
  const total = summary.total;
  const distances = per_target.map((r) => r.best_distance).sort((a, b) => a - b);
  const nndrs = per_target.map((r) => r.nndr);

  const nearMissRows = per_target.filter((r) => r.near_miss > 0).length;
  const tiedRows = per_target.filter((r) => r.repeats > 1).length;

  const pct = (n: number) => (total ? ((n / total) * 100).toFixed(2) : "0.00");

  const metrics: [string, string | number][] = [
    ["total_rows", total],
    ["flagged_count", summary.flagged],
    ["flagged_pct", pct(summary.flagged)],
    ["mnn_confirmed_count", summary.mnn_confirmed],
    ["mnn_confirmed_pct", pct(summary.mnn_confirmed)],
    ["rows_with_near_miss", nearMissRows],
    ["rows_with_near_miss_pct", pct(nearMissRows)],
    ["rows_with_ties", tiedRows],
    ["rows_with_ties_pct", pct(tiedRows)],
    ["threshold_nndr", summary.threshold.toFixed(4)],
    ["mean_best_distance", summary.mean_best_distance.toFixed(6)],
    [
      "median_best_distance",
      percentile(distances, 0.5).toFixed(6),
    ],
    ["p25_best_distance", percentile(distances, 0.25).toFixed(6)],
    ["p75_best_distance", percentile(distances, 0.75).toFixed(6)],
    ["min_best_distance", (distances[0] ?? 0).toFixed(6)],
    [
      "max_best_distance",
      (distances[distances.length - 1] ?? 0).toFixed(6),
    ],
    ["mean_nndr", summary.mean_nndr.toFixed(6)],
    [
      "median_nndr",
      percentile([...nndrs].sort((a, b) => a - b), 0.5).toFixed(6),
    ],
  ];

  return Papa.unparse({
    fields: ["metric", "value"],
    data: metrics,
  });
}

export function buildFeatureSmdCsv(output: MatchOutput): string {
  const rows = output.feature_names.map((name, i) => {
    const v = output.smd[i] ?? 0;
    const flag =
      Math.abs(v) > SMD_POOR
        ? "poor"
        : Math.abs(v) > SMD_WARN
          ? "warning"
          : "ok";
    return [name, v.toFixed(6), flag];
  });
  return Papa.unparse({
    fields: ["feature", "smd", "flag"],
    data: rows,
  });
}

export const AGREEMENT_TEXT = `Dataset Matcher — Data Use Acknowledgments

By generating this results package, the user confirmed:

1. The input datasets do not contain PHI, direct identifiers (names, SSNs,
   addresses, medical record numbers), or other personally identifiable
   information (PII).

2. They understand that the matching process may generate results that
   constitute PHI or enable re-identification of individuals, and they
   accept responsibility for handling such outputs appropriately.

3. They have proper authorization and appropriate data use agreements in
   place to access, use, and link these datasets for their stated research
   purpose.

4. They will handle all input data and generated results in compliance
   with their institution's data governance policies, applicable IRB
   protocols, and relevant regulations (HIPAA, FERPA, etc.).

Note: this agreement text is the MVP placeholder — formal legal review
is pending.
`;

export const CONTACT_TEXT = `Contact information

TBD — placeholder. Replace before distributing the tool externally.
`;

export const README_TEXT = `Dataset Matcher — Results Package

Folder layout:

  linked_dataset.csv        Primary output. Target rows with matched
                            supplemental columns appended.

  results/
    match_detail.csv        Per-row diagnostics: distance, NNDR, MNN
                            confirmation, flags, repeats, near-miss count.

  diagnostics/
    data_stats.csv          Per-column summary stats for both inputs.
    match_stats.csv         Dataset-level match quality metrics.
    feature_smd.csv         Standardized mean difference per feature,
                            with balance flag (ok / warning / poor).

  inputs/
    original_target.csv         Unmodified bytes of the uploaded target.
    original_supplemental.csv   Unmodified bytes of the uploaded supplemental.

  agreements/
    agreement.txt           Data-use acknowledgments confirmed at upload.
    contact.txt             Contact information for the tool maintainers.
`;
