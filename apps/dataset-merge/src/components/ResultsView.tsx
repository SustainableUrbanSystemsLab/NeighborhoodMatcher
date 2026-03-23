import { useMemo } from "react";
import { downloadCSV } from "@/lib/csv";
import type { MatchFlag, MatchOutput } from "@/types";

interface ResultsViewProps {
  output: MatchOutput;
  onStartOver: () => void;
}

function rowBg(flag: MatchFlag): string {
  if (flag === "Extreme Warning") return "bg-red-50";
  if (flag === "Warning") return "bg-amber-50";
  return "";
}

function flagBadge(flag: MatchFlag) {
  if (flag === "Extreme Warning")
    return (
      <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
        Extreme Warning
      </span>
    );
  if (flag === "Warning")
    return (
      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
        Warning
      </span>
    );
  return (
    <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700">
      OK
    </span>
  );
}

export function ResultsView({ output, onStartOver }: ResultsViewProps) {
  const stats = useMemo(() => {
    const distances = output.results.map((r) => r.euclideanDistance);
    const avg = distances.reduce((a, b) => a + b, 0) / distances.length;
    const max = Math.max(...distances);
    const perfectMatches = distances.filter((d) => d === 0).length;
    const warnings = output.results.filter(
      (r) => r.matchFlag === "Warning"
    ).length;
    const extremes = output.results.filter(
      (r) => r.matchFlag === "Extreme Warning"
    ).length;
    return { avg, max, total: distances.length, perfectMatches, warnings, extremes };
  }, [output.results]);

  const flagColIdx = output.headers.indexOf("match_flag");  const distanceColIdx = output.headers.indexOf(
    output.headers.find((h) => h === "euc_distance" || h.startsWith("euc_distance_")) ?? ""
  );
  const metaCols = new Set(
    output.headers
      .map((h, i) => ({
        h,
        i,
      }))
      .filter(
        ({ h }) =>
          h === "euc_distance" ||
          h.startsWith("euc_distance_") ||
          h === "repeats" ||
          h.startsWith("repeats_") ||
          h === "near_repeats" ||
          h.startsWith("near_repeats_") ||
          h === "near_1pct" ||
          h.startsWith("near_1pct_") ||
          h === "near_5pct" ||
          h.startsWith("near_5pct_") ||
          h === "match_quality" ||
          h.startsWith("match_quality_") ||
          h === "match_flag" ||
          h.startsWith("match_flag_") ||
          h === "flag_reasons" ||
          h.startsWith("flag_reasons_")
      )
      .map(({ i }) => i)
  );

  const previewRows = output.mergedRows.slice(0, 50);

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-lg bg-blue-50 p-3">
          <p className="text-xs text-blue-600">Total Rows</p>
          <p className="text-2xl font-bold text-blue-900">{stats.total}</p>
        </div>
        <div className="rounded-lg bg-green-50 p-3">
          <p className="text-xs text-green-600">Perfect Matches</p>
          <p className="text-2xl font-bold text-green-900">{stats.perfectMatches}</p>
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-xs text-gray-600">Avg Distance</p>
          <p className="text-2xl font-bold text-gray-900">{stats.avg.toFixed(3)}</p>
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-xs text-gray-600">Max Distance</p>
          <p className="text-2xl font-bold text-gray-900">{stats.max.toFixed(3)}</p>
        </div>
        <div className="rounded-lg bg-amber-50 p-3">
          <p className="text-xs text-amber-600">Warnings</p>
          <p className="text-2xl font-bold text-amber-900">{stats.warnings}</p>
        </div>
        <div className="rounded-lg bg-red-50 p-3">
          <p className="text-xs text-red-600">Extreme Warnings</p>
          <p className="text-2xl font-bold text-red-900">{stats.extremes}</p>
        </div>
      </div>

      {/* Flag legend */}
      {(stats.warnings > 0 || stats.extremes > 0) && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
          <span className="font-medium">Flag thresholds — match_quality</span>{" "}
          (probability a random pairing has a worse distance, adjusted for column count):{" "}
          <span className="text-amber-700">Warning</span> &lt; 0.20 &nbsp;|&nbsp;{" "}
          <span className="text-red-700">Extreme Warning</span> &lt; 0.05.{" "}
          Near-repeat fraction flags apply independently.
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {output.headers.map((h, i) => (
                <th
                  key={i}
                  className={`whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wider ${
                    metaCols.has(i) ? "bg-blue-50 text-blue-700" : "text-gray-500"
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {previewRows.map((row, ri) => {
              const flag = (output.results[ri]?.matchFlag ?? "OK") as MatchFlag;
              return (
                <tr key={ri} className={rowBg(flag)}>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={`whitespace-nowrap px-3 py-1.5 ${
                        metaCols.has(ci)
                          ? "font-mono text-blue-800"
                          : "text-gray-700"
                      }`}
                    >
                      {ci === flagColIdx ? (
                        flagBadge(cell as MatchFlag)
                      ) : ci === distanceColIdx ? (
                        parseFloat(cell).toFixed(4)
                      ) : (
                        cell
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {output.mergedRows.length > 50 && (
          <div className="border-t border-gray-200 bg-gray-50 px-3 py-2 text-center text-xs text-gray-500">
            Showing 50 of {output.mergedRows.length} rows. Download CSV for
            full results.
          </div>
        )}
      </div>

      <div className="flex justify-between">
        <button
          onClick={onStartOver}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Start Over
        </button>
        <button
          onClick={() =>
            downloadCSV(output.headers, output.mergedRows, "matched_output.csv")
          }
          className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Download CSV
        </button>
      </div>
    </div>
  );
}