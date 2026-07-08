import { useState } from "react";
import type { ColumnLink, ParsedDataset, PIIWarning } from "@/types";

interface ColumnLinkerProps {
  target: ParsedDataset;
  supplemental: ParsedDataset;
  links: ColumnLink[];
  piiWarnings: PIIWarning[];
  onLinksChange: (links: ColumnLink[]) => void;
}

export function ColumnLinker({
  target,
  supplemental,
  links,
  piiWarnings,
  onLinksChange,
}: ColumnLinkerProps) {
  const [manualTarget, setManualTarget] = useState<string>("");
  const [manualSupplemental, setManualSupplemental] = useState<string>("");

  const linkedTargetIndices = new Set(links.map((l) => l.targetIndex));
  const linkedSupIndices = new Set(links.map((l) => l.supplementalIndex));

  const unmatchedTarget = target.headers
    .map((h, i) => ({ name: h, index: i }))
    .filter((h) => !linkedTargetIndices.has(h.index));

  const unmatchedSupplemental = supplemental.headers
    .map((h, i) => ({ name: h, index: i }))
    .filter((h) => !linkedSupIndices.has(h.index));

  const hasPIIWarnings = piiWarnings.length > 0;

  function getPIIWarning(columnName: string): PIIWarning | undefined {
    return piiWarnings.find((w) => w.columnName === columnName);
  }

  function toggleExclude(index: number) {
    const updated = links.map((l, i) =>
      i === index ? { ...l, excluded: !l.excluded } : l
    );
    onLinksChange(updated);
  }

  function removeLink(index: number) {
    onLinksChange(links.filter((_, i) => i !== index));
  }

  function addManualLink() {
    if (!manualTarget || !manualSupplemental) return;

    const tIdx = parseInt(manualTarget);
    const sIdx = parseInt(manualSupplemental);
    const tName = target.headers[tIdx];

    if (tName === undefined) return;

    onLinksChange([
      ...links,
      {
        headerName: tName,
        targetIndex: tIdx,
        supplementalIndex: sIdx,
        excluded: false,
      },
    ]);
    setManualTarget("");
    setManualSupplemental("");
  }

  const activeCount = links.filter((l) => !l.excluded).length;
  const excludedCount = links.filter((l) => l.excluded).length;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm font-medium text-blue-800">
          Column Linking
        </p>
        <p className="mt-1 text-xs text-blue-700">
          Columns with matching names are auto-linked. Use <strong>Exclude</strong> to
          keep a column linked but skip it during matching (e.g., ID columns you
          want in the output but not used for distance calculation). Use{" "}
          <strong>Unlink</strong> to remove the pairing entirely, making both
          columns available for re-linking.
        </p>
      </div>

      {hasPIIWarnings && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-800">
            Warning: Potential personally identifiable information detected
          </p>
          <ul className="mt-1 space-y-0.5">
            {piiWarnings.map((w) => (
              <li key={`${w.datasetLabel}-${w.columnName}`} className="text-xs text-amber-700">
                <span className="font-medium">{w.columnName}</span>{" "}
                ({w.datasetLabel}) — {w.reason}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-600">
            Consider excluding these columns from matching.
          </p>
        </div>
      )}

      <div className="rounded-lg border border-gray-200">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-2">
          <div className="grid grid-cols-12 text-xs font-medium uppercase tracking-wider text-gray-500">
            <div className="col-span-4">Target Column</div>
            <div className="col-span-4">Supplemental Column</div>
            <div className="col-span-2 text-center">Status</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
        </div>

        <div className="divide-y divide-gray-100">
          {links.map((link, idx) => {
            const warning = getPIIWarning(link.headerName);
            return (
              <div
                key={`${link.targetIndex}-${link.supplementalIndex}`}
                className={`grid grid-cols-12 items-center px-4 py-2 ${
                  link.excluded ? "bg-gray-50 opacity-60" : ""
                }`}
              >
                <div className="col-span-4 flex items-center gap-2">
                  <span className="text-sm text-gray-900">
                    {link.headerName}
                  </span>
                  {warning && (
                    <span
                      className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700"
                      title={warning.reason}
                    >
                      PII
                    </span>
                  )}
                </div>
                <div className="col-span-4 text-sm text-gray-600">
                  {supplemental.headers[link.supplementalIndex]}
                </div>
                <div className="col-span-2 text-center">
                  {link.excluded ? (
                    <span className="text-xs text-amber-500">Excluded</span>
                  ) : (
                    <span className="text-xs text-green-600">Active</span>
                  )}
                </div>
                <div className="col-span-2 flex justify-end gap-2">
                  <button
                    onClick={() => toggleExclude(idx)}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    {link.excluded ? "Include" : "Exclude"}
                  </button>
                  <button
                    onClick={() => removeLink(idx)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Unlink
                  </button>
                </div>
              </div>
            );
          })}

          {links.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-gray-400">
              No columns linked yet. Common column names will be auto-detected.
            </div>
          )}
        </div>
      </div>

      {unmatchedTarget.length > 0 && unmatchedSupplemental.length > 0 && (
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="mb-3 text-sm font-medium text-gray-700">
            Manual Column Linking
          </p>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-gray-500">
                Target Column
              </label>
              <select
                value={manualTarget}
                onChange={(e) => setManualTarget(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Select...</option>
                {unmatchedTarget.map((h) => (
                  <option key={h.index} value={h.index}>
                    {h.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs text-gray-500">
                Supplemental Column
              </label>
              <select
                value={manualSupplemental}
                onChange={(e) => setManualSupplemental(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Select...</option>
                {unmatchedSupplemental.map((h) => (
                  <option key={h.index} value={h.index}>
                    {h.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={addManualLink}
              disabled={!manualTarget || !manualSupplemental}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Link
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-4 text-xs text-gray-500">
        <span>{activeCount} columns linked</span>
        {excludedCount > 0 && <span>{excludedCount} excluded</span>}
        {piiWarnings.length > 0 && (
          <span className="text-amber-600">
            {piiWarnings.length} PII warnings
          </span>
        )}
      </div>
    </div>
  );
}