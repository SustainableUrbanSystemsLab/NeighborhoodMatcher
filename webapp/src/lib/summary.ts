// Summary CSV generators for the results zip package.
// All work is client-side; no dataset contents leave the browser.

import Papa from "papaparse";
import { isMissingCell, parseNumeric } from "@/lib/missing";
import type { AblationReport, MatchOutput, ParsedDataset, ColumnLink } from "@/types";
import {
  AUTHORS_LINE,
  ORGANIZATION,
  TOOL_NAME,
  REPO_URL,
  buildLabel,
  localTimestamp,
  utcTimestamp,
} from "@/lib/about";

const SMD_WARN = 0.10;
const SMD_POOR = 0.25;

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
  // no-match rows have null distance/nndr — exclude them from the stats
  const matched = per_target.filter((r) => !r.no_match);
  const distances = matched
    .map((r) => r.best_distance as number)
    .sort((a, b) => a - b);
  const nndrs = matched.map((r) => r.nndr as number);

  const nearMissRows = per_target.filter((r) => r.near_miss > 0).length;
  const tiedRows = per_target.filter((r) => r.repeats > 1).length;

  const pct = (n: number) => (total ? ((n / total) * 100).toFixed(2) : "0.00");

  const tiers = summary.tiers ?? {};
  const metrics: [string, string | number][] = [
    ["total_rows", total],
    ["no_match_count", summary.no_match],
    ["rejected_by_cutoff_count", summary.rejected ?? 0],
    [
      "max_distance_cutoff",
      summary.max_distance != null ? summary.max_distance.toFixed(4) : "off",
    ],
    ["withheld_below_min_confidence", summary.withheld ?? 0],
    ["min_confidence_filter", summary.min_confidence ?? "off"],
    ["confidence_high", tiers["High"] ?? 0],
    ["confidence_medium", tiers["Medium"] ?? 0],
    ["confidence_low", tiers["Low"] ?? 0],
    ["confidence_no_match", tiers["No match"] ?? 0],
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

const fmt = (v: number | null | undefined, digits = 6): string =>
  v == null ? "" : v.toFixed(digits);

/**
 * Per-variable diagnostics: the always-on input report (missingness,
 * definition-shift check, distance share) plus — when the variable check
 * has run — the leave-one-variable-out columns and verdict.
 */
export function buildVariableDiagnosticsCsv(
  output: MatchOutput,
  ablation: AblationReport | null
): string {
  const byFeature = new Map(
    (ablation?.variables ?? []).map((v) => [v.feature, v])
  );
  const rows = (output.variables ?? []).map((v) => {
    const abl = byFeature.get(v.feature);
    return [
      v.feature,
      fmt(v.target_missing_pct, 2),
      fmt(v.supp_missing_pct, 2),
      fmt(v.offset_smd),
      fmt(v.spread_ratio),
      fmt(v.distance_share),
      ablation ? ablation.sample_size : "",
      ablation ? (ablation.sampled ? 1 : 0) : "",
      abl ? fmt(ablation!.baseline.mnn_confirmed_pct, 2) : "",
      abl ? fmt(abl.metrics.mnn_confirmed_pct, 2) : "",
      abl ? fmt(abl.delta_mnn_pct, 2) : "",
      abl ? fmt(ablation!.baseline.high_pct, 2) : "",
      abl ? fmt(abl.metrics.high_pct, 2) : "",
      abl ? fmt(abl.delta_high_pct, 2) : "",
      abl ? fmt(abl.metrics.median_nndr, 4) : "",
      abl ? abl.verdict : "",
      v.notes,
    ];
  });
  return Papa.unparse({
    fields: [
      "feature",
      "target_missing_pct",
      "supp_missing_pct",
      "offset_smd",
      "spread_ratio",
      "distance_share",
      "ablation_sample_size",
      "ablation_sampled",
      "baseline_mnn_pct",
      "mnn_pct_without",
      "delta_mnn_pct",
      "baseline_high_pct",
      "high_pct_without",
      "delta_high_pct",
      "median_nndr_without",
      "ablation_verdict",
      "notes",
    ],
    data: rows,
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

${TOOL_NAME} is developed by ${AUTHORS_LINE}
(${ORGANIZATION}).

Source code, issues, and releases:
${REPO_URL}

Direct contact details: TBD — placeholder. Add before distributing the
tool externally.
`;

/**
 * Report metadata: who made the tool, which engine version processed this
 * data, when the package was generated, and the settings in force. Written
 * at the zip root (not diagnostics/) — it describes the report itself.
 *
 * The tool identity comes from `output.provenance`, i.e. the engine that
 * actually ran, not the page build; the page build is recorded separately
 * so a bug can be traced to either side.
 */
export function buildRunInfoCsv(
  output: MatchOutput,
  target: ParsedDataset,
  supplemental: ParsedDataset,
  links: ColumnLink[],
  generatedAt: Date,
  ablation: AblationReport | null = null
): string {
  // Which target column was matched to which supplemental column. A restore
  // needs this to re-create manual links between differently named columns
  // — `matching_variables` names only the target side.
  const columnLinks = links
    .filter((l) => !l.excluded)
    .map((l) => [
      target.headers[l.targetIndex] ?? l.headerName,
      supplemental.headers[l.supplementalIndex] ?? l.headerName,
    ]);
  const p = output.provenance;
  const { summary } = output;
  const rows: [string, string | number][] = [
    ["tool", p?.tool ?? "NeighborhoodMatcher"],
    ["tool_version", p?.version ?? "unknown"],
    ["authors", (p?.authors ?? []).join("; ") || AUTHORS_LINE],
    ["organization", p?.organization ?? ORGANIZATION],
    ["repository", p?.repo_url ?? REPO_URL],
    ["generated_at_utc", utcTimestamp(generatedAt)],
    ["generated_at_local", localTimestamp(generatedAt)],
    ["run_environment", "browser (client-side; data never left this device)"],
    ["webapp_build", buildLabel()],
    ["target_file", target.fileName],
    ["supplemental_file", supplemental.fileName],
    ["target_rows", target.rows.length],
    ["supplemental_rows", supplemental.rows.length],
    ["matching_variables", output.feature_names.join("; ")],
    ["column_links", JSON.stringify(columnLinks)],
    ["nndr_threshold", summary.threshold],
    [
      "max_distance_cutoff",
      summary.max_distance != null ? summary.max_distance : "off",
    ],
    ["min_confidence_filter", summary.min_confidence ?? "off"],
    [
      "variable_ablation",
      ablation
        ? ablation.sampled
          ? `on (sampled ${ablation.sample_size} of ${ablation.n_targets} rows)`
          : `on (all ${ablation.n_targets} rows)`
        : "not run",
    ],
  ];
  return Papa.unparse({ fields: ["key", "value"], data: rows });
}

/** README.txt: provenance header followed by the folder guide. */
export function buildReadmeText(
  output: MatchOutput,
  generatedAt: Date
): string {
  const p = output.provenance;
  const header = [
    `${p?.tool ?? "NeighborhoodMatcher"} — Results Package`,
    "",
    `Tool version:  ${p?.version ?? "unknown"} (matching engine)`,
    `Webapp build:  ${buildLabel()}`,
    `Generated:     ${localTimestamp(generatedAt)}  /  ${utcTimestamp(generatedAt)}`,
    `Authors:       ${p?.authors_line ?? AUTHORS_LINE}`,
    `Organization:  ${p?.organization ?? ORGANIZATION}`,
    `Source:        ${p?.repo_url ?? REPO_URL}`,
    "",
    "Machine-readable copy of the above, plus the settings this run used:",
    "run_info.csv.",
    "",
  ].join("\n");
  return header + README_LAYOUT;
}

const README_LAYOUT = `
Folder layout:

  run_info.csv              Tool version, authors, generation timestamp,
                            and the settings this run used.

  linked_dataset.csv        Primary output. Target rows with matched
                            supplemental columns appended, plus per-row
                            quality columns: confidence (High / Medium /
                            Low / No match), features_used,
                            exact_on_observed, filled_from_match (shared
                            columns whose missing target value was filled
                            from the matched row), and flags.

  results/
    match_detail.csv        Per-row diagnostics: distance, NNDR, MNN
                            confirmation, confidence, features used,
                            flags, near-miss count, missing-feature counts.

  diagnostics/
    data_stats.csv          Per-column summary stats for both inputs.
    match_stats.csv         Dataset-level match quality metrics.
    feature_smd.csv         Standardized mean difference per feature,
                            with balance flag (ok / warning / poor).
    variable_diagnostics.csv  Per matching variable: missingness on each
                            side, offset SMD (definition/coding-shift
                            check), share of total match distance, and —
                            when the variable check ran — the
                            leave-one-variable-out columns: how MNN
                            confirmation and High-confidence rates change
                            without the variable, plus a verdict
                            (consider_excluding / load_bearing / neutral).
    warnings.txt            Dataset-level warnings raised for this run
                            (scale mismatch, definition shift, header
                            near-misses), one per line.

  inputs/
    original_target.csv         Unmodified bytes of the uploaded target.
    original_supplemental.csv   Unmodified bytes of the uploaded supplemental.

  agreements/
    agreement.txt           Data-use acknowledgments confirmed at upload.
    contact.txt             Contact information for the tool maintainers.
`;
