import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type {
  AblationState,
  AppStep,
  ColumnLink,
  MatchOutput,
  PIIWarning,
  ParsedDataset,
} from "@/types";
import {
  ablationAutoRunAllowed,
  cancelBackgroundWork,
  findAmbiguousHeaders,
  findCommonHeaders,
  getSavedWorkerCount,
  poolSizeFor,
  prefetchPyodide,
  reportedCores,
  runAblation,
  runMatching,
  saveWorkerCount,
  terminatePool,
  WorkAbandoned,
  type PyodideStatus,
} from "@/lib/matching";
import { detectPII } from "@/lib/pii-detector";
import { StepIndicator } from "@/components/StepIndicator";
import { AgreementModal } from "@/components/AgreementModal";
import {
  clearAgreement,
  loadSavedAgreement,
  saveAgreement,
} from "@/lib/agreement";
import { FileUpload } from "@/components/FileUpload";
import { ColumnLinker } from "@/components/ColumnLinker";
import { DataChecklist } from "@/components/DataChecklist";
import { ResultsView } from "@/components/ResultsView";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SiteFooter } from "@/components/SiteFooter";
import { RecentRuns } from "@/components/RecentRuns";
import { recordAblation, recordRun } from "@/lib/run-history";
import type { RestoredRun } from "@/lib/restore";
import { MATCHER_VERSION } from "@/lib/about";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "@/lib/use-theme";

const DEFAULT_THRESHOLD = 0.8;

function formatComparisons(n: number): string {
  if (n >= 1e9) return `about ${(n / 1e9).toFixed(1)} billion`;
  if (n >= 1e6)
    return `about ${n >= 1e7 ? Math.round(n / 1e6) : (n / 1e6).toFixed(1)} million`;
  return n.toLocaleString("en-US");
}

function statusLabel(status: PyodideStatus): string {
  switch (status.phase) {
    case "loading-runtime":
      return "Downloading Python runtime (first-time only)…";
    case "loading-numpy":
      return "Loading numpy…";
    case "loading-matcher":
      return "Loading matcher modules…";
    case "ready":
      return "Ready.";
    case "running":
      return "Running matcher in a background worker…";
    case "error":
      return `Error: ${status.message}`;
    default:
      return "Preparing…";
  }
}

export default function Match() {
  const theme = useTheme();
  const [step, setStep] = useState<AppStep>("upload");
  const [target, setTarget] = useState<ParsedDataset | null>(null);
  const [supplemental, setSupplemental] = useState<ParsedDataset | null>(null);
  const [links, setLinks] = useState<ColumnLink[]>([]);
  const [piiWarnings, setPiiWarnings] = useState<PIIWarning[]>([]);
  const [matchOutput, setMatchOutput] = useState<MatchOutput | null>(null);
  const [threshold, setThreshold] = useState<number>(DEFAULT_THRESHOLD);
  const [maxDistance, setMaxDistance] = useState<number | null>(null);
  const [minConfidence, setMinConfidence] = useState<"medium" | "high" | null>(
    "high"
  );
  const [ablation, setAblation] = useState<AblationState>({ status: "idle" });
  // Invalidates in-flight ablation updates after a re-run / start-over — a
  // late resolve or reject from a killed run must not clobber fresh state.
  const ablationRunRef = useRef(0);
  // History entry for the current run, so the variable check can add its
  // verdicts to the same record once it completes.
  const runRecordIdRef = useRef<string | null>(null);
  // Set while a restored pair is being installed, so the auto-link effect
  // skips exactly one pass and leaves the restored exclusions alone.
  const restoredRef = useRef(false);
  const [pyStatus, setPyStatus] = useState<PyodideStatus>({ phase: "idle" });
  const [runError, setRunError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [runDurationMs, setRunDurationMs] = useState<number | null>(null);
  // When the run finished: shown on the results page and stamped into the
  // downloaded package, so screen and report never disagree.
  const [completedAt, setCompletedAt] = useState<Date | null>(null);
  const [workersUsed, setWorkersUsed] = useState<number | null>(null);
  const [agreementSavedAt, setAgreementSavedAt] = useState<string | null>(
    () => loadSavedAgreement()?.acceptedAt ?? null
  );
  const [workerOverride, setWorkerOverride] = useState<number | null>(() =>
    getSavedWorkerCount()
  );
  const [progressPct, setProgressPct] = useState(0);
  // Banner describing the run a results zip was reproduced from.
  const [restored, setRestored] = useState<RestoredRun | null>(null);
  const tickRef = useRef<number | null>(null);

  // Warm up Pyodide in the background once the user accepts the agreement —
  // avoids a long wait at "Run Matching".
  useEffect(() => {
    if (step === "link") prefetchPyodide(setPyStatus);
  }, [step]);

  // Leaving the page mid-run (header logo, browser back) cannot cancel
  // in-flight Python — kill the pool so a busy worker never feeds stale
  // results to a later run.
  useEffect(() => () => terminatePool(), []);

  // Auto-links and PII warnings derive from the DATASETS, not from step
  // transitions: recomputing on every entry to the link step would wipe the
  // user's manual links/exclusions after Back→Next or agreement review.
  useEffect(() => {
    if (!target || !supplemental) return;
    setPiiWarnings([
      ...detectPII(target.headers, "target"),
      ...detectPII(supplemental.headers, "supplemental"),
    ]);
    // A restored run already carries its own column selection (including the
    // exclusions that shaped it); re-deriving links here would silently undo
    // them and reproduce a DIFFERENT run.
    if (restoredRef.current) {
      restoredRef.current = false;
      return;
    }
    setLinks(findCommonHeaders(target.headers, supplemental.headers));
  }, [target, supplemental]);

  const ambiguousHeaders = useMemo(
    () =>
      target && supplemental
        ? findAmbiguousHeaders(target.headers, supplemental.headers)
        : [],
    [target, supplemental]
  );

  // Elapsed timer while the matching step is active. Because Pyodide now runs
  // in a worker, the main thread keeps rendering and the counter updates.
  useEffect(() => {
    if (step !== "matching") {
      if (tickRef.current) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    setElapsed(0);
    setProgressPct(0);
    tickRef.current = window.setInterval(() => {
      setElapsed((e) => e + 1);
    }, 1000);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [step]);

  const proceedToLink = useCallback(() => {
    if (!target || !supplemental) return;
    setStep("link");
  }, [target, supplemental]);

  const handleNext = useCallback(() => {
    if (!target || !supplemental) return;
    const saved = loadSavedAgreement();
    if (saved) {
      setAgreementSavedAt(saved.acceptedAt);
      proceedToLink();
    } else {
      setStep("agreement");
    }
  }, [target, supplemental, proceedToLink]);

  const handleAgreementAccept = useCallback(
    (remember: boolean) => {
      if (remember) {
        saveAgreement();
        setAgreementSavedAt(new Date().toISOString());
      }
      proceedToLink();
    },
    [proceedToLink]
  );

  // Reopen a previous run from its results zip: the package carries the
  // original inputs and the settings, so loading it back reproduces the run
  // exactly. Lands on the Link step with everything pre-filled — the user
  // presses Run, rather than the page starting minutes of compute uninvited.
  const handleRestore = useCallback((run: RestoredRun) => {
    restoredRef.current = true;
    setTarget(run.target);
    setSupplemental(run.supplemental);
    setThreshold(run.threshold);
    setMaxDistance(run.maxDistance);
    setMinConfidence(run.minConfidence);
    setMatchOutput(null);
    setRunError(null);
    setRestored(run);
    ablationRunRef.current++;
    setAblation({ status: "idle" });
    cancelBackgroundWork();

    // The run's own column selection (exclusions and manual links included)
    // — rebuilt by restore.ts; the results only reproduce if it stays so.
    setLinks(run.links);

    if (loadSavedAgreement()) setStep("link");
    else setStep("agreement");
  }, []);

  const handleAgreementRevoke = useCallback(() => {
    clearAgreement();
    setAgreementSavedAt(null);
    setStep("agreement");
  }, []);

  // Fires the leave-one-variable-out check in the background (the results
  // page is already interactive while it runs). Guarded by a run token so a
  // stale resolve/reject after start-over or a re-run cannot clobber state.
  const startAblation = useCallback(() => {
    if (!target || !supplemental) return;
    const token = ++ablationRunRef.current;
    setAblation({ status: "running", progress: 0 });
    runAblation(target, supplemental, links, threshold, (pct) => {
      if (ablationRunRef.current === token) {
        setAblation({ status: "running", progress: pct });
      }
    })
      .then((report) => {
        if (ablationRunRef.current === token) {
          setAblation({ status: "done", report });
          if (runRecordIdRef.current) {
            recordAblation(runRecordIdRef.current, report);
          }
        }
      })
      .catch((err) => {
        // Abandoned on purpose (re-run, restore, start over): not an error.
        if (err instanceof WorkAbandoned) return;
        console.error("runAblation failed:", err);
        if (ablationRunRef.current === token) {
          setAblation({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });
  }, [target, supplemental, links, threshold]);

  const handleRunMatching = useCallback(async () => {
    if (!target || !supplemental) return;

    const activeLinks = links.filter((l) => !l.excluded);
    if (activeLinks.length === 0) return;

    setStep("matching");
    setRunError(null);
    ablationRunRef.current++;
    setAblation({ status: "idle" });
    // Planned pool size — deterministic, same computation the runner makes —
    // so the run screen can show core usage while the job is in flight.
    setWorkersUsed(poolSizeFor(target.rows.length, supplemental.rows.length));

    const t0 = performance.now();
    try {
      const { output, workersUsed: nWorkers } = await runMatching(
        target,
        supplemental,
        links,
        threshold,
        maxDistance,
        minConfidence,
        setPyStatus,
        setProgressPct
      );
      const durationMs = performance.now() - t0;
      const finishedAt = new Date();
      setRunDurationMs(durationMs);
      setCompletedAt(finishedAt);
      setWorkersUsed(nWorkers);
      setMatchOutput(output);
      // Metadata-only history entry (no dataset contents — see run-history.ts).
      runRecordIdRef.current = recordRun({
        output,
        target,
        supplemental,
        finishedAt,
        durationMs,
      }).id;
      // The worker's last status message is "running"; without this the
      // link step shows a phantom "Running matcher…" forever after a run.
      setPyStatus({ phase: "ready" });
      setStep("results");

      // Variable check: automatic when even the minimum target sample fits
      // the compute budget; otherwise offered as a button on the panel.
      const d = activeLinks.length;
      if (d < 2) {
        setAblation({ status: "unavailable" });
      } else if (ablationAutoRunAllowed(supplemental.rows.length, d)) {
        startAblation();
      } else {
        setAblation({ status: "gated" });
      }
    } catch (err) {
      console.error("runMatching failed:", err);
      setRunError(err instanceof Error ? err.message : String(err));
      setStep("link");
    }
  }, [target, supplemental, links, threshold, maxDistance, minConfidence, startAblation]);

  // "Exclude and adjust" from the variable panel: flip the link's exclude
  // toggle and return to the Link step for review — the user re-runs
  // explicitly (never silently re-matching under them).
  const handleExcludeFeature = useCallback((featureName: string) => {
    ablationRunRef.current++;
    setAblation({ status: "idle" });
    // Stop the check still running on the old selection; the Link step's
    // prefetch warms a fresh pool while the user reviews.
    cancelBackgroundWork();
    setLinks((prev) =>
      prev.map((l) =>
        l.headerName === featureName ? { ...l, excluded: true } : l
      )
    );
    setStep("link");
  }, []);

  const handleStartOver = useCallback(() => {
    setStep("upload");
    setTarget(null);
    setSupplemental(null);
    setLinks([]);
    setPiiWarnings([]);
    setMatchOutput(null);
    setThreshold(DEFAULT_THRESHOLD);
    setMaxDistance(null);
    setMinConfidence(null);
    setRestored(null);
    ablationRunRef.current++;
    setAblation({ status: "idle" });
    setRunError(null);
    setRunDurationMs(null);
    setCompletedAt(null);
    setWorkersUsed(null);
    setPyStatus({ phase: "idle" });
    terminatePool();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-4xl p-4">
        <div className="mb-2 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5" title="Back to the landing page">
            <img src="/logo.svg" alt="" className="h-8 w-8" />
            <h1 className="text-2xl font-bold text-gray-900">Dataset Matcher</h1>
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle theme={theme} />
            <Link to="/about" className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800">
              How it works →
            </Link>
          </div>
        </div>

        <StepIndicator currentStep={step} />

        <div className="mt-6">
          {step === "upload" && (
            <div className="space-y-6">
              <p className="text-sm leading-relaxed text-gray-600">
                For each row in your <strong>target</strong> dataset, the tool
                finds the most similar row in the <strong>supplemental</strong>{" "}
                dataset based on the shared characteristics you choose —
                linking new information without matching on ZIP code or any
                other identifier.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <FileUpload
                  label="Target Dataset"
                  description="The dataset you want to add information to (e.g., your study dataset)"
                  onFileLoaded={setTarget}
                  onClear={() => setTarget(null)}
                  dataset={target}
                />
                <FileUpload
                  label="Supplemental Dataset"
                  description="The dataset containing the information you want to link in (e.g., a public census extract)"
                  onFileLoaded={setSupplemental}
                  onClear={() => setSupplemental(null)}
                  dataset={supplemental}
                />
              </div>
              <details open className="rounded-lg border border-gray-200 bg-surface p-4 text-sm text-gray-600">
                <summary className="cursor-pointer font-medium text-gray-800">
                  File format &amp; pre-upload checklist
                </summary>
                <div className="mt-3">
                  <DataChecklist />
                </div>
              </details>
              <RecentRuns onRestore={handleRestore} />

              <div className="flex justify-end">
                <button
                  onClick={handleNext}
                  disabled={!target || !supplemental}
                  className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          <AgreementModal
            open={step === "agreement"}
            onAccept={handleAgreementAccept}
            onDecline={() => setStep("upload")}
          />

          {step === "link" && target && supplemental && (
            <div className="space-y-6">
              {restored && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                  <strong>Reopened {restored.zipName}.</strong> Its original
                  files, {restored.features.length || "all shared"} matching
                  variable{restored.features.length === 1 ? "" : "s"}, and the
                  settings it used (NNDR {restored.threshold}
                  {restored.maxDistance != null && `, cutoff ${restored.maxDistance}`}
                  {restored.minConfidence && `, minimum ${restored.minConfidence}`}
                  ) are loaded
                  {restored.generatedAt && ` from the run of ${restored.generatedAt}`}
                  .{" "}
                  {restored.unlinked.length > 0 ? (
                    <span className="font-medium text-amber-800">
                      {restored.unlinked.length === 1
                        ? `The matching variable "${restored.unlinked[0]}" could not be re-linked automatically`
                        : `${restored.unlinked.length} matching variables (${restored.unlinked.join(", ")}) could not be re-linked automatically`}
                      {" "}— the package predates link recording and the
                      column was linked to a differently named one, or the
                      column is missing. Re-create the link below before
                      running, or the result will differ from the original.
                    </span>
                  ) : (
                    "Matching is deterministic, so running now reproduces that run exactly."
                  )}
                  {restored.toolVersion &&
                    restored.toolVersion !== MATCHER_VERSION && (
                      <>
                        {" "}
                        Note: it was produced by engine v{restored.toolVersion}
                        {`, this build runs v${MATCHER_VERSION}`} —
                        results may differ.
                      </>
                    )}
                </div>
              )}
              {agreementSavedAt && (
                <p className="text-xs text-gray-500">
                  Data-use agreement previously accepted on this device (
                  {new Date(agreementSavedAt).toLocaleDateString()}).{" "}
                  <button
                    onClick={handleAgreementRevoke}
                    className="text-blue-600 dark:text-blue-400 underline hover:text-blue-800"
                  >
                    Review or revoke
                  </button>
                </p>
              )}
              {ambiguousHeaders.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  These column names appear more than once in a file and were
                  not auto-linked (linking them by name would be ambiguous):{" "}
                  <span className="font-mono">{ambiguousHeaders.join(", ")}</span>.
                  Rename them in the source files if they should participate
                  in matching.
                </div>
              )}
              <ColumnLinker
                target={target}
                supplemental={supplemental}
                links={links}
                piiWarnings={piiWarnings}
                onLinksChange={setLinks}
              />

              <ThresholdControl threshold={threshold} onChange={setThreshold} />

              <MaxDistanceControl value={maxDistance} onChange={setMaxDistance} />

              <MinConfidenceControl
                value={minConfidence}
                onChange={setMinConfidence}
              />

              <WorkerControl
                value={workerOverride}
                onChange={(n) => {
                  setWorkerOverride(n);
                  saveWorkerCount(n);
                }}
              />

              {runError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  Matching failed: {runError}
                </div>
              )}

              {pyStatus.phase !== "idle" && pyStatus.phase !== "ready" && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                  {statusLabel(pyStatus)}
                </div>
              )}

              <div className="flex justify-between">
                <button
                  onClick={() => setStep("upload")}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Back
                </button>
                <button
                  onClick={handleRunMatching}
                  disabled={links.filter((l) => !l.excluded).length === 0}
                  className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Run Matching
                </button>
              </div>
            </div>
          )}

          {step === "matching" && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-4 text-center text-lg font-medium text-gray-700">
                {statusLabel(pyStatus)}
              </div>
              <div className="h-3 w-80 overflow-hidden rounded-full bg-gray-200">
                {pyStatus.phase === "running" ? (
                  <div
                    className="h-full rounded-full bg-blue-600 transition-[width] duration-150 ease-linear"
                    style={{ width: `${Math.max(2, progressPct * 100)}%` }}
                  />
                ) : (
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-600" />
                )}
              </div>
              <p className="mt-3 font-mono text-xs text-gray-500">
                {pyStatus.phase === "running"
                  ? `${Math.round(progressPct * 100)}% · elapsed ${elapsed}s`
                  : `elapsed ${elapsed}s`}
                {workersUsed != null &&
                  ` · ${workersUsed} core${workersUsed === 1 ? "" : "s"}`}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Computation runs entirely in your browser.
              </p>
              {target && supplemental && workersUsed != null && (
                <p className="mt-4 max-w-xl text-center text-[11px] leading-relaxed text-gray-400">
                  This run compares {target.rows.length.toLocaleString("en-US")}{" "}
                  target rows against{" "}
                  {supplemental.rows.length.toLocaleString("en-US")}{" "}
                  supplemental rows —{" "}
                  {formatComparisons(
                    target.rows.length * supplemental.rows.length
                  )}{" "}
                  row comparisons — on {workersUsed} of the{" "}
                  {navigator.hardwareConcurrency || "?"} CPU cores your
                  browser reports. Small jobs deliberately use fewer cores:
                  below a few million comparisons, loading and standardizing
                  the files (which every worker does) takes longer than the
                  matching itself, so extra cores wouldn&apos;t make the run
                  faster. If the core count looks too low, your browser may
                  under-report it for privacy — pin the real number under
                  &ldquo;Parallel workers&rdquo; on the previous step.
                </p>
              )}
            </div>
          )}

          {step === "results" && matchOutput && target && supplemental && (
            <ErrorBoundary
              fallback={(error, reset) => (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <p className="mb-1 text-sm font-semibold text-red-800">
                    The results view crashed.
                  </p>
                  <p className="mb-3 font-mono text-xs text-red-700">
                    {error.message}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={reset}
                      className="rounded border border-red-300 bg-surface px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                    >
                      Retry render
                    </button>
                    <button
                      onClick={handleStartOver}
                      className="rounded border border-gray-300 bg-surface px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                    >
                      Start Over
                    </button>
                  </div>
                </div>
              )}
            >
              <ResultsView
                output={matchOutput}
                target={target}
                supplemental={supplemental}
                links={links.filter((l) => !l.excluded)}
                runDurationMs={runDurationMs}
                workersUsed={workersUsed}
                completedAt={completedAt ?? new Date()}
                ablation={ablation}
                onExcludeFeature={handleExcludeFeature}
                onRunAblation={startAblation}
                onStartOver={handleStartOver}
              />
            </ErrorBoundary>
          )}
        </div>

        <SiteFooter />
      </div>
    </div>
  );
}

function WorkerControl({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (n: number | null) => void;
}) {
  const reported = reportedCores();
  return (
    <div className="rounded-lg border border-gray-200 bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            Parallel workers
          </h3>
          <p className="mt-0.5 max-w-md text-xs text-gray-500">
            Your browser reports {reported} CPU core
            {reported === 1 ? "" : "s"}.
          </p>
        </div>
        <select
          value={value ?? "auto"}
          onChange={(e) =>
            onChange(e.target.value === "auto" ? null : Number(e.target.value))
          }
          className="rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-800"
        >
          <option value="auto">
            Auto ({Math.max(1, reported - 1)} of {reported} reported)
          </option>
          {Array.from({ length: 16 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} worker{n === 1 ? "" : "s"}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function ThresholdControl({
  threshold,
  onChange,
}: {
  threshold: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-surface p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <label htmlFor="nndr" className="text-sm font-medium text-gray-800">
          Near-miss threshold (NNDR)
        </label>
        <span className="font-mono text-sm text-gray-700">
          {threshold.toFixed(2)}
        </span>
      </div>
      <input
        id="nndr"
        type="range"
        min={0.5}
        max={0.99}
        step={0.01}
        value={threshold}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full"
      />
      <p className="mt-2 text-xs text-gray-500">
        A match is flagged when the ratio of the best distance to the i-th
        distance is ≥ threshold. Lower = stricter. The 0.80 default comes
        from image matching (<a href="https://doi.org/10.1023/B:VISI.0000029664.99615.94" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline hover:text-blue-800">Lowe 2004</a>)
        and has not been calibrated for tabular data.
      </p>
    </div>
  );
}

function MaxDistanceControl({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const enabled = value != null;
  return (
    <div className="rounded-lg border border-gray-200 bg-surface p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onChange(e.target.checked ? 1.0 : null)}
          />
          Reject matches beyond a distance cutoff
        </label>
        {enabled && (
          <span className="font-mono text-sm text-gray-700">
            {value.toFixed(2)}
          </span>
        )}
      </div>
      {enabled && (
        <input
          type="range"
          min={0.25}
          max={3.0}
          step={0.05}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full"
        />
      )}
      <p className="mt-2 text-xs text-gray-500">
        {enabled
          ? "A row is reported as “no match” instead of being assigned its nearest supplemental row when the match’s distance, averaged per matching variable used (distance ÷ √features used), exceeds this cutoff. Roughly: 1.0 ≈ the rows differ by about one standard deviation on every variable compared. Missing variables add a fixed penalty to the distance, so rows with many missing values are rejected more readily."
          : "Off (default): every target row is assigned its nearest supplemental row, however far away, and the quality signals flag doubtful ones. Enable to report “no match” instead when nothing genuinely similar exists."}
      </p>
    </div>
  );
}

function MinConfidenceControl({
  value,
  onChange,
}: {
  value: "medium" | "high" | null;
  onChange: (v: "medium" | "high" | null) => void;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            Minimum confidence to report a link
          </h3>
          <p className="mt-0.5 max-w-md text-xs text-gray-500">
            {value == null
              ? "Off: every link is reported and the quality signals flag doubtful ones. Set a minimum for large runs where you only want links that meet a standard — rows below it are written unlinked instead of flagged."
              : `Links below ${value === "high" ? "High" : "Medium"} confidence are withheld: those rows appear unlinked in the linked dataset, with the nearest row and full diagnostics kept in the detail file for review.`}
          </p>
        </div>
        <select
          value={value ?? ""}
          onChange={(e) =>
            onChange(
              e.target.value === "" ? null : (e.target.value as "medium" | "high")
            )
          }
          className="rounded border border-gray-300 bg-surface px-2 py-1 text-sm"
        >
          <option value="">Off — report all links</option>
          <option value="medium">Medium or better</option>
          <option value="high">High only</option>
        </select>
      </div>
    </div>
  );
}
