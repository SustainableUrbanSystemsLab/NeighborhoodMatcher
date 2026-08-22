// HIPAA NOTE: This worker runs Pyodide + the matcher off the main thread.
// Dataset contents are passed in over postMessage (structured-cloned within
// the tab) and never leave the browser.

/// <reference lib="webworker" />

import { loadPyodide, type PyodideInterface } from "pyodide";
import type { AblationReport, MatchOutput } from "@/types";

const PYODIDE_VERSION = "0.29.3";
const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

const MATCHER_MODULES = [
  "__init__",
  "io",
  "align",
  "standardize",
  "distance",
  "merge",
  "signals",
  "ablation",
  "pipeline",
  "web_api",
];

export interface LinkPayload {
  headerName: string;
  header1Index: number;
  header2Index: number;
}

export interface MatchRequest {
  type: "match";
  targetCsv: string;
  supplementalCsv: string;
  links: LinkPayload[];
  threshold: number;
  /** optional match-rejection cutoff in per-feature z-units; null = off */
  maxDistance: number | null;
  /** optional minimum-confidence reporting filter; null = off */
  minConfidence: "medium" | "high" | null;
}

// One slice of target rows, matched against the full supplemental set.
// Several workers each run one of these concurrently — a single WASM
// interpreter is single-threaded, so parallelism = one Pyodide per worker.
export interface MatchShardRequest {
  type: "match_shard";
  targetCsv: string;
  supplementalCsv: string;
  links: LinkPayload[];
  threshold: number;
  /** carried by the shared payload spread but ignored here — the cutoff and
   *  the confidence filter are applied at assembly, so shards stay agnostic */
  maxDistance?: number | null;
  minConfidence?: "medium" | "high" | null;
  rowLo: number;
  rowHi: number;
}

// Merge shard payloads (from match_shard, any worker) into the final
// MatchOutput. Runs on one worker after all shards complete.
export interface AssembleRequest {
  type: "assemble";
  targetCsv: string;
  supplementalCsv: string;
  links: LinkPayload[];
  threshold: number;
  /** optional match-rejection cutoff in per-feature z-units; null = off */
  maxDistance: number | null;
  /** optional minimum-confidence reporting filter; null = off */
  minConfidence: "medium" | "high" | null;
  shards: ShardPayload[];
}

// One leave-one-variable-out matching variant (matcher.web_api.
// ablation_variant). The pool runs d+1 of these across its workers; every
// worker derives the same deterministic target sample from the data shape.
export interface AblationVariantRequest {
  type: "ablation_variant";
  targetCsv: string;
  supplementalCsv: string;
  links: LinkPayload[];
  threshold: number;
  /** feature index to leave out; null = baseline (all features) */
  dropIndex: number | null;
}

// Merge ablation_variant payloads into the AblationReport. Pure Python
// function — no CSVs, no matching; runs on any ready worker.
export interface AssembleAblationRequest {
  type: "assemble_ablation";
  variants: AblationVariantPayload[];
  featureNames: string[];
  threshold: number;
}

// Opaque to TS beyond ordering needs; produced by web_api.ablation_variant
// (plain JSON — safe to structured-clone between workers).
export interface AblationVariantPayload {
  drop_index: number | null;
  [key: string]: unknown;
}

// Opaque to TS beyond what the pool needs for ordering; produced by
// matcher.web_api.match_shard (plain JSON — safe to structured-clone).
export interface ShardPayload {
  row_lo: number;
  row_hi: number;
  [key: string]: unknown;
}

export interface InitRequest {
  type: "init";
}

export type WorkerRequest =
  | InitRequest
  | MatchRequest
  | MatchShardRequest
  | AssembleRequest
  | AblationVariantRequest
  | AssembleAblationRequest;

export type StatusPhase =
  | "loading-runtime"
  | "loading-numpy"
  | "loading-matcher"
  | "ready"
  | "running";

export interface StatusMessage {
  type: "status";
  phase: StatusPhase;
}

export interface ProgressMessage {
  type: "progress";
  pct: number; // 0..1
}

export interface ResultMessage {
  type: "result";
  payload: MatchOutput;
}

export interface ShardResultMessage {
  type: "shard_result";
  payload: ShardPayload;
}

export interface AblationVariantResultMessage {
  type: "ablation_variant_result";
  payload: AblationVariantPayload;
}

export interface AblationResultMessage {
  type: "ablation_result";
  payload: AblationReport;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export type WorkerResponse =
  | StatusMessage
  | ProgressMessage
  | ResultMessage
  | ShardResultMessage
  | AblationVariantResultMessage
  | AblationResultMessage
  | ErrorMessage;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let pyodide: PyodideInterface | null = null;
let initPromise: Promise<void> | null = null;

function send(msg: WorkerResponse) {
  ctx.postMessage(msg);
}

async function init(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      await initInner();
    } catch (err) {
      // Do not cache a failed init: a transient CDN/network failure would
      // otherwise make every later run fail instantly until page reload.
      initPromise = null;
      pyodide = null;
      throw err;
    }
  })();
  return initPromise;
}

async function initInner(): Promise<void> {
  {
    send({ type: "status", phase: "loading-runtime" });
    pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX_URL });

    send({ type: "status", phase: "loading-numpy" });
    await pyodide.loadPackage("numpy");

    send({ type: "status", phase: "loading-matcher" });
    pyodide.FS.mkdirTree("/matcher");
    await Promise.all(
      MATCHER_MODULES.map(async (name) => {
        const res = await fetch(`/matcher/${name}.py`);
        if (!res.ok) throw new Error(`Failed to fetch matcher/${name}.py`);
        const src = await res.text();
        pyodide!.FS.writeFile(`/matcher/${name}.py`, src);
      })
    );

    pyodide.runPython(`
import sys
if '/' not in sys.path:
    sys.path.insert(0, '/')
from matcher.web_api import (
    coordinate_in_memory, match_shard, assemble_results,
    ablation_variant, assemble_ablation,
)
`);

    send({ type: "status", phase: "ready" });
  }
}

async function runMatch(req: MatchRequest): Promise<void> {
  await init();
  if (!pyodide) throw new Error("Pyodide not initialized.");

  send({ type: "status", phase: "running" });

  pyodide.globals.set("target_csv", req.targetCsv);
  pyodide.globals.set("supp_csv", req.supplementalCsv);
  pyodide.globals.set("links_json", JSON.stringify(req.links));
  pyodide.globals.set("threshold", req.threshold);
  // Numeric sentinel: -1 = disabled. Avoids JS null → Python conversion
  // ambiguity across Pyodide versions. String sentinel "" for the
  // confidence filter, same reasoning.
  pyodide.globals.set("max_distance", req.maxDistance ?? -1);
  pyodide.globals.set("min_confidence", req.minConfidence ?? "");
  pyodide.globals.set("progress_cb", (pct: number) => {
    send({ type: "progress", pct });
  });

  try {
    const pyResult = pyodide.runPython(`
import json
_links = json.loads(links_json)
_result = coordinate_in_memory(
    target_csv, supp_csv,
    links=_links, threshold=threshold,
    progress_cb=progress_cb,
    max_distance=(max_distance if max_distance > 0 else None),
    min_confidence=(min_confidence or None),
)
_result
`);

    const jsResult = pyResult.toJs({
      dict_converter: Object.fromEntries,
      create_pyproxies: false,
    }) as MatchOutput;

    if (pyResult && typeof pyResult.destroy === "function") pyResult.destroy();

    send({ type: "result", payload: jsResult });
  } finally {
    pyodide.globals.set("target_csv", "");
    pyodide.globals.set("supp_csv", "");
    pyodide.globals.set("links_json", "");
    // Drop the module-level result so dataset contents don't stay pinned
    // in this worker's Python heap between runs.
    pyodide.runPython("_result = None");
  }
}

async function runShard(req: MatchShardRequest): Promise<void> {
  await init();
  if (!pyodide) throw new Error("Pyodide not initialized.");

  send({ type: "status", phase: "running" });

  pyodide.globals.set("target_csv", req.targetCsv);
  pyodide.globals.set("supp_csv", req.supplementalCsv);
  pyodide.globals.set("links_json", JSON.stringify(req.links));
  pyodide.globals.set("threshold", req.threshold);
  pyodide.globals.set("row_lo", req.rowLo);
  pyodide.globals.set("row_hi", req.rowHi);
  pyodide.globals.set("progress_cb", (pct: number) => {
    send({ type: "progress", pct });
  });

  try {
    const pyResult = pyodide.runPython(`
import json
_links = json.loads(links_json)
_shard = match_shard(
    target_csv, supp_csv,
    links=_links, threshold=threshold,
    row_lo=row_lo, row_hi=row_hi,
    progress_cb=progress_cb,
)
_shard
`);
    const jsShard = pyResult.toJs({
      dict_converter: Object.fromEntries,
      create_pyproxies: false,
    }) as ShardPayload;
    if (pyResult && typeof pyResult.destroy === "function") pyResult.destroy();

    send({ type: "shard_result", payload: jsShard });
  } finally {
    pyodide.globals.set("target_csv", "");
    pyodide.globals.set("supp_csv", "");
    pyodide.globals.set("links_json", "");
    pyodide.runPython("_shard = None");
  }
}

async function runAssemble(req: AssembleRequest): Promise<void> {
  await init();
  if (!pyodide) throw new Error("Pyodide not initialized.");

  pyodide.globals.set("target_csv", req.targetCsv);
  pyodide.globals.set("supp_csv", req.supplementalCsv);
  pyodide.globals.set("links_json", JSON.stringify(req.links));
  pyodide.globals.set("threshold", req.threshold);
  pyodide.globals.set("max_distance", req.maxDistance ?? -1);
  pyodide.globals.set("min_confidence", req.minConfidence ?? "");
  pyodide.globals.set("shards_js", req.shards);

  try {
    const pyResult = pyodide.runPython(`
import json
_links = json.loads(links_json)
_shards = shards_js.to_py()
_result = assemble_results(
    target_csv, supp_csv, _shards,
    links=_links, threshold=threshold,
    max_distance=(max_distance if max_distance > 0 else None),
    min_confidence=(min_confidence or None),
)
_result
`);
    const jsResult = pyResult.toJs({
      dict_converter: Object.fromEntries,
      create_pyproxies: false,
    }) as MatchOutput;
    if (pyResult && typeof pyResult.destroy === "function") pyResult.destroy();

    send({ type: "result", payload: jsResult });
  } finally {
    pyodide.globals.set("target_csv", "");
    pyodide.globals.set("supp_csv", "");
    pyodide.globals.set("links_json", "");
    pyodide.globals.set("shards_js", null);
    pyodide.runPython("_result = None; _shards = None");
  }
}

async function runAblationVariant(req: AblationVariantRequest): Promise<void> {
  await init();
  if (!pyodide) throw new Error("Pyodide not initialized.");

  send({ type: "status", phase: "running" });

  pyodide.globals.set("target_csv", req.targetCsv);
  pyodide.globals.set("supp_csv", req.supplementalCsv);
  pyodide.globals.set("links_json", JSON.stringify(req.links));
  pyodide.globals.set("threshold", req.threshold);
  // Numeric sentinel: -1 = baseline (no column dropped), mirroring the
  // max_distance convention.
  pyodide.globals.set("drop_index", req.dropIndex ?? -1);

  try {
    const pyResult = pyodide.runPython(`
import json
_links = json.loads(links_json)
_variant = ablation_variant(
    target_csv, supp_csv,
    links=_links, threshold=threshold,
    drop_index=(drop_index if drop_index >= 0 else None),
)
_variant
`);
    const jsVariant = pyResult.toJs({
      dict_converter: Object.fromEntries,
      create_pyproxies: false,
    }) as AblationVariantPayload;
    if (pyResult && typeof pyResult.destroy === "function") pyResult.destroy();

    send({ type: "ablation_variant_result", payload: jsVariant });
  } finally {
    pyodide.globals.set("target_csv", "");
    pyodide.globals.set("supp_csv", "");
    pyodide.globals.set("links_json", "");
    pyodide.runPython("_variant = None");
  }
}

async function runAssembleAblation(req: AssembleAblationRequest): Promise<void> {
  await init();
  if (!pyodide) throw new Error("Pyodide not initialized.");

  pyodide.globals.set("variants_js", req.variants);
  pyodide.globals.set("feature_names_json", JSON.stringify(req.featureNames));
  pyodide.globals.set("threshold", req.threshold);

  try {
    const pyResult = pyodide.runPython(`
import json
_variants = variants_js.to_py()
_report = assemble_ablation(
    _variants, json.loads(feature_names_json), threshold=threshold,
)
_report
`);
    const jsReport = pyResult.toJs({
      dict_converter: Object.fromEntries,
      create_pyproxies: false,
    }) as AblationReport;
    if (pyResult && typeof pyResult.destroy === "function") pyResult.destroy();

    send({ type: "ablation_result", payload: jsReport });
  } finally {
    pyodide.globals.set("variants_js", null);
    pyodide.globals.set("feature_names_json", "");
    pyodide.runPython("_report = None; _variants = None");
  }
}

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === "init") {
      await init();
    } else if (msg.type === "match") {
      await runMatch(msg);
    } else if (msg.type === "match_shard") {
      await runShard(msg);
    } else if (msg.type === "assemble") {
      await runAssemble(msg);
    } else if (msg.type === "ablation_variant") {
      await runAblationVariant(msg);
    } else if (msg.type === "assemble_ablation") {
      await runAssembleAblation(msg);
    }
  } catch (err) {
    send({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
