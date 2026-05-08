// HIPAA NOTE: The matcher runs inside a Web Worker in the same tab.
// Dataset contents travel via structured-clone postMessage and never leave
// the browser. Only the Pyodide runtime (WASM + stdlib) and numpy wheel are
// fetched from a public CDN — no user data is transmitted.

import MatcherWorker from "./matcher.worker.ts?worker";
import type { WorkerRequest, WorkerResponse, StatusPhase } from "./matcher.worker";
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

let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new MatcherWorker();
  }
  return worker;
}

function post(req: WorkerRequest) {
  getWorker().postMessage(req);
}

export function prefetchPyodide(onStatus?: StatusCallback): void {
  const w = getWorker();
  const handler = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    if (msg.type === "status") onStatus?.(statusFromPhase(msg.phase));
    else if (msg.type === "error")
      onStatus?.({ phase: "error", message: msg.message });
  };
  w.addEventListener("message", handler);
  post({ type: "init" });
}

function statusFromPhase(phase: StatusPhase): PyodideStatus {
  return { phase } as PyodideStatus;
}

function datasetToCsv(dataset: ParsedDataset): string {
  return Papa.unparse({ fields: dataset.headers, data: dataset.rows });
}

export async function runMatching(
  target: ParsedDataset,
  supplemental: ParsedDataset,
  links: ColumnLink[],
  threshold: number,
  onStatus?: StatusCallback,
  onProgress?: ProgressCallback
): Promise<MatchOutput> {
  const activeLinks = links.filter((l) => !l.excluded);
  if (activeLinks.length === 0) {
    throw new Error("No active column links to match on.");
  }

  const w = getWorker();
  const targetCsv = datasetToCsv(target);
  const supplementalCsv = datasetToCsv(supplemental);

  const linksPayload = activeLinks.map((l) => ({
    headerName: l.headerName,
    header1Index: l.targetIndex,
    header2Index: l.supplementalIndex,
  }));

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

    post({
      type: "match",
      targetCsv,
      supplementalCsv,
      links: linksPayload,
      threshold,
    });
  });
}
