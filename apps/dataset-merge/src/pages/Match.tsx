import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type {
  AppStep,
  ColumnLink,
  MatchOutput,
  PIIWarning,
  ParsedDataset,
} from "@/types";
import {
  findCommonHeaders,
  prefetchPyodide,
  runMatching,
  type PyodideStatus,
} from "@/lib/matching";
import { detectPII } from "@/lib/pii-detector";
import { StepIndicator } from "@/components/StepIndicator";
import { AgreementModal } from "@/components/AgreementModal";
import { FileUpload } from "@/components/FileUpload";
import { ColumnLinker } from "@/components/ColumnLinker";
import { ResultsView } from "@/components/ResultsView";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const DEFAULT_THRESHOLD = 0.8;

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
  const [step, setStep] = useState<AppStep>("upload");
  const [target, setTarget] = useState<ParsedDataset | null>(null);
  const [supplemental, setSupplemental] = useState<ParsedDataset | null>(null);
  const [links, setLinks] = useState<ColumnLink[]>([]);
  const [piiWarnings, setPiiWarnings] = useState<PIIWarning[]>([]);
  const [matchOutput, setMatchOutput] = useState<MatchOutput | null>(null);
  const [threshold, setThreshold] = useState<number>(DEFAULT_THRESHOLD);
  const [pyStatus, setPyStatus] = useState<PyodideStatus>({ phase: "idle" });
  const [runError, setRunError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [runDurationMs, setRunDurationMs] = useState<number | null>(null);
  const [progressPct, setProgressPct] = useState(0);
  const tickRef = useRef<number | null>(null);

  // Warm up Pyodide in the background once the user accepts the agreement —
  // avoids a long wait at "Run Matching".
  useEffect(() => {
    if (step === "link") prefetchPyodide(setPyStatus);
  }, [step]);

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

  const handleNext = useCallback(() => {
    if (!target || !supplemental) return;
    setStep("agreement");
  }, [target, supplemental]);

  const handleAgreementAccept = useCallback(() => {
    if (!target || !supplemental) return;

    const autoLinks = findCommonHeaders(target.headers, supplemental.headers);
    const warnings = [
      ...detectPII(target.headers, "target"),
      ...detectPII(supplemental.headers, "supplemental"),
    ];

    setLinks(autoLinks);
    setPiiWarnings(warnings);
    setStep("link");
  }, [target, supplemental]);

  const handleRunMatching = useCallback(async () => {
    if (!target || !supplemental) return;

    const activeLinks = links.filter((l) => !l.excluded);
    if (activeLinks.length === 0) return;

    setStep("matching");
    setRunError(null);

    const t0 = performance.now();
    try {
      const output = await runMatching(
        target,
        supplemental,
        links,
        threshold,
        setPyStatus,
        setProgressPct
      );
      setRunDurationMs(performance.now() - t0);
      setMatchOutput(output);
      // The worker's last status message is "running"; without this the
      // link step shows a phantom "Running matcher…" forever after a run.
      setPyStatus({ phase: "ready" });
      setStep("results");
    } catch (err) {
      console.error("runMatching failed:", err);
      setRunError(err instanceof Error ? err.message : String(err));
      setStep("link");
    }
  }, [target, supplemental, links, threshold]);

  const handleStartOver = useCallback(() => {
    setStep("upload");
    setTarget(null);
    setSupplemental(null);
    setLinks([]);
    setPiiWarnings([]);
    setMatchOutput(null);
    setThreshold(DEFAULT_THRESHOLD);
    setRunError(null);
    setRunDurationMs(null);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-4xl p-4">
        <div className="mb-2 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Dataset Matcher</h1>
          <Link to="/about" className="text-sm text-blue-600 hover:text-blue-800">
            How it works →
          </Link>
        </div>

        <StepIndicator currentStep={step} />

        <div className="mt-6">
          {step === "upload" && (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <FileUpload
                  label="Target Dataset"
                  description="Your primary dataset with rows to match"
                  onFileLoaded={setTarget}
                  onClear={() => setTarget(null)}
                  dataset={target}
                />
                <FileUpload
                  label="Supplemental Dataset"
                  description="Reference dataset to match against"
                  onFileLoaded={setSupplemental}
                  onClear={() => setSupplemental(null)}
                  dataset={supplemental}
                />
              </div>
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
              <ColumnLinker
                target={target}
                supplemental={supplemental}
                links={links}
                piiWarnings={piiWarnings}
                onLinksChange={setLinks}
              />

              <ThresholdControl threshold={threshold} onChange={setThreshold} />

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
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Computation runs entirely in your browser.
              </p>
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
                      className="rounded border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                    >
                      Retry render
                    </button>
                    <button
                      onClick={handleStartOver}
                      className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
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
                onStartOver={handleStartOver}
              />
            </ErrorBoundary>
          )}
        </div>
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
    <div className="rounded-lg border border-gray-200 bg-white p-4">
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
        distance is ≥ threshold. Lower = stricter. Default 0.80 (Lowe 2004).
      </p>
    </div>
  );
}
