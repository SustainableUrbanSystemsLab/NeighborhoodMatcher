import type { AppStep } from "@/types";

const STEPS: { key: AppStep; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "agreement", label: "Agreement" },
  { key: "link", label: "Link Columns" },
  { key: "matching", label: "Match" },
  { key: "results", label: "Results" },
];

export function StepIndicator({ currentStep }: { currentStep: AppStep }) {
  const currentIdx = STEPS.findIndex((s) => s.key === currentStep);

  return (
    <nav className="flex items-center justify-center gap-2 py-4">
      {STEPS.map((step, idx) => {
        const isActive = idx === currentIdx;
        const isComplete = idx < currentIdx;

        return (
          <div key={step.key} className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                isActive
                  ? "bg-blue-600 text-white"
                  : isComplete
                    ? "bg-blue-100 text-blue-700"
                    : "bg-gray-100 text-gray-400"
              }`}
            >
              {isComplete ? "\u2713" : idx + 1}
            </div>
            <span
              className={`text-sm ${
                isActive
                  ? "font-semibold text-gray-900"
                  : isComplete
                    ? "text-gray-600"
                    : "text-gray-400"
              }`}
            >
              {step.label}
            </span>
            {idx < STEPS.length - 1 && (
              <div
                className={`h-px w-8 ${
                  isComplete ? "bg-blue-300" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
