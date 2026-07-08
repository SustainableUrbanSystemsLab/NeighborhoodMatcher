// HIPAA NOTE: The matcher runs inside Web Workers in the same tab.
// Dataset contents travel via structured-clone postMessage and never leave
// the browser. Only the Pyodide runtime (WASM + stdlib) and numpy wheel are
// fetched from a public CDN — no user data is transmitted.
//
// Parallelism: WASM is single-threaded, so one Pyodide can use one core.
// For larger target files we run a POOL of workers, each matching a slice
// of target rows (matcher.web_api.match_shard), then merge on one worker
// (assemble_results). The Python side guarantees sharded output is
// identical to the single-worker path (tests/test_web_api_shards.py).

import MatcherWorker from "./matcher.worker.ts?worker";
import type {
  LinkPayload,
  ShardPayload,
  WorkerRequest,
  WorkerResponse,
  StatusPhase,
} from "./matcher.worker";
import type { ColumnLink, MatchOutput, ParsedDataset } from "@/types";
import Papa from "papaparse";

export type PyodideStatus =
  | { phase: "idle" }
  | { phase: "loading-runtime" }
  | { phase: "loading-numpy" }
  | { phase: "loading-matcher" }
  | { phase: "ready" }
  | { phase: "running" }
  | { phase: "error"; message: string };

type StatusCallback = (status: PyodideStatus) => void;
type ProgressCallback = (pct: number) => void;

// Absolute ceiling — even a 32-core machine should not hold 32 Pyodide +
// numpy instances (~150 MB each).
const MAX_POOL_WORKERS = 16;
// The matching work is N_target x M_supplemental pair comparisons. Sizing
// by pairs (not target rows) matters: 2k targets x 73k tracts is 146M
// comparisons and deserves every core, even though 2k rows is "small".
//
// Threshold measured on a 12-core M-series laptop (?workers=N override):
//   44M pairs (2.2k x 20k): 1w 3.1s | 2w 3.0s | 4w 3.4s | 11w 2.8-3.5s — flat;
//     per-worker fixed costs (each worker parses + standardizes both CSVs)
//     dominate, so extra workers neither help nor hurt wall clock.
//   365M pairs (5k x 73k): 1w 33.9s | 11w 12.1s — parallelism pays.
// The wall-clock loss function is flat for anything in ~1M-10M; 5M spins
// up the pool only when matching compute is actually the bottleneck.
const MIN_PAIRS_PER_WORKER = 5_000_000;

const pool: Worker[] = [];

function getWorker(index: number): Worker {
  while (pool.length <= index) {
    pool.push(new MatcherWorker());
  }
  return pool[index]!;
}

// Browsers under-report navigator.hardwareConcurrency as fingerprinting
// protection (Brave randomizes it, Firefox strict mode pins it to 2, Safari
// caps it), so a 12-core machine may look like 2-4 cores. Users can pin the
// real count; the choice persists per device.
const WORKERS_KEY = "nbhdmatch:workers";

export function getSavedWorkerCount(): number | null {
  try {
    const v = Number(localStorage.getItem(WORKERS_KEY));
    return Number.isFinite(v) && v >= 1 ? Math.floor(v) : null;
  } catch {
    return null;
  }
}

export function saveWorkerCount(n: number | null): void {
  try {
    if (n == null) localStorage.removeItem(WORKERS_KEY);
    else localStorage.setItem(WORKERS_KEY, String(Math.floor(n)));
  } catch {
    /* private mode — no persistence */
  }
}

export function reportedCores(): number {
  return navigator.hardwareConcurrency || 4;
}

// Exported so the UI can show the planned pool size while the run is in
// flight (deterministic — same inputs the run itself will use).
export function poolSizeFor(nRows: number, mRows: number): number {
  // Power-user/debug override: ?workers=N pins the pool size (clamped).
  const forced = Number(
    new URLSearchParams(window.location.search).get("workers")
  );
  if (Number.isFinite(forced) && forced >= 1) {
    return Math.min(Math.floor(forced), MAX_POOL_WORKERS, nRows);
  }

  // User-pinned core count (see WORKERS_KEY note above).
  const saved = getSavedWorkerCount();
  if (saved != null) {
    return Math.max(1, Math.min(saved, MAX_POOL_WORKERS, nRows));
  }

  const cores = reportedCores();
  // deviceMemory (GB, Chrome-only, capped at 8) as a low-RAM guard.
  const memGb = (navigator as { deviceMemory?: number }).deviceMemory;
  const byCpu = Math.max(1, Math.min(MAX_POOL_WORKERS, cores - 1));
  const byMemory = memGb ? Math.max(2, Math.round(memGb * 2)) : MAX_POOL_WORKERS;
  const byWork = Math.max(1, Math.floor((nRows * mRows) / MIN_PAIRS_PER_WORKER));
  return Math.max(1, Math.min(byCpu, byMemory, byWork, nRows));
}

export function prefetchPyodide(onStatus?: StatusCallback): void {
  const w = getWorker(0);
  const handler = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    if (msg.type === "status") onStatus?.(statusFromPhase(msg.phase));
    else if (msg.type === "error")
      onStatus?.({ phase: "error", message: msg.message });
  };
  w.addEventListener("message", handler);
  w.postMessage({ type: "init" } satisfies WorkerRequest);
}

function statusFromPhase(phase: StatusPhase): PyodideStatus {
  return { phase } as PyodideStatus;
}

function datasetToCsv(dataset: ParsedDataset): string {
  return Papa.unparse({ fields: dataset.headers, data: dataset.rows });
}

interface RunPayloads {
  targetCsv: string;
  supplementalCsv: string;
  links: LinkPayload[];
  threshold: number;
}

function buildPayloads(
  target: ParsedDataset,
  supplemental: ParsedDataset,
  links: ColumnLink[],
  threshold: number
): RunPayloads {
  const activeLinks = links.filter((l) => !l.excluded);
  if (activeLinks.length === 0) {
    throw new Error("No active column links to match on.");
  }
  return {
    targetCsv: datasetToCsv(target),
    supplementalCsv: datasetToCsv(supplemental),
    links: activeLinks.map((l) => ({
      headerName: l.headerName,
      header1Index: l.targetIndex,
      header2Index: l.supplementalIndex,
    })),
    threshold,
  };
}

function runSingle(
  payloads: RunPayloads,
  onStatus?: StatusCallback,
  onProgress?: ProgressCallback
): Promise<MatchOutput> {
  const w = getWorker(0);
  return new Promise<MatchOutput>((resolve, reject) => {
    const handler = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === "status") {
        onStatus?.(statusFromPhase(msg.phase));
      } else if (msg.type === "progress") {
        onProgress?.(msg.pct);
      } else if (msg.type === "result") {
        w.removeEventListener("message", handler);
        resolve(msg.payload);
      } else if (msg.type === "error") {
        w.removeEventListener("message", handler);
        onStatus?.({ phase: "error", message: msg.message });
        reject(new Error(msg.message));
      }
    };
    w.addEventListener("message", handler);
    w.postMessage({ type: "match", ...payloads } satisfies WorkerRequest);
  });
}

function runShardOn(
  w: Worker,
  payloads: RunPayloads,
  rowLo: number,
  rowHi: number,
  onShardProgress: (pct: number) => void,
  onStatus?: StatusCallback
): Promise<ShardPayload> {
  return new Promise<ShardPayload>((resolve, reject) => {
    const handler = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === "status") {
        onStatus?.(statusFromPhase(msg.phase));
      } else if (msg.type === "progress") {
        onShardProgress(msg.pct);
      } else if (msg.type === "shard_result") {
        w.removeEventListener("message", handler);
        onShardProgress(1);
        resolve(msg.payload);
      } else if (msg.type === "error") {
        w.removeEventListener("message", handler);
        reject(new Error(msg.message));
      }
    };
    w.addEventListener("message", handler);
    w.postMessage({
      type: "match_shard",
      ...payloads,
      rowLo,
      rowHi,
    } satisfies WorkerRequest);
  });
}

function runAssembleOn(
  w: Worker,
  payloads: RunPayloads,
  shards: ShardPayload[]
): Promise<MatchOutput> {
  return new Promise<MatchOutput>((resolve, reject) => {
    const handler = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === "result") {
        w.removeEventListener("message", handler);
        resolve(msg.payload);
      } else if (msg.type === "error") {
        w.removeEventListener("message", handler);
        reject(new Error(msg.message));
      }
    };
    w.addEventListener("message", handler);
    w.postMessage({ type: "assemble", ...payloads, shards } satisfies WorkerRequest);
  });
}

export interface RunResult {
  output: MatchOutput;
  /** Pyodide workers (≈ CPU cores) the matching ran on */
  workersUsed: number;
}

export async function runMatching(
  target: ParsedDataset,
  supplemental: ParsedDataset,
  links: ColumnLink[],
  threshold: number,
  onStatus?: StatusCallback,
  onProgress?: ProgressCallback
): Promise<RunResult> {
  const payloads = buildPayloads(target, supplemental, links, threshold);
  const nRows = target.rows.length;
  const nWorkers = poolSizeFor(nRows, supplemental.rows.length);

  if (nWorkers <= 1) {
    const output = await runSingle(payloads, onStatus, onProgress);
    return { output, workersUsed: 1 };
  }

  // Even, contiguous shards; weights drive the aggregate progress bar.
  const bounds: number[] = [];
  for (let i = 0; i <= nWorkers; i++) {
    bounds.push(Math.round((nRows * i) / nWorkers));
  }
  const shardProgress = new Array<number>(nWorkers).fill(0);
  const reportProgress = () => {
    if (!onProgress) return;
    let total = 0;
    for (let i = 0; i < nWorkers; i++) {
      const weight = (bounds[i + 1]! - bounds[i]!) / nRows;
      total += shardProgress[i]! * weight;
    }
    onProgress(0.95 * total); // reserve the tail for assembly
  };

  onStatus?.({ phase: "running" });
  try {
    const shards = await Promise.all(
      Array.from({ length: nWorkers }, (_, i) =>
        runShardOn(
          getWorker(i),
          payloads,
          bounds[i]!,
          bounds[i + 1]!,
          (pct) => {
            shardProgress[i] = pct;
            reportProgress();
          },
          // Only worker 0 drives the status line (they all report the same
          // phases; N interleaved updates would just flicker).
          i === 0 ? onStatus : undefined
        )
      )
    );

    shards.sort((a, b) => a.row_lo - b.row_lo);
    const result = await runAssembleOn(getWorker(0), payloads, shards);
    onProgress?.(1);
    return { output: result, workersUsed: nWorkers };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onStatus?.({ phase: "error", message });
    throw err;
  }
}
