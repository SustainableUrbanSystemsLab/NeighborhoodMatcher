// HIPAA NOTE: This worker runs Pyodide + the matcher off the main thread.
// Dataset contents are passed in over postMessage (structured-cloned within
// the tab) and never leave the browser.

/// <reference lib="webworker" />

import { loadPyodide, type PyodideInterface } from "pyodide";
import type { MatchOutput } from "@/types";

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
  "pipeline",
  "web_api",
];

export interface MatchRequest {
  type: "match";
  targetCsv: string;
  supplementalCsv: string;
  links: Array<{
    headerName: string;
    header1Index: number;
    header2Index: number;
  }>;
  threshold: number;
}

export interface InitRequest {
  type: "init";
}

export type WorkerRequest = InitRequest | MatchRequest;

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

export interface ErrorMessage {
  type: "error";
  message: string;
}

export type WorkerResponse =
  | StatusMessage
  | ProgressMessage
  | ResultMessage
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
from matcher.web_api import coordinate_in_memory
`);

    send({ type: "status", phase: "ready" });
  })();
  return initPromise;
}

async function runMatch(req: MatchRequest): Promise<void> {
  await init();
  if (!pyodide) throw new Error("Pyodide not initialized.");

  send({ type: "status", phase: "running" });

  pyodide.globals.set("target_csv", req.targetCsv);
  pyodide.globals.set("supp_csv", req.supplementalCsv);
  pyodide.globals.set("links_json", JSON.stringify(req.links));
  pyodide.globals.set("threshold", req.threshold);
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
  }
}

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === "init") {
      await init();
    } else if (msg.type === "match") {
      await runMatch(msg);
    }
  } catch (err) {
    send({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
