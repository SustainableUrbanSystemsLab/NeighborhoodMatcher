// Per-variable quality panel: the always-on input report (missingness per
// side, definition-shift check, share of match distance) merged with the
// leave-one-variable-out ablation once it finishes. This is where the tool
// answers "is one of my matching variables making the linkage WORSE?" —
// quality over quantity.

import type { AblationState, AblationVariable, VariableReportRow } from "@/types";
import {
  ablationFootnote,
  removalSentence,
  verdictChipClasses,
  verdictLabel,
} from "@/lib/variable-text";

interface VariableDiagnosticsPanelProps {
  variables: VariableReportRow[];
  ablation: AblationState;
  /** flips the link's exclude toggle and returns to the Link step */
  onExcludeFeature: (featureName: string) => void;
  /** starts the (gated) variable check on demand */
  onRunAblation: () => void;
}

function missingCell(pct: number) {
  const cls =
    pct > 50
      ? "text-red-700 font-medium"
      : pct > 20
        ? "text-amber-700 font-medium"
        : "text-gray-600";
  return <span className={cls}>{pct.toFixed(0)}%</span>;
}

function offsetSmdCell(row: VariableReportRow) {
  if (row.offset_smd == null) {
    return <span className="text-gray-400">—</span>;
  }
  const cls =
    row.offset_smd >= 0.5 ? "text-red-700 font-medium" : "text-gray-600";
  return <span className={cls}>{row.offset_smd.toFixed(2)}</span>;
}

function AblationCell({
  variable,
  onExclude,
}: {
  variable: AblationVariable;
  onExclude: (name: string) => void;
}) {
  return (
    <div className="space-y-1">
      <span
        className={`inline-block rounded border px-1.5 py-0.5 text-[11px] font-medium ${verdictChipClasses(variable.verdict)}`}
        title={removalSentence(variable)}
      >
        {verdictLabel(variable.verdict)}
      </span>
      <div className="text-[11px] text-gray-500">
        {variable.delta_mnn_pct >= 0 ? "+" : ""}
        {variable.delta_mnn_pct.toFixed(1)} pts MNN ·{" "}
        {variable.delta_high_pct >= 0 ? "+" : ""}
        {variable.delta_high_pct.toFixed(1)} pts High
      </div>
      {variable.verdict === "consider_excluding" && (
        <button
          onClick={() => onExclude(variable.feature)}
          className="rounded border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 hover:bg-red-100"
          title="Exclude this variable at the Link step and adjust the run"
        >
          Exclude and adjust →
        </button>
      )}
    </div>
  );
}

export function VariableDiagnosticsPanel({
  variables,
  ablation,
  onExcludeFeature,
  onRunAblation,
}: VariableDiagnosticsPanelProps) {
  if (variables.length === 0) return null;

  const ablationByFeature = new Map<string, AblationVariable>(
    ablation.status === "done"
      ? ablation.report.variables.map((v) => [v.feature, v])
      : []
  );
  const flagged =
    ablation.status === "done"
      ? ablation.report.variables.filter(
          (v) => v.verdict === "consider_excluding"
        )
      : [];

  return (
    <div className="rounded-lg border border-gray-200 bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            Variable check
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">
            More variables are not always better: one with heavy missingness
            or a different definition in the two files can make every match
            worse. This table checks each matching variable.
          </p>
        </div>
        {ablation.status === "gated" && (
          <button
            onClick={onRunAblation}
            className="shrink-0 rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100"
          >
            Run variable check
          </button>
        )}
      </div>

      {flagged.length > 0 && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          Linkage quality improves without{" "}
          <strong>{flagged.map((v) => v.feature).join(", ")}</strong> — the
          matching would likely be more accurate if excluded.
        </div>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="py-1.5 pr-3 font-medium">Variable</th>
              <th
                className="py-1.5 pr-3 font-medium"
                title="Missing cells in the target / supplemental file. Missing values never match — each charges a fixed distance penalty instead."
              >
                Missing (t / s)
              </th>
              <th
                className="py-1.5 pr-3 font-medium"
                title="How far the two files' means sit apart, in pooled standard deviations, before matching. High values suggest the column is defined or coded differently in the two files (e.g. poverty at 100% vs 180% of the poverty line)."
              >
                Offset SMD
              </th>
              <th
                className="py-1.5 pr-3 font-medium"
                title="Share of the run's total match distance driven by this variable."
              >
                Distance share
              </th>
              <th
                className="py-1.5 pr-3 font-medium"
                title="What happens to run quality when matching is re-run WITHOUT this variable."
              >
                Effect of removal
              </th>
              <th className="py-1.5 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {variables.map((row) => {
              const abl = ablationByFeature.get(row.feature);
              return (
                <tr key={row.feature} className="border-b border-gray-100 align-top">
                  <td className="py-2 pr-3 font-medium text-gray-800">
                    {row.feature}
                  </td>
                  <td className="py-2 pr-3">
                    {missingCell(row.target_missing_pct)}
                    <span className="text-gray-400"> / </span>
                    {missingCell(row.supp_missing_pct)}
                  </td>
                  <td className="py-2 pr-3">{offsetSmdCell(row)}</td>
                  <td className="py-2 pr-3 text-gray-600">
                    {(row.distance_share * 100).toFixed(1)}%
                  </td>
                  <td className="py-2 pr-3">
                    {abl ? (
                      <AblationCell variable={abl} onExclude={onExcludeFeature} />
                    ) : ablation.status === "running" ? (
                      <span className="text-gray-400">
                        checking… {Math.round(ablation.progress * 100)}%
                      </span>
                    ) : ablation.status === "error" ? (
                      <span className="text-red-600" title={ablation.message}>
                        check failed
                      </span>
                    ) : ablation.status === "gated" ? (
                      <span className="text-gray-400">on demand ↑</span>
                    ) : ablation.status === "unavailable" ? (
                      <span className="text-gray-400">
                        needs ≥ 2 variables
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="py-2 text-gray-600">
                    {row.notes || <span className="text-gray-400">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {ablation.status === "done" && (
        <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
          {ablationFootnote(ablation.report)}
        </p>
      )}
      {ablation.status === "error" && (
        <p className="mt-2 text-[11px] text-red-600">
          Variable check failed: {ablation.message}
        </p>
      )}
    </div>
  );
}
