// A local record of previous runs — METADATA ONLY.
//
// What is stored: when the run happened, which files and settings produced
// it, the run-level quality numbers, and the per-variable diagnostics
// (missingness, offset SMD, distance share, ablation verdict).
//
// What is NEVER stored: any cell of either dataset — no linked rows, no
// per-target rows, no matched values. Results of this tool can constitute
// PHI (see the data-use agreement), and browser storage is unencrypted and
// survives the tab, so participant-level data has no business here. The
// numbers below describe the run, not the people in it.
//
// File NAMES are kept, because they are what makes a run recognizable in a
// list; they are also already written into the results package's
// run_info.csv. A researcher who considers a filename sensitive can clear
// the history from the same panel that shows it.

import type { AblationReport, MatchOutput, ParsedDataset } from "@/types";
import { BUILD } from "@/lib/about";

export const RUNS_KEY = "nbhdmatch:runs";
/** Keep the list useful, not archival — oldest fall off the end. */
export const MAX_RUNS = 20;

export interface RunVariableRecord {
  feature: string;
  targetMissingPct: number;
  suppMissingPct: number;
  offsetSmd: number | null;
  distanceShare: number;
  notes: string;
  /** filled in when the leave-one-variable-out check finishes */
  verdict?: string;
  deltaMnnPct?: number;
}

export interface RunRecord {
  id: string;
  finishedAt: string; // ISO
  toolVersion: string;
  webappBuild: string;
  targetFile: string;
  supplementalFile: string;
  targetRows: number;
  supplementalRows: number;
  features: string[];
  settings: {
    threshold: number;
    maxDistance: number | null;
    minConfidence: "Medium" | "High" | null;
  };
  summary: {
    total: number;
    flagged: number;
    mnnConfirmed: number;
    noMatch: number;
    withheld: number;
    high: number;
    meanNndr: number;
  };
  variables: RunVariableRecord[];
  durationMs: number | null;
}

function read(): RunRecord[] {
  try {
    const raw = localStorage.getItem(RUNS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // Tolerate anything that is not the shape we expect (hand-edited storage,
    // an older schema): a broken history must never break the page.
    return Array.isArray(parsed)
      ? (parsed.filter(
          (r) => r && typeof r === "object" && typeof (r as RunRecord).id === "string"
        ) as RunRecord[])
      : [];
  } catch {
    return [];
  }
}

function write(runs: RunRecord[]): void {
  try {
    localStorage.setItem(RUNS_KEY, JSON.stringify(runs.slice(0, MAX_RUNS)));
  } catch {
    /* private mode or quota — the run still completed, it just isn't listed */
  }
}

/** Newest first. */
export function loadRuns(): RunRecord[] {
  return read();
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export function recordRun(args: {
  output: MatchOutput;
  target: ParsedDataset;
  supplemental: ParsedDataset;
  finishedAt: Date;
  durationMs: number | null;
}): RunRecord {
  const { output, target, supplemental, finishedAt, durationMs } = args;
  const s = output.summary;
  const record: RunRecord = {
    id: newId(),
    finishedAt: finishedAt.toISOString(),
    toolVersion: output.provenance?.version ?? "unknown",
    webappBuild: BUILD.commit,
    targetFile: target.fileName,
    supplementalFile: supplemental.fileName,
    targetRows: target.rows.length,
    supplementalRows: supplemental.rows.length,
    features: [...output.feature_names],
    settings: {
      threshold: s.threshold,
      maxDistance: s.max_distance ?? null,
      minConfidence: s.min_confidence ?? null,
    },
    summary: {
      total: s.total,
      flagged: s.flagged,
      mnnConfirmed: s.mnn_confirmed,
      noMatch: s.no_match,
      withheld: s.withheld ?? 0,
      high: s.tiers?.High ?? 0,
      meanNndr: s.mean_nndr,
    },
    variables: (output.variables ?? []).map((v) => ({
      feature: v.feature,
      targetMissingPct: v.target_missing_pct,
      suppMissingPct: v.supp_missing_pct,
      offsetSmd: v.offset_smd,
      distanceShare: v.distance_share,
      notes: v.notes,
    })),
    durationMs,
  };
  write([record, ...read()]);
  return record;
}

/** Folds the leave-one-variable-out verdicts into an already-recorded run. */
export function recordAblation(id: string, ablation: AblationReport): void {
  const runs = read();
  const run = runs.find((r) => r.id === id);
  if (!run) return; // history cleared mid-run, or evicted — nothing to update
  const byFeature = new Map(ablation.variables.map((v) => [v.feature, v]));
  run.variables = run.variables.map((v) => {
    const abl = byFeature.get(v.feature);
    return abl
      ? { ...v, verdict: abl.verdict, deltaMnnPct: abl.delta_mnn_pct }
      : v;
  });
  write(runs);
}

export function deleteRun(id: string): RunRecord[] {
  const remaining = read().filter((r) => r.id !== id);
  write(remaining);
  return remaining;
}

export function clearRuns(): void {
  try {
    localStorage.removeItem(RUNS_KEY);
  } catch {
    /* nothing to do */
  }
}
