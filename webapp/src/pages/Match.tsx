import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
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
import { columnVerdicts, guardLinks } from "@/lib/identifier-guard";
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
import {
  DEMO_SUPPLEMENTAL_FILE,
  DEMO_TARGET_FILE,
  downloadDemoFile,
  loadDemo,
  scoreAgainstAnswerKey,
  type DemoData,
} from "@/lib/demo";
import type { RestoredRun } from "@/lib/restore";
import { MATCHER_VERSION } from "@/lib/about";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "@/lib/use-theme";

const DEFAULT_THRESHOLD = 0.8;
// High by default: a first-time user gets only links that meet a standard;
// the Link step explains how to relax it. Start over must return here too.
const DEFAULT_MIN_CONFIDENCE: "medium" | "high" | null = "high";

function formatComparisons(n: number): string {
  if (n >= 1e9) return `about ${(n / 1e9).toFixed(1)} billion`;
  if (n >= 1e6)
    return `about ${n >= 1e7 ? Math.round(n / 1e6) : (n / 1e6).toFixed(1)} million`;
  return n.toLocaleString("en-US");
}

function statusLabel(status: PyodideStatus): string {
  switch (status.phase) {
    case "loading-runtime":
      return "Loading Python runtime…";
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
    DEFAULT_MIN_CONFIDENCE
  );
  const [ablation, setAblation] = useState<AblationState>({ status: "idle" });
  // Invalidates in-flight ablation updates after a re-run / start-over — a
  // late resolve or reject from a killed run must not clobber fresh state.
  const ablationRunRef = useRef(0);
  // Same for the matching run itself: a reset while it is in flight (Exit
  // demo, browser Back out of the demo) must not let it land afterwards.
  const matchRunRef = useRef(0);
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

  // Demo mode (/match?demo, lib/demo.ts): the sample pair and its answer
  // key, set only while BOTH datasets are the sample files. An upload, a
  // reopened package or Start over leaves the demo, and with it the skipped
  // data-use agreement and the answer key. The URL is the switch, so a demo
  // link can be shared and the browser's Back button leaves the demo.
  const [searchParams, setSearchParams] = useSearchParams();
  const wantsDemo = searchParams.has("demo");
  const [demo, setDemo] = useState<DemoData | null>(null);
  const [demoStatus, setDemoStatus] = useState<"idle" | "loading" | "error">("idle");
  const [demoError, setDemoError] = useState<string | null>(null);
  // Set the moment the demo is requested and cleared the moment it is left,
  // so the URL effect never acts on state that has not settled yet.
  const demoActiveRef = useRef(false);
  // Invalidates an in-flight load when the demo is left before it lands.
  const demoLoadRef = useRef(0);

  const dropDemoParam = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("demo");
        return next;
      },
      { replace: true }
    );
  }, [setSearchParams]);

  // The user's own data replaces the sample: no longer a demo.
  const leaveDemo = useCallback(() => {
    if (!demoActiveRef.current) return;
    demoActiveRef.current = false;
    demoLoadRef.current++;
    setDemo(null);
    setDemoStatus("idle");
    setDemoError(null);
    dropDemoParam();
  }, [dropDemoParam]);

  const answerKey = useMemo(
    () => (demo && matchOutput ? scoreAgainstAnswerKey(matchOutput, demo) : null),
    [demo, matchOutput]
  );

  // Warm up Pyodide in the background once the user accepts the agreement —
  // avoids a long wait at "Run Matching".
  useEffect(() => {
    if (step === "link") prefetchPyodide(setPyStatus);
  }, [step]);

  // Leaving the page mid-run (header logo, browser back) cannot cancel
  // in-flight Python — kill the pool so a busy worker never feeds stale
  // results to a later run.
  useEffect(() => () => terminatePool(), []);

  // Geographic-identifier verdicts per column (name + value shape), once per
  // dataset: the guard below runs on every link change and must not rescan
  // the rows each time.
  const targetVerdicts = useMemo(
    () => (target ? columnVerdicts(target) : []),
    [target]
  );
  const suppVerdicts = useMemo(
    () => (supplemental ? columnVerdicts(supplemental) : []),
    [supplemental]
  );

  // Every link change passes through the identifier guard, so a ZIP / tract /
  // GEOID column can never become a matching variable by any route (auto
  // link, Include toggle, manual link). Blocked links are always excluded.
  const updateLinks = useCallback(
    (next: ColumnLink[]) => {
      if (!target || !supplemental) {
        setLinks(next);
        return;
      }
      setLinks(guardLinks(next, target, supplemental, targetVerdicts, suppVerdicts));
    },
    [target, supplemental, targetVerdicts, suppVerdicts]
  );

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
    // them and reproduce a DIFFERENT run. (restore.ts applies the guard.)
    if (restoredRef.current) {
      restoredRef.current = false;
      return;
    }
    setLinks(
      guardLinks(
        findCommonHeaders(target.headers, supplemental.headers),
        target,
        supplemental,
        targetVerdicts,
        suppVerdicts
      )
    );
  }, [target, supplemental, targetVerdicts, suppVerdicts]);

  // Identifier columns kept out of this run — recorded in run_info.csv.
  const blockedColumns = useMemo(
    () => links.flatMap((l) => (l.blocked ? [l.blocked] : [])),
    [links]
  );

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
    if (demo) {
      // Synthetic sample data: no PHI, nothing to agree to.
      proceedToLink();
    } else if (saved) {
      setAgreementSavedAt(saved.acceptedAt);
      proceedToLink();
    } else {
      setStep("agreement");
    }
  }, [target, supplemental, demo, proceedToLink]);

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
    leaveDemo();
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
  }, [leaveDemo]);

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
    const run = ++matchRunRef.current;
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
      if (run !== matchRunRef.current) return;
      const durationMs = performance.now() - t0;
      const finishedAt = new Date();
      setRunDurationMs(durationMs);
      setCompletedAt(finishedAt);
      setWorkersUsed(nWorkers);
      setMatchOutput(output);
      // Metadata-only history entry (no dataset contents — see run-history.ts).
      // Demo runs stay out of Recent runs.
      runRecordIdRef.current = demo
        ? null
        : recordRun({
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
      if (run !== matchRunRef.current) return;
      console.error("runMatching failed:", err);
      setRunError(err instanceof Error ? err.message : String(err));
      setStep("link");
    }
  }, [target, supplemental, links, threshold, maxDistance, minConfidence, demo, startAblation]);

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

  // Back to an empty upload step with the default settings.
  const resetSession = useCallback(() => {
    matchRunRef.current++;
    setStep("upload");
    setTarget(null);
    setSupplemental(null);
    setLinks([]);
    setPiiWarnings([]);
    setMatchOutput(null);
    setThreshold(DEFAULT_THRESHOLD);
    setMaxDistance(null);
    setMinConfidence(DEFAULT_MIN_CONFIDENCE);
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

  const handleStartOver = useCallback(() => {
    leaveDemo();
    resetSession();
  }, [leaveDemo, resetSession]);

  const startDemo = useCallback(async () => {
    const load = ++demoLoadRef.current;
    resetSession();
    setDemo(null);
    setDemoStatus("loading");
    setDemoError(null);
    try {
      const data = await loadDemo();
      if (load !== demoLoadRef.current) return;
      setTarget(data.target);
      setSupplemental(data.supplemental);
      setDemo(data);
      setDemoStatus("idle");
      // Straight to Link, like a reopened package: the user presses Run.
      setStep("link");
    } catch (err) {
      if (load !== demoLoadRef.current) return;
      setDemoStatus("error");
      setDemoError(err instanceof Error ? err.message : String(err));
    }
  }, [resetSession]);

  // ?demo appearing starts the demo (a shared link, or "Try it with sample
  // data"); disappearing while it is active (Exit, browser Back) returns to
  // an empty upload step.
  useEffect(() => {
    if (wantsDemo && !demoActiveRef.current) {
      demoActiveRef.current = true;
      void startDemo();
    } else if (!wantsDemo && demoActiveRef.current) {
      demoActiveRef.current = false;
      demoLoadRef.current++;
      setDemo(null);
      setDemoStatus("idle");
      setDemoError(null);
      resetSession();
    }
  }, [wantsDemo, startDemo, resetSession]);

  return (
    <div className="min-h-screen bg-canvas">
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

        {demo && <DemoBar demo={demo} onExit={dropDemoParam} />}

        <StepIndicator currentStep={step} />

        <div className="mt-6">
          {step === "upload" && (
            <div className="space-y-6">
              <p className="text-sm leading-relaxed text-gray-600">
                For each row in your <strong>target</strong> dataset, the tool
                finds the most similar row in the <strong>supplemental</strong>{" "}
                dataset based on the shared characteristics you choose —
                linking new information without ever matching on ZIP codes,
                census tract IDs or other geographic identifiers, which the
                tool refuses to use as matching variables.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <FileUpload
                  label="Target Dataset"
                  description="The dataset you want to add information to (e.g., your study dataset)"
                  onFileLoaded={(d) => {
                    leaveDemo();
                    setTarget(d);
                  }}
                  onClear={() => {
                    leaveDemo();
                    setTarget(null);
                  }}
                  dataset={target}
                />
                <FileUpload
                  label="Supplemental Dataset"
                  description="The dataset containing the information you want to link in (e.g., a public census extract)"
                  onFileLoaded={(d) => {
                    leaveDemo();
                    setSupplemental(d);
                  }}
                  onClear={() => {
                    leaveDemo();
                    setSupplemental(null);
                  }}
                  dataset={supplemental}
                />
              </div>
              {!demo && (
                <p className="-mt-3 text-xs text-gray-500">
                  {demoStatus === "loading" ? (
                    "Loading the sample data…"
                  ) : demoStatus === "error" ? (
                    <span className="text-red-700">
                      Could not load the sample data ({demoError}).{" "}
                      <button onClick={() => void startDemo()} className="underline">
                        Try again
                      </button>
                    </span>
                  ) : (
                    <>
                      No data at hand?{" "}
                      <Link
                        to="/match?demo"
                        className="text-blue-600 dark:text-blue-400 underline hover:text-blue-800"
                      >
                        Try it with sample data
                      </Link>
                      .
                    </>
                  )}
                </p>
              )}
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
                  {restored.blockedFeatures.length > 0 && (
                    <span className="font-medium text-amber-800">
                      This package matched on{" "}
                      {restored.blockedFeatures.map((f) => `"${f}"`).join(", ")},{" "}
                      {restored.blockedFeatures.length === 1
                        ? "which is a geographic identifier and is no longer a permitted matching variable. It is excluded now, so running will differ from the original."
                        : "which are geographic identifiers and are no longer permitted matching variables. They are excluded now, so running will differ from the original."}{" "}
                    </span>
                  )}
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
                  ) : restored.blockedFeatures.length === 0 ? (
                    "Matching is deterministic, so running now reproduces that run exactly."
                  ) : null}
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
                targetVerdicts={targetVerdicts}
                suppVerdicts={suppVerdicts}
                onLinksChange={updateLinks}
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
                  row comparisons.
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
                blocked={blockedColumns}
                answerKey={answerKey}
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

/** One quiet line while the demo is active: what the sample is, its files,
 *  and the way out. */
function DemoBar({ demo, onExit }: { demo: DemoData; onExit: () => void }) {
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const link = "text-blue-600 dark:text-blue-400 underline hover:text-blue-800";

  async function download(name: string) {
    setError(null);
    try {
      setSavedPath(await downloadDemoFile(name));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
      <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 font-medium text-blue-800">
        Sample data
      </span>
      <span>
        {demo.target.rows.length} synthetic participants ×{" "}
        {demo.supplemental.rows.length.toLocaleString("en-US")} census tracts
      </span>
      <span aria-hidden="true">·</span>
      <span>
        Download{" "}
        <button
          onClick={() => void download(DEMO_TARGET_FILE)}
          className={link}
          aria-label={`Download the sample target file, ${DEMO_TARGET_FILE}`}
        >
          target
        </button>{" "}
        /{" "}
        <button
          onClick={() => void download(DEMO_SUPPLEMENTAL_FILE)}
          className={link}
          aria-label={`Download the sample supplemental file, ${DEMO_SUPPLEMENTAL_FILE}`}
        >
          supplemental
        </button>
      </span>
      <span aria-hidden="true">·</span>
      <button onClick={onExit} className={link}>
        Exit demo
      </button>
      {savedPath && <span className="basis-full">Saved to {savedPath}</span>}
      {error && <span className="basis-full text-red-700">{error}</span>}
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
