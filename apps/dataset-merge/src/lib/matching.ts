// HIPAA NOTE: No dataset contents should be logged or persisted.
// All computation runs client-side — data never leaves the browser.

import type {
  ColumnLink,
  MatchFlag,
  MatchOutput,
  MatchResult,
  ParsedDataset,
  ProgressCallback,
} from "@/types";

// Flag thresholds on match_quality (0-1, higher = better)
// Warning:        quality < 0.20  (80%+ of random pairings would be worse)
// Extreme Warning: quality < 0.05 (95%+ of random pairings would be worse)
const WARN_QUALITY = 0.20;
const EXTREME_QUALITY = 0.05;

// Near-repeat absolute count thresholds
const WARN_NEAR_COUNT = 10;    // 10+ rows within absolute tolerance
const EXTREME_NEAR_COUNT = 50; // 50+ rows within absolute tolerance

// A row is a "near repeat" if its distance is within this absolute delta of the best
const NEAR_REPEAT_TOLERANCE = 0.5;

// ─── Chi-squared survival function ───────────────────────────────────────────
// match_quality = P(χ²(k) > D²/2)
// Computed via Wilson-Hilferty normal approximation + Abramowitz & Stegun erf.
// Interpretation: probability a random pairing has higher distance than this match.
//   1.0 = perfect match, ~0.5 = no better than random, ~0.0 = worse than random.

function erf(x: number): number {
  // Abramowitz & Stegun, max error 1.5e-7
  const sign = x >= 0 ? 1 : -1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-a * a);
  return sign * y;
}

function normalCDF(z: number): number {
  return (1 + erf(z / Math.SQRT2)) / 2;
}

function chi2SurvivalFn(x: number, k: number): number {
  if (x <= 0) return 1;
  if (k <= 0) return 0;
  // Wilson-Hilferty approximation: χ²(k) ≈ k*(1 - 2/(9k) + Z*sqrt(2/(9k)))³
  const h = (x / k) ** (1 / 3);
  const mu = 1 - 2 / (9 * k);
  const sigma = Math.sqrt(2 / (9 * k));
  const z = (h - mu) / sigma;
  return 1 - normalCDF(z); // upper tail = survival function
}

export function computeMatchQuality(
  distance: number,
  numActiveColumns: number
): number {
  const chiStat = (distance * distance) / 2;
  return chi2SurvivalFn(chiStat, numActiveColumns);
}

// ─── Core matching helpers ────────────────────────────────────────────────────

export function cleanCell(value: string): number {
  const cleaned = value.replace(/,/g, "").trim();
  if (cleaned === "") return 0;
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

export function findCommonHeaders(
  headers1: string[],
  headers2: string[]
): ColumnLink[] {
  const h2Lookup = new Map<string, number>();
  headers2.forEach((name, idx) => h2Lookup.set(name, idx));

  const links: ColumnLink[] = [];
  headers1.forEach((name, idx) => {
    const h2Idx = h2Lookup.get(name);
    if (h2Idx !== undefined) {
      links.push({
        headerName: name,
        targetIndex: idx,
        supplementalIndex: h2Idx,
        excluded: false,
      });
    }
  });
  return links;
}

export function extractNumericColumns(
  rows: string[][],
  links: ColumnLink[],
  indexKey: "targetIndex" | "supplementalIndex"
): number[][] {
  return rows.map((row) =>
    links.map((link) => cleanCell(row[link[indexKey]] ?? ""))
  );
}

export function dualStandardize(
  rows1: number[][],
  rows2: number[][]
): { std1: number[][]; std2: number[][] } {
  const combined = [...rows1, ...rows2];
  const numCols = combined[0]?.length ?? 0;
  const numRows = combined.length;

  const means: number[] = [];
  const stds: number[] = [];

  for (let c = 0; c < numCols; c++) {
    let sum = 0;
    for (const row of combined) sum += row[c] ?? 0;
    const mean = sum / numRows;
    means.push(mean);

    let sqSum = 0;
    for (const row of combined) sqSum += ((row[c] ?? 0) - mean) ** 2;
    let std = Math.sqrt(sqSum / numRows);
    if (std === 0) std = 1; // Prevent division by zero
    stds.push(std);
  }

  const normalize = (rows: number[][]): number[][] =>
    rows.map((row) =>
      row.map((val, c) => (val - (means[c] ?? 0)) / (stds[c] ?? 1))
    );

  return { std1: normalize(rows1), std2: normalize(rows2) };
}

export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i]! - b[i]!) ** 2;
  return Math.sqrt(sum);
}

export function bruteFindBestMatch(
  targetRow: number[],
  referenceRows: number[][]
): {
  matchIndex: number;
  distance: number;
  repeatCount: number;
  nearRepeatCount: number;
  near1PctCount: number;
  near5PctCount: number;
} {
  let bestDistance = Infinity;
  let bestIndex = 0;
  let repeatCount = 0;

  for (let i = 0; i < referenceRows.length; i++) {
    const dist = euclideanDistance(targetRow, referenceRows[i]!);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestIndex = i;
      repeatCount = 1;
    } else if (dist === bestDistance) {
      repeatCount++;
    }
  }

  // near_repeats: rows within absolute tolerance of the best distance
  let nearRepeatCount = 0;
  const nearThreshold = bestDistance + NEAR_REPEAT_TOLERANCE;

  // near_1pct / near_5pct: rows within 1% / 5% of the best match distance (relative)
  let near1PctCount = 0;
  let near5PctCount = 0;
  const near1PctThreshold = bestDistance * 1.01;
  const near5PctThreshold = bestDistance * 1.05;

  for (let i = 0; i < referenceRows.length; i++) {
    const dist = euclideanDistance(targetRow, referenceRows[i]!);
    if (dist <= nearThreshold) nearRepeatCount++;
    if (dist <= near1PctThreshold) near1PctCount++;
    if (dist <= near5PctThreshold) near5PctCount++;
  }

  return { matchIndex: bestIndex, distance: bestDistance, repeatCount, nearRepeatCount, near1PctCount, near5PctCount };
}

export function computeMatchFlag(
  matchQuality: number,
  repeatCount: number,
  nearRepeatCount: number,
): { flag: MatchFlag; reasons: string[] } {
  const reasons: string[] = [];
  let flag: MatchFlag = "OK";

  if (matchQuality < EXTREME_QUALITY) {
    reasons.push(
      `Very poor match quality (score ${matchQuality.toFixed(3)} < ${EXTREME_QUALITY} — match not better than ~${Math.round((1 - matchQuality) * 100)}% of random pairings)`
    );
    flag = "Extreme Warning";
  } else if (matchQuality < WARN_QUALITY) {
    reasons.push(
      `Low match quality (score ${matchQuality.toFixed(3)} < ${WARN_QUALITY} — match not better than ~${Math.round((1 - matchQuality) * 100)}% of random pairings)`
    );
    flag = "Warning";
  }

  if (nearRepeatCount > EXTREME_NEAR_COUNT) {
    reasons.push(`Very ambiguous match — ${nearRepeatCount} rows within near-match tolerance`);
    flag = "Extreme Warning";
  } else if (nearRepeatCount > WARN_NEAR_COUNT) {
    reasons.push(`Ambiguous match — ${nearRepeatCount} rows within near-match tolerance`);
    if (flag === "OK") flag = "Warning";
  }

  if (repeatCount > 1) {
    reasons.push(`${repeatCount} supplemental rows are tied at the same distance — match is not uniquely determined`);
    flag = "Extreme Warning";
  }

  return { flag, reasons };
}

export function mergeRow(
  targetRow: string[],
  supplementalRow: string[],
  links: ColumnLink[]
): string[] {
  const sharedSupIndices = new Set(links.map((l) => l.supplementalIndex));
  const extras = supplementalRow.filter((_, i) => !sharedSupIndices.has(i));
  return [...targetRow, ...extras];
}

function fileStem(fileName: string): string {
  return fileName
    .replace(/\.csv$/i, "")
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase();
}

export function buildMergedHeaders(
  targetHeaders: string[],
  supplementalHeaders: string[],
  supplementalFileName: string,
  links: ColumnLink[]
): string[] {
  const sharedSupIndices = new Set(links.map((l) => l.supplementalIndex));
  const extraHeaders = supplementalHeaders.filter(
    (_, i) => !sharedSupIndices.has(i)
  );

  const stem = fileStem(supplementalFileName);
  const targetSet = new Set(targetHeaders);

  // Suffix with filename stem if column already exists (chained runs)
  const col = (name: string) =>
    targetSet.has(name) ? `${name}_${stem}` : name;

  return [
    ...targetHeaders,
    ...extraHeaders,
    col("euc_distance"),
    col("repeats"),
    col("near_repeats"),
    col("near_1pct"),
    col("near_5pct"),
    col("match_quality"),
    col("match_flag"),
    col("flag_reasons"),
  ];
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function runMatching(
  target: ParsedDataset,
  supplemental: ParsedDataset,
  links: ColumnLink[],
  onProgress?: ProgressCallback
): Promise<MatchOutput> {
  const activeLinks = links.filter((l) => !l.excluded);
  const k = activeLinks.length;

  const numTarget = extractNumericColumns(target.rows, activeLinks, "targetIndex");
  const numSupplemental = extractNumericColumns(supplemental.rows, activeLinks, "supplementalIndex");
  const { std1, std2 } = dualStandardize(numTarget, numSupplemental);

  const results: MatchResult[] = [];
  const mergedRows: string[][] = [];

  for (let i = 0; i < std1.length; i++) {
    const { matchIndex, distance, repeatCount, nearRepeatCount, near1PctCount, near5PctCount } =
      bruteFindBestMatch(std1[i]!, std2);

    const matchQuality = computeMatchQuality(distance, k);
    const { flag, reasons } = computeMatchFlag(
      matchQuality,
      repeatCount,
      nearRepeatCount,
    );

    const merged = mergeRow(
      target.rows[i]!,
      supplemental.rows[matchIndex]!,
      activeLinks
    );
    merged.push(
      distance.toString(),
      repeatCount.toString(),
      nearRepeatCount.toString(),
      near1PctCount.toString(),
      near5PctCount.toString(),
      matchQuality.toFixed(4),
      flag,
      reasons.join("; ")
    );

    results.push({
      targetRowIndex: i,
      matchedSupplementalIndex: matchIndex,
      euclideanDistance: distance,
      repeatCount,
      nearRepeatCount,
      near1PctCount,
      near5PctCount,
      matchQuality,
      matchFlag: flag,
      flagReasons: reasons,
      mergedRow: merged,
    });
    mergedRows.push(merged);

    if (i % 50 === 0) {
      onProgress?.(i + 1, std1.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  onProgress?.(std1.length, std1.length);

  const headers = buildMergedHeaders(
    target.headers,
    supplemental.headers,
    supplemental.fileName,
    activeLinks
  );

  return { headers, results, mergedRows };
}