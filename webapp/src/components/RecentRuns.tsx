// "Recent runs" on the upload step: what you matched, when, and how it went.
//
// Metadata only — see lib/run-history.ts. The panel says so out loud, because
// a researcher handling PHI should not have to read source to find out what a
// tool keeps on their machine.

import { useRef, useState } from "react";
import {
  clearRuns,
  deleteRun,
  loadRuns,
  type RunRecord,
} from "@/lib/run-history";
import { localTimestamp } from "@/lib/about";
import { restoreFromZip, type RestoredRun } from "@/lib/restore";

function pct(n: number, of: number): string {
  return of ? `${((n / of) * 100).toFixed(0)}%` : "—";
}

function settingsLine(run: RunRecord): string {
  const bits = [`NNDR ${run.settings.threshold}`];
  if (run.settings.maxDistance != null)
    bits.push(`cutoff ${run.settings.maxDistance}`);
  if (run.settings.minConfidence)
    bits.push(`min ${run.settings.minConfidence}`);
  return bits.join(" · ");
}

function RunRow({
  run,
  onDelete,
}: {
  run: RunRecord;
  onDelete: (id: string) => void;
}) {
  const flaggedVars = run.variables.filter(
    (v) => v.verdict === "consider_excluding"
  );
  const mnn = pct(run.summary.mnnConfirmed, run.summary.total);
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-gray-800">
          {run.targetFile} <span className="text-gray-400">×</span>{" "}
          {run.supplementalFile}
        </p>
        <p className="mt-0.5 text-[11px] text-gray-500">
          {localTimestamp(new Date(run.finishedAt))} · {run.summary.total} rows ·{" "}
          {run.features.length} variable{run.features.length === 1 ? "" : "s"} ·{" "}
          {settingsLine(run)}
        </p>
        <p className="mt-0.5 text-[11px] text-gray-500">
          MNN confirmed {mnn} · High confidence{" "}
          {pct(run.summary.high, run.summary.total)}
          {run.summary.withheld > 0 && ` · ${run.summary.withheld} withheld`}
          {run.summary.noMatch > 0 && ` · ${run.summary.noMatch} no match`}
        </p>
        {flaggedVars.length > 0 && (
          <p className="mt-0.5 text-[11px] text-red-700 dark:text-red-300">
            Variable check flagged:{" "}
            {flaggedVars.map((v) => v.feature).join(", ")}
          </p>
        )}
      </div>
      <button
        onClick={() => onDelete(run.id)}
        title="Forget this run"
        aria-label={`Forget the run of ${run.targetFile} from ${localTimestamp(new Date(run.finishedAt))}`}
        className="shrink-0 rounded px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-700"
      >
        ✕
      </button>
    </li>
  );
}

export function RecentRuns({
  onRestore,
}: {
  /** hands a reproduced run's inputs and settings back to the page */
  onRestore: (restored: RestoredRun) => void;
}) {
  const [runs, setRuns] = useState<RunRecord[]>(loadRuns);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const zipInput = useRef<HTMLInputElement>(null);

  async function handleZip(file: File) {
    setRestoring(true);
    setRestoreError(null);
    try {
      onRestore(await restoreFromZip(file));
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : String(err));
    } finally {
      setRestoring(false);
    }
  }

  const restoreControl = (
    <div className="rounded-lg border border-gray-200 bg-surface p-4 text-sm text-gray-600">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-medium text-gray-800">Reopen a previous run</h3>
          <p className="mt-0.5 max-w-xl text-xs text-gray-500">
            Load a results zip you downloaded earlier. It carries your original
            files and the settings used, and matching is deterministic — so the
            run is reproduced exactly, charts included. Nothing was kept in this
            browser to make that work.
          </p>
        </div>
        <button
          onClick={() => zipInput.current?.click()}
          disabled={restoring}
          className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-60"
        >
          {restoring ? "Reading zip…" : "Choose results zip"}
        </button>
        <input
          ref={zipInput}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = ""; // allow re-picking the same file
            if (f) void handleZip(f);
          }}
        />
      </div>
      {restoreError && (
        <p className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {restoreError}
        </p>
      )}
    </div>
  );

  if (runs.length === 0) return restoreControl;

  return (
    <div className="space-y-4">
      {restoreControl}
    <details className="rounded-lg border border-gray-200 bg-surface p-4 text-sm text-gray-600">
      <summary className="cursor-pointer font-medium text-gray-800">
        Recent runs on this device ({runs.length})
      </summary>
      <p className="mt-2 text-xs text-gray-500">
        Settings and quality numbers only — no rows, values, or matched data
        from either file are stored. Clearing the list removes it from this
        browser.
      </p>
      <ul className="mt-2 divide-y divide-gray-100">
        {runs.map((run) => (
          <RunRow
            key={run.id}
            run={run}
            onDelete={(id) => setRuns(deleteRun(id))}
          />
        ))}
      </ul>
      <button
        onClick={() => {
          clearRuns();
          setRuns([]);
        }}
        className="mt-2 rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
      >
        Clear history
      </button>
    </details>
    </div>
  );
}
