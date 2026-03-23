import { useState, useCallback } from "react";
import type {
  AppStep,
  ColumnLink,
  MatchOutput,
  PIIWarning,
  ParsedDataset,
} from "@/types";
import { findCommonHeaders, runMatching } from "@/lib/matching";
import { detectPII } from "@/lib/pii-detector";
import { StepIndicator } from "@/components/StepIndicator";
import { AgreementModal } from "@/components/AgreementModal";
import { FileUpload } from "@/components/FileUpload";
import { ColumnLinker } from "@/components/ColumnLinker";
import { ResultsView } from "@/components/ResultsView";

export default function Match() {
  const [step, setStep] = useState<AppStep>("upload");
  const [target, setTarget] = useState<ParsedDataset | null>(null);
  const [supplemental, setSupplemental] = useState<ParsedDataset | null>(null);
  const [links, setLinks] = useState<ColumnLink[]>([]);
  const [piiWarnings, setPiiWarnings] = useState<PIIWarning[]>([]);
  const [matchOutput, setMatchOutput] = useState<MatchOutput | null>(null);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

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
    setProgress({ current: 0, total: target.rows.length });

    const output = await runMatching(target, supplemental, links, (cur, tot) =>
      setProgress({ current: cur, total: tot })
    );

    setMatchOutput(output);
    setStep("results");
  }, [target, supplemental, links]);

  const handleStartOver = useCallback(() => {
    setStep("upload");
    setTarget(null);
    setSupplemental(null);
    setLinks([]);
    setPiiWarnings([]);
    setMatchOutput(null);
    setProgress(null);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-4xl p-4">
        <div className="mb-2 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Dataset Matcher</h1>
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

          {step === "matching" && progress && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-4 text-lg font-medium text-gray-700">
                Matching in progress...
              </div>
              <div className="mb-2 h-3 w-64 overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all"
                  style={{
                    width: `${(progress.current / progress.total) * 100}%`,
                  }}
                />
              </div>
              <p className="text-sm text-gray-500">
                {progress.current} / {progress.total} rows
              </p>
            </div>
          )}

          {step === "results" && matchOutput && (
            <ResultsView output={matchOutput} onStartOver={handleStartOver} />
          )}
        </div>
      </div>
    </div>
  );
}