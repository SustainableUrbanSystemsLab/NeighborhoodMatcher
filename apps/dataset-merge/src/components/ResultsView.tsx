import { Fragment, useMemo, useState } from "react";
import { buildResultsZip, triggerDownload } from "@/lib/zip-builder";
import type {
  MatchOutput,
  ParsedDataset,
  PerTargetDetail,
} from "@/types";

const SMD_WARN = 0.10;
const SMD_POOR = 0.25;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 10;

interface ResultsViewProps {
  output: MatchOutput;
  target: ParsedDataset;
  supplemental: ParsedDataset;
  onStartOver: () => void;
}

type SortKey = "target_idx" | "best_distance" | "nndr" | "near_miss" | "flags";

export function ResultsView({
  output,
  target,
  supplemental,
  onStartOver,
}: ResultsViewProps) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("target_idx");
  const [sortDesc, setSortDesc] = useState<boolean>(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function handleDownload() {
    setDownloading(true);
    setDownloadError(null);
    try {
      const blob = await buildResultsZip(output, target, supplemental);
      triggerDownload(blob, "matcher_results.zip");
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  }

  const { summary, smd, feature_names, per_target } = output;

  const flaggedPct = summary.total
    ? (summary.flagged / summary.total) * 100
    : 0;
  const mnnPct = summary.total
    ? (summary.mnn_confirmed / summary.total) * 100
    : 0;

  const sortedTargets = useMemo(() => {
    const arr = [...per_target];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "target_idx":
          cmp = a.target_idx - b.target_idx;
          break;
        case "best_distance":
          cmp = a.best_distance - b.best_distance;
          break;
        case "nndr":
          cmp = a.nndr - b.nndr;
          break;
        case "near_miss":
          cmp = a.near_miss - b.near_miss;
          break;
        case "flags":
          cmp = (a.flags ? 1 : 0) - (b.flags ? 1 : 0);
          break;
      }
      return sortDesc ? -cmp : cmp;
    });
    return arr;
  }, [per_target, sortKey, sortDesc]);

  const pageRows = sortedTargets.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.max(1, Math.ceil(sortedTargets.length / pageSize));

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDesc((v) => !v);
    } else {
      setSortKey(key);
      setSortDesc(false);
    }
    setPage(0);
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryCard label="Rows matched" value={summary.total.toString()} tone="blue" />
        <SummaryCard
          label="Flagged"
          value={`${summary.flagged} (${flaggedPct.toFixed(1)}%)`}
          tone={flaggedPct > 20 ? "red" : flaggedPct > 5 ? "amber" : "green"}
        />
        <SummaryCard
          label="MNN confirmed"
          value={`${summary.mnn_confirmed} (${mnnPct.toFixed(1)}%)`}
          tone={mnnPct > 80 ? "green" : mnnPct > 50 ? "amber" : "red"}
        />
        <SummaryCard
          label="Mean NNDR"
          value={summary.mean_nndr.toFixed(3)}
          tone={summary.mean_nndr > summary.threshold ? "amber" : "gray"}
        />
        <SummaryCard
          label="Mean distance"
          value={summary.mean_best_distance.toFixed(3)}
          tone="gray"
        />
      </div>

      {/* SMD bar chart */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-gray-900">
            Standardized Mean Difference per feature
          </h3>
          <span className="text-xs text-gray-500">
            Green &lt; {SMD_WARN} · Amber &lt; {SMD_POOR} · Red ≥ {SMD_POOR}
          </span>
        </div>
        <div className="space-y-1">
          {feature_names.map((name, i) => (
            <SmdRow key={name} name={name} value={smd[i] ?? 0} />
          ))}
        </div>
        <p className="mt-3 text-xs text-gray-500">
          |SMD| &gt; 0.10 indicates feature imbalance; &gt; 0.25 is poor (Austin,
          PMC3472075).
        </p>
      </div>

      {/* Per-row drill-down */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
          <h3 className="text-sm font-semibold text-gray-900">
            Per-row diagnostics
          </h3>
          <span className="text-xs text-gray-500">
            Click a row to drill down
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <SortableHead
                  label="Target #"
                  active={sortKey === "target_idx"}
                  desc={sortDesc}
                  onClick={() => toggleSort("target_idx")}
                />
                <SortableHead
                  label="Distance"
                  active={sortKey === "best_distance"}
                  desc={sortDesc}
                  onClick={() => toggleSort("best_distance")}
                />
                <SortableHead
                  label="NNDR"
                  active={sortKey === "nndr"}
                  desc={sortDesc}
                  onClick={() => toggleSort("nndr")}
                />
                <SortableHead
                  label="Near-miss"
                  active={sortKey === "near_miss"}
                  desc={sortDesc}
                  onClick={() => toggleSort("near_miss")}
                />
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  MNN
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Repeats
                </th>
                <SortableHead
                  label="Flags"
                  active={sortKey === "flags"}
                  desc={sortDesc}
                  onClick={() => toggleSort("flags")}
                />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageRows.map((row) => {
                const isSelected = selectedIdx === row.target_idx;
                return (
                  <Fragment key={row.target_idx}>
                    <tr
                      onClick={() =>
                        setSelectedIdx(isSelected ? null : row.target_idx)
                      }
                      className={`cursor-pointer ${
                        isSelected
                          ? "bg-blue-50"
                          : row.flags
                            ? "bg-amber-50/50 hover:bg-amber-50"
                            : "hover:bg-gray-50"
                      }`}
                    >
                      <td className="px-3 py-1.5 font-mono text-xs text-gray-700">
                        <span className="mr-1 inline-block w-3 text-gray-400">
                          {isSelected ? "▾" : "▸"}
                        </span>
                        {row.target_idx}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs text-gray-700">
                        {row.best_distance.toFixed(4)}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs text-gray-700">
                        {row.nndr.toFixed(3)}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs text-gray-700">
                        {row.near_miss}
                      </td>
                      <td className="px-3 py-1.5 text-xs">
                        {row.mnn_confirmed ? (
                          <span className="text-green-700">✓</span>
                        ) : (
                          <span className="text-red-700">✗</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs text-gray-700">
                        {row.repeats}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-amber-800">
                        {row.flags ? (
                          <span title={row.flags}>
                            {row.flags.split(" | ").length} flag
                            {row.flags.split(" | ").length > 1 ? "s" : ""}
                          </span>
                        ) : (
                          <span className="text-green-700">ok</span>
                        )}
                      </td>
                    </tr>
                    {isSelected && (
                      <tr className="bg-blue-50/40">
                        <td colSpan={7} className="px-3 py-3">
                          <DrilldownPanel
                            detail={row}
                            features={feature_names}
                            target={target}
                            supplemental={supplemental}
                            output={output}
                            onClose={() => setSelectedIdx(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-600">
          <div className="flex items-center gap-3">
            <span>
              Showing {sortedTargets.length === 0 ? 0 : page * pageSize + 1}–
              {Math.min((page + 1) * pageSize, sortedTargets.length)} of{" "}
              {sortedTargets.length}
            </span>
            <label className="flex items-center gap-1">
              <span>Rows per page</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(0);
                }}
                className="rounded border border-gray-300 bg-white px-1 py-0.5 text-xs"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded border border-gray-300 bg-white px-2 py-1 disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="self-center">
              Page {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="rounded border border-gray-300 bg-white px-2 py-1 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          onClick={onStartOver}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Start Over
        </button>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {downloading ? "Packaging…" : "Download results (.zip)"}
          </button>
          {downloadError && (
            <span className="text-xs text-red-600">{downloadError}</span>
          )}
          <span className="text-[11px] text-gray-400">
            Linked CSV, match detail, data + match stats, SMD, agreement,
            contact, and original uploads.
          </span>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "blue" | "green" | "amber" | "red" | "gray";
}) {
  const bg = {
    blue: "bg-blue-50 text-blue-900",
    green: "bg-green-50 text-green-900",
    amber: "bg-amber-50 text-amber-900",
    red: "bg-red-50 text-red-900",
    gray: "bg-gray-50 text-gray-900",
  }[tone];
  const sub = {
    blue: "text-blue-600",
    green: "text-green-700",
    amber: "text-amber-700",
    red: "text-red-700",
    gray: "text-gray-600",
  }[tone];
  return (
    <div className={`rounded-lg p-3 ${bg}`}>
      <p className={`text-xs ${sub}`}>{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}

function SortableHead({
  label,
  active,
  desc,
  onClick,
}: {
  label: string;
  active: boolean;
  desc: boolean;
  onClick: () => void;
}) {
  return (
    <th
      onClick={onClick}
      className="cursor-pointer px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 hover:text-gray-800"
    >
      {label}
      {active && <span className="ml-1">{desc ? "▼" : "▲"}</span>}
    </th>
  );
}

function SmdRow({ name, value }: { name: string; value: number }) {
  const abs = Math.abs(value);
  const pct = Math.min(100, (abs / 0.5) * 100);
  const color =
    abs >= SMD_POOR ? "bg-red-500" : abs >= SMD_WARN ? "bg-amber-500" : "bg-green-500";
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-40 truncate text-gray-700" title={name}>
        {name}
      </span>
      <div className="relative h-4 flex-1 overflow-hidden rounded bg-gray-100">
        <div
          className={`h-full ${color}`}
          style={{ width: `${pct}%` }}
        />
        <span className="absolute inset-0 flex items-center px-2 font-mono text-[10px] text-gray-700">
          {value.toFixed(3)}
        </span>
      </div>
    </div>
  );
}

function RankPlot({
  distances,
  threshold,
}: {
  distances: number[];
  threshold: number;
}) {
  if (distances.length < 2) {
    return (
      <p className="text-[11px] text-gray-400">
        Not enough neighbors to plot.
      </p>
    );
  }

  const W = 300;
  const H = 120;
  const padL = 28;
  const padR = 8;
  const padT = 6;
  const padB = 18;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const n = distances.length;
  const dMin = distances[0]!;
  const naturalMax = distances[n - 1]!;
  // Cutoff distance below which a supplemental counts as a near-miss competitor.
  // Extend the y-range so the cutoff line is always visible — if it sits above
  // every dot, that itself signals "all top-K are near-misses."
  const cutoff = threshold > 0 ? dMin / threshold : naturalMax;
  const dMax = Math.max(naturalMax, cutoff);
  const dRange = Math.max(dMax - dMin, 1e-9);

  const x = (i: number) =>
    padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (d: number) => padT + (1 - (d - dMin) / dRange) * plotH;

  const linePath = distances
    .map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(d).toFixed(2)}`)
    .join(" ");

  const best = distances[0]!;
  const yBest = y(best);

  // Show up to ~5 y-axis ticks (min, 25%, 50%, 75%, max).
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => dMin + t * dRange);

  return (
    <div className="rounded border border-gray-200 bg-white p-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Rank plot of top closest supplementals"
      >
        {/* Y-axis gridlines + labels */}
        {ticks.map((t, i) => {
          const yv = y(t);
          return (
            <g key={i}>
              <line
                x1={padL}
                x2={W - padR}
                y1={yv}
                y2={yv}
                stroke="#f1f5f9"
                strokeWidth={1}
              />
              <text
                x={padL - 3}
                y={yv + 3}
                fontSize={8}
                textAnchor="end"
                fill="#64748b"
                fontFamily="ui-monospace, monospace"
              >
                {t.toFixed(3)}
              </text>
            </g>
          );
        })}

        {/* Near-miss cutoff line (best_distance / threshold) */}
        <line
          x1={padL}
          x2={W - padR}
          y1={y(cutoff)}
          y2={y(cutoff)}
          stroke="#f43f5e"
          strokeWidth={1}
          strokeDasharray="4,3"
        />
        <text
          x={W - padR}
          y={y(cutoff) - 2}
          fontSize={8}
          textAnchor="end"
          fill="#be123c"
          fontWeight={600}
        >
          near-miss cutoff (NNDR={threshold.toFixed(2)})
        </text>

        {/* Connecting curve */}
        <path d={linePath} fill="none" stroke="#94a3b8" strokeWidth={1} />

        {/* Dots */}
        {distances.map((d, i) => {
          const cx = x(i);
          const cy = y(d);
          const isBest = i === 0;
          const isSecond = i === 1;
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={isBest ? 4 : isSecond ? 3 : 1.6}
              fill={isBest ? "#2563eb" : isSecond ? "#f59e0b" : "#64748b"}
            >
              <title>{`Rank ${i + 1}: ${d.toFixed(4)}`}</title>
            </circle>
          );
        })}

        {/* Best-match label */}
        <text
          x={x(0) + 6}
          y={yBest + 3}
          fontSize={8}
          fill="#1d4ed8"
          fontWeight={600}
        >
          best {best.toFixed(3)}
        </text>

        {/* X-axis labels */}
        <text
          x={padL}
          y={H - 4}
          fontSize={8}
          fill="#64748b"
          textAnchor="start"
        >
          rank 1
        </text>
        <text
          x={W - padR}
          y={H - 4}
          fontSize={8}
          fill="#64748b"
          textAnchor="end"
        >
          rank {n}
        </text>
      </svg>
    </div>
  );
}

function DrilldownPanel({
  detail,
  features,
  target,
  supplemental,
  output,
  onClose,
}: {
  detail: PerTargetDetail;
  features: string[];
  target: ParsedDataset;
  supplemental: ParsedDataset;
  output: MatchOutput;
  onClose: () => void;
}) {
  const maxCount = Math.max(1, ...detail.hist_counts);
  const maxContrib = Math.max(...detail.contributions, 0.001);

  // Feature values: pair the raw target vs. supplemental cells for the linked columns.
  // To find raw cells, use feature_names as target headers (since linked headers are
  // target-named via web_api).
  const featurePairs = features.map((f) => {
    const tIdx = target.headers.indexOf(f);
    // The supplemental header for this feature is harder to recover without the
    // original links. Show the target header and value only.
    return {
      name: f,
      targetVal: tIdx >= 0 ? target.rows[detail.target_idx]?.[tIdx] ?? "" : "",
    };
  });

  const flagList = detail.flags ? detail.flags.split(" | ") : [];

  return (
    <div className="rounded-lg border-2 border-blue-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            Target row {detail.target_idx} ↔ Supplemental row {detail.match_idx}
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Distance {detail.best_distance.toFixed(4)} · NNDR{" "}
            {detail.nndr.toFixed(3)} · MNN{" "}
            {detail.mnn_confirmed ? "✓ confirmed" : "✗ not confirmed"} ·{" "}
            repeats {detail.repeats} · near-miss {detail.near_miss}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-xs text-gray-500 hover:text-gray-800"
        >
          Close
        </button>
      </div>

      {flagList.length > 0 && (
        <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-2">
          <p className="mb-1 text-xs font-semibold text-amber-800">Flags</p>
          <ul className="list-disc pl-4 text-xs text-amber-800">
            {flagList.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h4 className="mb-1 text-xs font-semibold text-gray-700">
            Feature contributions to distance
          </h4>
          <p className="mb-2 text-[11px] text-gray-500">
            Proportion each feature contributes to the squared distance (sum = 1).
          </p>
          <div className="space-y-1">
            {features.map((f, i) => {
              const c = detail.contributions[i] ?? 0;
              const pct = (c / maxContrib) * 100;
              return (
                <div key={f} className="flex items-center gap-2 text-xs">
                  <span className="w-32 truncate text-gray-700" title={f}>
                    {f}
                  </span>
                  <div className="relative h-4 flex-1 overflow-hidden rounded bg-gray-100">
                    <div
                      className="h-full bg-blue-500"
                      style={{ width: `${pct}%` }}
                    />
                    <span className="absolute inset-0 flex items-center px-2 font-mono text-[10px] text-gray-700">
                      {(c * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <h4 className="mb-1 text-xs font-semibold text-gray-700">
            Match uniqueness — {detail.top_k_distances.length} closest
            supplementals
          </h4>
          <p className="mb-2 text-[11px] text-gray-500">
            Rank 1 is the matched row. A steep rise from rank 1 to rank 2 means
            the match is unique; a flat curve means many near-equivalents.
          </p>
          <RankPlot
            distances={detail.top_k_distances}
            threshold={output.threshold}
          />

          <h4 className="mt-3 mb-1 text-xs font-semibold text-gray-700">
            Full population (context)
          </h4>
          <p className="mb-1 text-[11px] text-gray-500">
            Distribution across all supplemental rows. Best match in blue.
          </p>
          <div className="flex h-14 items-end gap-[1px] rounded bg-gray-50 p-1">
            {detail.hist_counts.map((count, i) => {
              const h = (count / maxCount) * 100;
              return (
                <div
                  key={i}
                  className={`flex-1 ${i === 0 ? "bg-blue-600" : "bg-gray-400"}`}
                  style={{ height: `${h}%`, minHeight: count > 0 ? "1px" : 0 }}
                  title={`${count} rows in [${detail.hist_edges[i]?.toFixed(3)}, ${detail.hist_edges[i + 1]?.toFixed(3)}]`}
                />
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-gray-500">
            <span>min {detail.hist_edges[0]?.toFixed(3) ?? "-"}</span>
            <span>
              max{" "}
              {detail.hist_edges[detail.hist_edges.length - 1]?.toFixed(3) ??
                "-"}
            </span>
          </div>
        </div>
      </div>

      {/* Raw linked values */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-gray-700">
          Raw values for linked features
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-2 py-1">Feature</th>
                <th className="px-2 py-1">Target</th>
                <th className="px-2 py-1">Matched (from linked output)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {featurePairs.map((p, i) => {
                const linkedIdx = output.linked_headers.indexOf(p.name);
                const matched =
                  linkedIdx >= 0
                    ? output.linked_rows[detail.target_idx]?.[linkedIdx] ?? ""
                    : "";
                return (
                  <tr key={i}>
                    <td className="px-2 py-1 text-gray-700">{p.name}</td>
                    <td className="px-2 py-1 font-mono text-gray-900">
                      {p.targetVal}
                    </td>
                    <td className="px-2 py-1 font-mono text-gray-900">
                      {matched}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-1 text-[10px] text-gray-400">
            Supplemental file: {supplemental.fileName}
          </p>
        </div>
      </details>
    </div>
  );
}
