// TODO: Expand agreement — legal review pending

import { useState } from "react";

interface AgreementModalProps {
  open: boolean;
  onAccept: (remember: boolean) => void;
  onDecline: () => void;
}

export function AgreementModal({
  open,
  onAccept,
  onDecline,
}: AgreementModalProps) {
  const [checks, setChecks] = useState({
    noPHI: false,
    phiGeneration: false,
    dataAccess: false,
    compliance: false,
  });
  const [remember, setRemember] = useState(false);

  const allChecked = Object.values(checks).every(Boolean);

  function toggle(key: keyof typeof checks) {
    setChecks((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 backdrop-blur-sm">
      <div className="mx-4 my-8 w-full max-w-xl rounded-xl bg-white p-6 shadow-2xl">
        <h2 className="mb-4 text-xl font-semibold text-gray-900">
          Data Use Agreement
        </h2>

        <div className="mb-4 space-y-3 text-sm text-gray-600">
          <p>
            This tool performs dataset matching entirely in your browser. Your
            data is never uploaded to any server.
          </p>

          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="font-medium text-red-800">
              Risk of generating Protected Health Information (PHI)
            </p>
            <p className="mt-1 text-red-700">
              Matching aggregate or de-identified datasets can produce results
              that re-identify individuals, creating PHI. Even when input
              datasets contain no direct identifiers, the combination of
              demographic and geographic variables may be sufficient to identify
              specific persons. You are responsible for evaluating this risk
              before proceeding.
            </p>
          </div>

          <p className="font-medium text-gray-800">
            By proceeding, you acknowledge and confirm:
          </p>
        </div>

        <div className="mb-4 space-y-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50">
            <input
              type="checkbox"
              checked={checks.noPHI}
              onChange={() => toggle("noPHI")}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <span className="text-sm text-gray-700">
              My input datasets do not contain PHI, direct identifiers (names,
              SSNs, addresses, medical record numbers), or other personally
              identifiable information (PII).
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50">
            <input
              type="checkbox"
              checked={checks.phiGeneration}
              onChange={() => toggle("phiGeneration")}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <span className="text-sm text-gray-700">
              I understand that the matching process may generate results that
              constitute PHI or enable re-identification of individuals, and I
              accept responsibility for handling such outputs appropriately.
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50">
            <input
              type="checkbox"
              checked={checks.dataAccess}
              onChange={() => toggle("dataAccess")}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <span className="text-sm text-gray-700">
              I have proper authorization and appropriate data use agreements in
              place to access, use, and link these datasets for my stated
              research purpose.
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50">
            <input
              type="checkbox"
              checked={checks.compliance}
              onChange={() => toggle("compliance")}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <span className="text-sm text-gray-700">
              I will handle all input data and generated results in compliance
              with my institution's data governance policies, applicable IRB
              protocols, and relevant regulations (HIPAA, FERPA, etc.).
            </span>
          </label>
        </div>

        <p className="mb-4 text-xs italic text-gray-400">
          To be expanded later
        </p>

        <label className="mb-4 flex cursor-pointer items-center gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={remember}
            onChange={() => setRemember((v) => !v)}
            className="h-3.5 w-3.5 rounded border-gray-300"
          />
          Save my selection on this device — skip this step next time (stored
          locally only; nothing about your data is saved)
        </label>

        <div className="flex justify-end gap-3">
          <button
            onClick={onDecline}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onAccept(remember)}
            disabled={!allChecked}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
