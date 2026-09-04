// Restore a previous run from its downloaded results zip.
//
// The package already carries everything needed: `inputs/original_*.csv` are
// the byte-exact uploads, and `run_info.csv` records the settings and the
// linked variables. Matching is deterministic, so re-running those inputs
// under those settings reproduces the run exactly — including the per-row
// histograms and rank plots, which the CSVs do not contain.
//
// This is why the app can offer "reopen a previous run" WITHOUT keeping
// participant data in browser storage: the zip lives in the researcher's own
// file system, under their institution's rules, and the browser holds it only
// for as long as the tab is open.

import JSZip from "jszip";
import Papa from "papaparse";
import { parseCSVFile } from "@/lib/csv";
import { findCommonHeaders } from "@/lib/matching";
import type { ColumnLink, ParsedDataset } from "@/types";

export interface RestoredRun {
  target: ParsedDataset;
  supplemental: ParsedDataset;
  /** shared columns this run actually matched on */
  features: string[];
  /**
   * The run's column selection, ready for the Link step: every shared column
   * it did not match on is excluded, and manual links between differently
   * named columns are re-created from `column_links` in run_info.csv.
   */
  links: ColumnLink[];
  /**
   * Matching variables that could NOT be re-linked automatically — the
   * package predates `column_links` and the variable was a manual link, or
   * a column is missing. Non-empty means running will not reproduce the run.
   */
  unlinked: string[];
  threshold: number;
  maxDistance: number | null;
  minConfidence: "medium" | "high" | null;
  /** engine version that produced the package, when recorded */
  toolVersion: string | null;
  generatedAt: string | null;
  zipName: string;
}

function parseRunInfo(text: string): Map<string, string> {
  const rows = Papa.parse<string[]>(text.replace(/^﻿/, "").trim(), {
    skipEmptyLines: true,
  }).data;
  const info = new Map<string, string>();
  for (const row of rows.slice(1)) {
    if (row.length >= 2) info.set(row[0]!.trim(), row.slice(1).join(",").trim());
  }
  return info;
}

function parseColumnLinks(value: string | undefined): [string, string][] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    const pairs: [string, string][] = [];
    for (const item of parsed) {
      if (
        Array.isArray(item) &&
        item.length === 2 &&
        typeof item[0] === "string" &&
        typeof item[1] === "string"
      ) {
        pairs.push([item[0], item[1]]);
      }
    }
    return pairs;
  } catch {
    return null;
  }
}

function indexOfHeader(headers: string[], name: string): number {
  const exact = headers.indexOf(name);
  if (exact >= 0) return exact;
  const wanted = name.trim();
  return headers.findIndex((h) => h.trim() === wanted);
}

/**
 * Rebuilds the Link step's state for a restored run. Every shared column
 * starts EXCLUDED; the recorded (target, supplemental) pairs switch on the
 * ones the run used and add manual links where the names differ. Without
 * `column_links` (older packages) only same-name links can be recovered,
 * and any other matching variable is reported as unlinked.
 */
export function rebuildLinks(
  target: ParsedDataset,
  supplemental: ParsedDataset,
  features: string[],
  pairs: [string, string][] | null
): { links: ColumnLink[]; unlinked: string[] } {
  const common = findCommonHeaders(target.headers, supplemental.headers);

  if (pairs === null) {
    const links = common.map((link) =>
      features.length > 0 && !features.includes(link.headerName)
        ? { ...link, excluded: true }
        : link
    );
    const unlinked = features.filter(
      (f) => !common.some((link) => link.headerName === f)
    );
    return { links, unlinked };
  }

  const links: ColumnLink[] = common.map((link) => ({ ...link, excluded: true }));
  const unlinked: string[] = [];
  for (const [targetName, suppName] of pairs) {
    const targetIndex = indexOfHeader(target.headers, targetName);
    const supplementalIndex = indexOfHeader(supplemental.headers, suppName);
    if (targetIndex < 0 || supplementalIndex < 0) {
      unlinked.push(targetName);
      continue;
    }
    const existing = links.find(
      (l) => l.targetIndex === targetIndex && l.supplementalIndex === supplementalIndex
    );
    if (existing) {
      existing.excluded = false;
    } else {
      links.push({
        headerName: target.headers[targetIndex] ?? targetName,
        targetIndex,
        supplementalIndex,
        excluded: false,
      });
    }
  }
  return { links, unlinked };
}

function num(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function restoreFromZip(file: File): Promise<RestoredRun> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error(
      `${file.name} is not a readable zip. Choose the results package this ` +
        `tool produced (a name like 20260904-1704-matcher_results.zip).`
    );
  }

  const targetEntry = zip.file("inputs/original_target.csv");
  const suppEntry = zip.file("inputs/original_supplemental.csv");
  if (!targetEntry || !suppEntry) {
    throw new Error(
      `${file.name} does not contain inputs/original_target.csv and ` +
        `inputs/original_supplemental.csv, so the run cannot be reproduced. ` +
        `Packages from older versions may predate those files.`
    );
  }

  const infoEntry = zip.file("run_info.csv");
  const info = infoEntry ? parseRunInfo(await infoEntry.async("string")) : new Map();

  // Rebuild File objects so the normal upload path (and its parse errors)
  // applies unchanged.
  const [targetBlob, suppBlob] = await Promise.all([
    targetEntry.async("blob"),
    suppEntry.async("blob"),
  ]);
  const targetName = info.get("target_file") || "original_target.csv";
  const suppName = info.get("supplemental_file") || "original_supplemental.csv";
  const [target, supplemental] = await Promise.all([
    parseCSVFile(new File([targetBlob], targetName, { type: "text/csv" })),
    parseCSVFile(new File([suppBlob], suppName, { type: "text/csv" })),
  ]);

  const rawMin = (info.get("min_confidence_filter") || "off").toLowerCase();
  const rawCutoff = info.get("max_distance_cutoff") || "off";
  const features = (info.get("matching_variables") || "")
    .split(";")
    .map((name: string) => name.trim())
    .filter(Boolean);
  const { links, unlinked } = rebuildLinks(
    target,
    supplemental,
    features,
    parseColumnLinks(info.get("column_links"))
  );

  return {
    target,
    supplemental,
    features,
    links,
    unlinked,
    threshold: num(info.get("nndr_threshold")) ?? 0.8,
    maxDistance: rawCutoff.toLowerCase() === "off" ? null : num(rawCutoff),
    minConfidence:
      rawMin === "medium" || rawMin === "high" ? (rawMin as "medium" | "high") : null,
    toolVersion: info.get("tool_version") ?? null,
    generatedAt: info.get("generated_at_local") ?? info.get("generated_at_utc") ?? null,
    zipName: file.name,
  };
}
