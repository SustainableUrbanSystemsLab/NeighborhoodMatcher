import type { AppStep } from "@/types";

const STEPS: { key: AppStep; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "agreement", label: "Agreement" },
  { key: "link", label: "Link Columns" },
  { key: "matching", label: "Match" },
  { key: "results", label: "Results" },
];

// The full row (circles, labels, connectors) needs ~680px. Below md, only
// the circles stay in the row and the current step's label sits under it;
// the other labels remain for screen readers.
export function StepIndicator({ currentStep }: { currentStep: AppStep }) {
  const currentIdx = STEPS.findIndex((s) => s.key === currentStep);

  return (
    <nav className="py-4">
      <div className="flex items-center justify-center gap-1 md:gap-2">
        {STEPS.map((step, idx) => {
          const isActive = idx === currentIdx;
          const isComplete = idx < currentIdx;

          return (
            <div
              key={step.key}
              className="flex items-center gap-2"
              aria-current={isActive ? "step" : undefined}
            >
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                  isActive
                    ? "bg-blue-600 text-white"
                    : isComplete
                      ? "bg-blue-100 text-blue-700 dark:text-blue-300"
                      : "bg-gray-100 text-gray-400"
                }`}
              >
                {isComplete ? "\u2713" : idx + 1}
              </div>
              <span
                className={`sr-only whitespace-nowrap text-sm md:not-sr-only ${
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
                  className={`h-px w-4 md:w-8 ${
                    isComplete ? "bg-blue-300" : "bg-gray-200"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
      {currentIdx >= 0 && (
        <p
          className="mt-2 text-center text-sm font-semibold text-gray-900 md:hidden"
          aria-hidden="true"
        >
          {STEPS[currentIdx]!.label}
        </p>
      )}
    </nav>
  );
}
