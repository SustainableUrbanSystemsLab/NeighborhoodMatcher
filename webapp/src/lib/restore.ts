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
import type { ParsedDataset } from "@/types";

export interface RestoredRun {
  target: ParsedDataset;
  supplemental: ParsedDataset;
  /** shared columns this run actually matched on */
  features: string[];
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
        `tool produced (matcher_results.zip).`
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

  return {
    target,
    supplemental,
    features: (info.get("matching_variables") || "")
      .split(";")
      .map((name: string) => name.trim())
      .filter(Boolean),
    threshold: num(info.get("nndr_threshold")) ?? 0.8,
    maxDistance: rawCutoff.toLowerCase() === "off" ? null : num(rawCutoff),
    minConfidence:
      rawMin === "medium" || rawMin === "high" ? (rawMin as "medium" | "high") : null,
    toolVersion: info.get("tool_version") ?? null,
    generatedAt: info.get("generated_at_local") ?? info.get("generated_at_utc") ?? null,
    zipName: file.name,
  };
}
