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
  AblationVariantPayload,
  LinkPayload,
  ShardPayload,
  WorkerRequest,
  WorkerResponse,
  StatusPhase,
} from "./matcher.worker";
import type {
  AblationReport,
  ColumnLink,
  MatchOutput,
  ParsedDataset,
} from "@/types";
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

let prefetchStarted = false;

export function prefetchPyodide(onStatus?: StatusCallback): void {
  // Re-entering the link step must not stack another permanent listener on
  // worker 0 — stale closures would resurrect old statuses after resets.
  if (prefetchStarted && pool.length > 0) return;
  prefetchStarted = true;
  const w = getWorker(0);
  const handler = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    if (msg.type === "status") {
      onStatus?.(statusFromPhase(msg.phase));
      if (msg.phase === "ready") w.removeEventListener("message", handler);
    } else if (msg.type === "error") {
      onStatus?.({ phase: "error", message: msg.message });
      w.removeEventListener("message", handler);
    }
  };
  w.addEventListener("message", handler);
  w.postMessage({ type: "init" } satisfies WorkerRequest);
}

/**
 * Kill every pool worker and drop the pool. Called when a run fails or is
 * abandoned (leaving the match page): in-flight Pyodide work cannot be
 * cancelled, and a busy worker would otherwise feed its STALE results to
 * the next run's listeners — silently wrong output. The cost is a cold
 * (re-)init on the next run; correctness wins.
 */
// Bumped on every terminate. Background work (the variable check) captures
// it at start so a failure in an ABANDONED suite can never terminate the
// pool a newer run is using.
let poolGeneration = 0;
// Abandon callbacks for in-flight background work: a terminated worker never
// posts again, so without these the work's promise would hang forever.
const abandonHandlers = new Set<() => void>();

/** Thrown to background work when the pool it was running on was reset. */
export class WorkAbandoned extends Error {
  constructor() {
    super("cancelled: the worker pool was reset");
    this.name = "WorkAbandoned";
  }
}

export function terminatePool(): void {
  for (const w of pool) w.terminate();
  pool.length = 0;
  prefetchStarted = false;
  poolGeneration++;
  for (const abandon of abandonHandlers) abandon();
  abandonHandlers.clear();
}

/**
 * Stops the background variable check, if one is running, by resetting the
 * pool — in-flight Pyodide work cannot be interrupted any other way. A new
 * matching run must not queue behind stale variants on the same workers
 * (its wall time would roughly double), and a stale variant's error would
 * even reject the new run's shard. No-op when nothing is in flight, so the
 * warm pool is kept.
 */
export function cancelBackgroundWork(): void {
  if (abandonHandlers.size > 0) terminatePool();
}

function statusFromPhase(phase: StatusPhase): PyodideStatus {
  return { phase } as PyodideStatus;
}

function datasetToCsv(dataset: ParsedDataset): string {
  const csv = Papa.unparse({ fields: dataset.headers, data: dataset.rows });
  if (!dataset.labelRowSkipped) return csv;
  // The skipped label row becomes an EMPTY line: the engine skips blank
  // lines but keeps original line numbers, so a later parse error still
  // cites the line the user sees in their own file.
  const nl = csv.includes("\r\n") ? "\r\n" : "\n";
  const cut = csv.indexOf(nl);
  if (cut < 0) return csv;
  return csv.slice(0, cut + nl.length) + nl + csv.slice(cut + nl.length);
}

interface RunPayloads {
  targetCsv: string;
  supplementalCsv: string;
  links: LinkPayload[];
  threshold: number;
  /** optional match-rejection cutoff in per-feature z-units; null = off.
   *  Applied at assembly only, so shard requests ignore it. */
  maxDistance: number | null;
  /** optional minimum-confidence reporting filter; null = off.
   *  Also assembly-only. */
  minConfidence: "medium" | "high" | null;
}

function buildPayloads(
  target: ParsedDataset,
  supplemental: ParsedDataset,
  links: ColumnLink[],
  threshold: number,
  maxDistance: number | null,
  minConfidence: "medium" | "high" | null
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
    maxDistance,
    minConfidence,
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
  maxDistance: number | null = null,
  minConfidence: "medium" | "high" | null = null,
  onStatus?: StatusCallback,
  onProgress?: ProgressCallback
): Promise<RunResult> {
  const payloads = buildPayloads(
    target, supplemental, links, threshold, maxDistance, minConfidence
  );
  const nRows = target.rows.length;
  const nWorkers = poolSizeFor(nRows, supplemental.rows.length);

  // "Exclude and adjust" → Run arrives while the previous results' variable
  // check may still be computing. Never share workers with it.
  cancelBackgroundWork();

  if (nWorkers <= 1) {
    try {
      const output = await runSingle(payloads, onStatus, onProgress);
      return { output, workersUsed: 1 };
    } catch (err) {
      // The worker may still be executing the failed run's Python; a busy
      // worker would feed stale results to the next run. Kill and rebuild.
      terminatePool();
      throw err;
    }
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

    // (row_lo, row_hi): row_lo alone is not a total order when the pool is
    // larger than the row count and an empty shard shares its row_lo.
    shards.sort((a, b) => a.row_lo - b.row_lo || a.row_hi - b.row_hi);
    const result = await runAssembleOn(getWorker(0), payloads, shards);
    onProgress?.(1);
    return { output: result, workersUsed: nWorkers };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onStatus?.({ phase: "error", message });
    // One failed shard leaves the others mid-compute with listeners gone;
    // their eventual results would poison the next run. Kill everything.
    terminatePool();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Leave-one-variable-out ablation (variable quality check)
// ---------------------------------------------------------------------------

// Mirrors matcher/ablation.py — ABLATION_BUDGET_OPS and
// ABLATION_SAMPLE_FLOOR. Keep in sync by hand; the gate only decides
// auto-run vs on-demand, Python owns the actual sampling.
const ABLATION_BUDGET_OPS = 6_000_000_000;
const ABLATION_SAMPLE_FLOOR = 200;

/**
 * Whether the variable check should run automatically after results.
 * Auto only when even the minimum target sample fits the compute budget;
 * otherwise the panel offers it as an explicit button.
 */
export function ablationAutoRunAllowed(mRows: number, d: number): boolean {
  return mRows * d * (d + 1) * ABLATION_SAMPLE_FLOOR <= ABLATION_BUDGET_OPS;
}

function runAblationVariantOn(
  w: Worker,
  payloads: RunPayloads,
  dropIndex: number | null
): Promise<AblationVariantPayload> {
  return new Promise<AblationVariantPayload>((resolve, reject) => {
    const handler = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === "ablation_variant_result") {
        w.removeEventListener("message", handler);
        resolve(msg.payload);
      } else if (msg.type === "error") {
        w.removeEventListener("message", handler);
        reject(new Error(msg.message));
      }
      // status/progress messages from the worker are ignored here — the
      // ablation runs in the background after results are already shown.
    };
    w.addEventListener("message", handler);
    w.postMessage({
      type: "ablation_variant",
      targetCsv: payloads.targetCsv,
      supplementalCsv: payloads.supplementalCsv,
      links: payloads.links,
      threshold: payloads.threshold,
      dropIndex,
    } satisfies WorkerRequest);
  });
}

function runAssembleAblationOn(
  w: Worker,
  variants: AblationVariantPayload[],
  featureNames: string[],
  threshold: number
): Promise<AblationReport> {
  return new Promise<AblationReport>((resolve, reject) => {
    const handler = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === "ablation_result") {
        w.removeEventListener("message", handler);
        resolve(msg.payload);
      } else if (msg.type === "error") {
        w.removeEventListener("message", handler);
        reject(new Error(msg.message));
      }
    };
    w.addEventListener("message", handler);
    w.postMessage({
      type: "assemble_ablation",
      variants,
      featureNames,
      threshold,
    } satisfies WorkerRequest);
  });
}

/**
 * Runs the leave-one-variable-out suite: a baseline plus one variant per
 * active link, striped across the EXISTING worker pool (no extra workers
 * are spawned — each Pyodide instance costs ~150 MB), then assembled into
 * the AblationReport on worker 0.
 *
 * Diagnostic of the raw matching geometry: the cutoff and confidence
 * filter deliberately do not apply inside it.
 */
export async function runAblation(
  target: ParsedDataset,
  supplemental: ParsedDataset,
  links: ColumnLink[],
  threshold: number,
  onProgress?: ProgressCallback
): Promise<AblationReport> {
  const payloads = buildPayloads(
    target, supplemental, links, threshold, null, null
  );
  const d = payloads.links.length;
  if (d < 2) {
    throw new Error(
      "The variable check needs at least two linked variables."
    );
  }

  // null = baseline, then one drop per active link (link order == the
  // engine's feature order).
  const dropIndices: (number | null)[] = [null];
  for (let i = 0; i < d; i++) dropIndices.push(i);

  const nWorkers = Math.max(1, Math.min(pool.length || 1, dropIndices.length));
  let completed = 0;
  const report = () => {
    completed += 1;
    onProgress?.(completed / dropIndices.length);
  };

  // Abandonment: terminatePool() rejects `abandoned`, which every await
  // below races against — otherwise a suite whose workers were killed
  // would simply never settle.
  const generation = poolGeneration;
  let abandon: () => void = () => {};
  const abandoned = new Promise<never>((_, reject) => {
    abandon = () => reject(new WorkAbandoned());
  });
  abandonHandlers.add(abandon);

  try {
    // Stripe the variants round-robin; each worker runs its share
    // sequentially while the workers themselves run concurrently.
    const results = new Array<AblationVariantPayload>(dropIndices.length);
    await Promise.race([
      abandoned,
      Promise.all(
        Array.from({ length: nWorkers }, async (_, w) => {
          for (let k = w; k < dropIndices.length; k += nWorkers) {
            // A result that landed just before a reset must not post the
            // next variant into the NEW pool getWorker() would spawn.
            if (poolGeneration !== generation) throw new WorkAbandoned();
            results[k] = await runAblationVariantOn(
              getWorker(w), payloads, dropIndices[k] as number | null
            );
            report();
          }
        })
      ),
    ]);

    if (poolGeneration !== generation) throw new WorkAbandoned();
    const featureNames = payloads.links.map((l) => l.headerName);
    return await Promise.race([
      abandoned,
      runAssembleAblationOn(
        getWorker(0), results, featureNames, payloads.threshold
      ),
    ]);
  } catch (err) {
    // Same stale-results hygiene as runMatching: a failed variant leaves
    // workers mid-compute; kill the pool rather than risk poisoned output.
    // Only OUR pool, though — after a reset it is gone or belongs to a
    // newer run, and killing that would hang the run.
    if (!(err instanceof WorkAbandoned) && poolGeneration === generation) {
      terminatePool();
    }
    throw err;
  } finally {
    abandonHandlers.delete(abandon);
  }
}
