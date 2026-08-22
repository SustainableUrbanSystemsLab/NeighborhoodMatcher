// Plain-language copy for the variable panel, composed from the structured
// report (NOT parsed from Python strings — the per-variable `notes` field
// arrives pre-rendered from matcher.signals.variable_report, and this file
// only adds panel-level wording on top of the structured numbers).

import type { AblationReport, AblationVariable, AblationVerdict } from "@/types";

export function verdictLabel(verdict: AblationVerdict): string {
  switch (verdict) {
    case "consider_excluding":
      return "Consider excluding";
    case "load_bearing":
      return "Load-bearing";
    case "insufficient_rows":
      return "Sample too small";
    default:
      return "Neutral";
  }
}

/** Colors for the verdict chip (Tailwind utility classes). */
export function verdictChipClasses(verdict: AblationVerdict): string {
  switch (verdict) {
    case "consider_excluding":
      return "bg-red-100 text-red-800 border-red-200";
    case "load_bearing":
      return "bg-blue-100 text-blue-800 border-blue-200";
    case "insufficient_rows":
      return "bg-gray-100 text-gray-500 border-gray-200";
    default:
      return "bg-gray-100 text-gray-600 border-gray-200";
  }
}

const pts = (v: number): string => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;

/** One sentence on what removing this variable did to the run. */
export function removalSentence(v: AblationVariable): string {
  const mnn = `${pts(v.delta_mnn_pct)} pts MNN-confirmed`;
  const high = `${pts(v.delta_high_pct)} pts High confidence`;
  switch (v.verdict) {
    case "consider_excluding":
      return (
        `Matching without this variable is better (${mnn}, ${high}). ` +
        "It is likely hurting the linkage — consider excluding it and re-running."
      );
    case "load_bearing":
      return (
        `Matching without this variable is much worse (${mnn}, ${high}). ` +
        "It is doing real discriminating work — keep it."
      );
    case "insufficient_rows":
      return (
        `Too few rows for a reliable verdict (${mnn}, ${high} on this sample).`
      );
    default:
      return `Removing it barely changes the run (${mnn}, ${high}).`;
  }
}

/** Footnote explaining scope and caveats of the check. */
export function ablationFootnote(report: AblationReport): string {
  const scope = report.sampled
    ? `Re-matched ${report.sample_size} of ${report.n_targets} target rows ` +
      "(evenly sampled for compute) with each variable left out; percentages " +
      "compare the baseline and the variants on that same sample."
    : `Re-matched all ${report.n_targets} target rows with each variable left out.`;
  return (
    scope +
    " The check looks at the raw matching geometry — the distance cutoff " +
    "and minimum-confidence settings do not apply inside it."
  );
}
