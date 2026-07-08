// Native HTML/SVG rendering of one explanatory scenario (replaces the
// embedded PDF pipeline output on the About page). Data comes from
// src/data/scenarios.json, exported by matcher/explanatory/export_json.py
// from the same code that builds the PDFs — the numbers are the matcher's
// real outputs, not illustrations.

import { Fragment } from "react";

interface ColumnSpec {
  real: string;
  silly: string;
  display: string;
  unit: string;
  fmt: string;
}

interface SuppRow {
  rank: number;
  raw: number[];
  dist: number;
  is_best: boolean;
}

interface WorkedExample {
  rank: number;
  raw: number[];
  raw_means: number[];
  raw_stds: number[];
  z_target: number[];
  z_example: number[];
  sq_diffs: number[];
  distance: number;
}

export interface ScenarioData {
  scenario_title: string;
  scenario_subtitle: string;
  scenario_label: string;
  description: string;
  rounding_note?: string;
  columns: ColumnSpec[];
  display_names: string[];
  target_raw: number[];
  supp_table: SuppRow[];
  example: WorkedExample;
  signals: {
    contributions: number[];
    euc_distance: number;
    nndr: number;
    near_miss_count: number;
    mnn_confirmed: boolean;
    repeats: number;
    smd: number[];
    flags: string;
  };
  signal_explanations: Record<string, string>;
  nndr_threshold: number;
}

/** Renders **bold** markers produced by the JSON exporter. */
function RichText({ text }: { text: string }) {
  const parts = text.split("**");
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-semibold text-gray-900">
            {p}
          </strong>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        )
      )}
    </>
  );
}

function fmtValue(v: number, col: ColumnSpec): string {
  if (col.fmt === "d") return Math.round(v).toLocaleString("en-US");
  return v.toFixed(1);
}

/** Horizontal distance strip: every supplemental row as a dot on a distance
 * axis, best match highlighted, near-miss cutoff marked. */
function DistanceStrip({
  rows,
  threshold,
}: {
  rows: SuppRow[];
  threshold: number;
}) {
  const W = 640;
  const H = 84;
  const padL = 14;
  const padR = 14;
  const axisY = 46;

  const dists = rows.map((r) => r.dist);
  const d1 = Math.min(...dists);
  const dMaxData = Math.max(...dists);
  const cutoff = threshold > 0 ? d1 / threshold : dMaxData;
  const dMax = Math.max(dMaxData, cutoff) * 1.04 || 1;
  const x = (d: number) => padL + (d / dMax) * (W - padL - padR);

  const nearMiss = (d: number) => d > d1 * 0.999999 && d1 / d >= threshold;
  const cutoffVisible = cutoff < dMaxData;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Distances from the target to every supplemental row"
    >
      {/* axis */}
      <line x1={padL} x2={W - padR} y1={axisY} y2={axisY} stroke="#e2e8f0" strokeWidth={2} />
      <text x={padL} y={axisY + 16} fontSize={9} fill="#64748b">
        0 = identical
      </text>
      <text x={W - padR} y={axisY + 16} fontSize={9} fill="#64748b" textAnchor="end">
        distance →
      </text>

      {/* near-miss zone + cutoff */}
      {d1 > 0 && (
        <>
          <rect
            x={x(d1)}
            y={axisY - 13}
            width={Math.max(x(cutoff) - x(d1), 0)}
            height={26}
            fill="#fef3c7"
            opacity={0.8}
          />
          <line
            x1={x(cutoff)}
            x2={x(cutoff)}
            y1={axisY - 20}
            y2={axisY + 13}
            stroke="#f43f5e"
            strokeWidth={1.5}
            strokeDasharray="4,3"
          />
          <text
            x={cutoffVisible ? x(cutoff) + 4 : x(cutoff) - 4}
            y={axisY - 22}
            fontSize={9}
            fill="#be123c"
            fontWeight={600}
            textAnchor={cutoffVisible ? "start" : "end"}
          >
            near-miss cutoff
          </text>
        </>
      )}

      {/* dots */}
      {rows.map((r) => {
        const isBest = r.is_best;
        const isNear = !isBest && nearMiss(r.dist);
        return (
          <circle
            key={r.rank}
            cx={x(r.dist)}
            cy={axisY}
            r={isBest ? 7 : isNear ? 5 : 3.5}
            fill={isBest ? "#2563eb" : isNear ? "#f59e0b" : "#94a3b8"}
            opacity={isBest ? 1 : 0.85}
          >
            <title>{`Rank ${r.rank}: distance ${r.dist.toFixed(4)}`}</title>
          </circle>
        );
      })}

      {/* best label — one line above the cutoff label so they never collide
          (the cutoff always sits just right of the best match) */}
      <text
        x={Math.min(x(d1), W - 150)}
        y={12}
        fontSize={10}
        fill="#1d4ed8"
        fontWeight={600}
      >
        best match ({d1.toFixed(4)})
      </text>
    </svg>
  );
}

function SignalChip({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  good: boolean | null; // null = neutral
}) {
  const tone =
    good === null
      ? "border-gray-200 bg-gray-50 text-gray-700"
      : good
        ? "border-green-200 bg-green-50 text-green-800"
        : "border-amber-300 bg-amber-50 text-amber-900";
  return (
    <div className={`rounded border px-2.5 py-1.5 ${tone}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}

const SIGNAL_ORDER: Array<{ key: string; label: string }> = [
  { key: "euc_distance", label: "Distance" },
  { key: "nndr", label: "NNDR" },
  { key: "near_miss_count", label: "Near misses" },
  { key: "mnn_confirmed", label: "MNN" },
  { key: "repeats", label: "Ties" },
  { key: "per_feature_contribution", label: "Feature contributions" },
  { key: "smd", label: "SMD" },
  { key: "flags", label: "Flags" },
];

export function ScenarioExplainer({
  scenario,
  index,
}: {
  scenario: ScenarioData;
  index: number;
}) {
  const s = scenario.signals;
  const cols = scenario.columns;
  const top = scenario.supp_table.slice(0, 5);
  const rest = scenario.supp_table.slice(5);
  const ex = scenario.example;

  return (
    <article className="rounded-lg border border-gray-200 bg-white p-5">
      <p className="text-xs uppercase tracking-wider text-blue-600">
        Scenario {index + 1}
      </p>
      <h3 className="text-base font-semibold text-gray-900">
        {scenario.scenario_title.replace(/^Scenario \d+:\s*/, "")}
      </h3>
      <p className="mt-0.5 text-xs text-gray-500">{scenario.scenario_subtitle}</p>
      <p className="mt-2 text-sm text-gray-700">
        <RichText text={scenario.description} />
      </p>
      {scenario.rounding_note && (
        <p className="mt-2 text-xs text-gray-500">
          <RichText text={scenario.rounding_note} />
        </p>
      )}

      {/* Signal outcome chips */}
      <div className="mt-4 flex flex-wrap gap-2">
        <SignalChip
          label="Distance"
          value={s.euc_distance.toFixed(4)}
          good={null}
        />
        <SignalChip
          label="NNDR"
          value={s.nndr.toFixed(2)}
          good={s.nndr < scenario.nndr_threshold}
        />
        <SignalChip
          label="Near misses"
          value={String(s.near_miss_count)}
          good={s.near_miss_count === 0}
        />
        <SignalChip
          label="MNN"
          value={s.mnn_confirmed ? "confirmed" : "not confirmed"}
          good={s.mnn_confirmed}
        />
        <SignalChip label="Ties" value={String(s.repeats)} good={s.repeats <= 1} />
        <SignalChip
          label="Flags"
          value={s.flags ? `${s.flags.split(" | ").length}` : "none"}
          good={!s.flags}
        />
      </div>
      {s.flags && (
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          {s.flags.split(" | ").map((f, i) => (
            <div key={i}>• {f}</div>
          ))}
        </div>
      )}

      {/* Distance strip */}
      <div className="mt-4 rounded border border-gray-200 p-2">
        <p className="mb-1 px-1 text-[11px] text-gray-500">
          Every supplemental row, placed by its distance to the target. Blue =
          chosen match; amber = near-miss competitors inside the cutoff.
        </p>
        <DistanceStrip rows={scenario.supp_table} threshold={scenario.nndr_threshold} />
      </div>

      {/* Contributions */}
      <div className="mt-4">
        <p className="mb-1 text-[11px] font-medium text-gray-600">
          Which features drive the remaining distance (share of squared distance)
        </p>
        <div className="space-y-1">
          {scenario.display_names.map((name, i) => {
            const c = s.contributions[i] ?? 0;
            return (
              <div key={name} className="flex items-center gap-2 text-xs">
                <span className="w-44 truncate text-gray-700">{name}</span>
                <div className="relative h-4 flex-1 overflow-hidden rounded bg-gray-100">
                  <div className="h-full bg-blue-500" style={{ width: `${c * 100}%` }} />
                  <span className="absolute inset-0 flex items-center px-2 font-mono text-[10px] text-gray-700">
                    {s.euc_distance === 0 ? "n/a — distance is 0" : `${(c * 100).toFixed(1)}%`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Closest rows table */}
      <details className="mt-4">
        <summary className="cursor-pointer text-xs font-medium text-gray-700">
          The numbers: target vs. the closest supplemental rows
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-2 py-1">Row</th>
                {cols.map((c) => (
                  <th key={c.display} className="px-2 py-1">
                    {c.display}
                  </th>
                ))}
                <th className="px-2 py-1">Distance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <tr className="bg-blue-50/60 font-medium">
                <td className="px-2 py-1 text-blue-900">Target</td>
                {scenario.target_raw.map((v, i) => (
                  <td key={i} className="px-2 py-1 font-mono text-blue-900">
                    {fmtValue(v, cols[i]!)}
                  </td>
                ))}
                <td className="px-2 py-1 text-blue-900">—</td>
              </tr>
              {top.map((r) => (
                <tr key={r.rank} className={r.is_best ? "bg-green-50/60" : undefined}>
                  <td className="px-2 py-1 text-gray-600">
                    #{r.rank}
                    {r.is_best ? " ✓ match" : ""}
                  </td>
                  {r.raw.map((v, i) => (
                    <td key={i} className="px-2 py-1 font-mono text-gray-700">
                      {fmtValue(v, cols[i]!)}
                    </td>
                  ))}
                  <td className="px-2 py-1 font-mono text-gray-700">{r.dist.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rest.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer px-2 text-[11px] text-gray-500">
                Show the remaining {rest.length} rows
              </summary>
              <table className="min-w-full text-xs">
                <tbody className="divide-y divide-gray-100">
                  {rest.map((r) => (
                    <tr key={r.rank}>
                      <td className="px-2 py-1 text-gray-600">#{r.rank}</td>
                      {r.raw.map((v, i) => (
                        <td key={i} className="px-2 py-1 font-mono text-gray-700">
                          {fmtValue(v, cols[i]!)}
                        </td>
                      ))}
                      <td className="px-2 py-1 font-mono text-gray-700">{r.dist.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      </details>

      {/* Worked distance computation */}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium text-gray-700">
          Worked example: how a distance is computed (rank-{ex.rank} row)
        </summary>
        <div className="mt-2 space-y-2 text-xs text-gray-700">
          <p>
            Each column is z-scored using the combined mean and standard
            deviation of both datasets, the differences are squared and
            summed, and the square root is the distance:
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 text-left text-gray-500">
                <tr>
                  <th className="px-2 py-1">Feature</th>
                  <th className="px-2 py-1">Target (z)</th>
                  <th className="px-2 py-1">Row (z)</th>
                  <th className="px-2 py-1">(Δz)²</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {scenario.display_names.map((name, i) => (
                  <tr key={name}>
                    <td className="px-2 py-1">{name}</td>
                    <td className="px-2 py-1 font-mono">{ex.z_target[i]!.toFixed(3)}</td>
                    <td className="px-2 py-1 font-mono">{ex.z_example[i]!.toFixed(3)}</td>
                    <td className="px-2 py-1 font-mono">{ex.sq_diffs[i]!.toFixed(4)}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 font-medium">
                  <td className="px-2 py-1" colSpan={3}>
                    √(sum) = distance
                  </td>
                  <td className="px-2 py-1 font-mono">{ex.distance.toFixed(4)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </details>

      {/* Per-signal narrative */}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium text-gray-700">
          What each signal says here
        </summary>
        <dl className="mt-2 space-y-2 text-xs text-gray-700">
          {SIGNAL_ORDER.filter((o) => scenario.signal_explanations[o.key]).map((o) => (
            <div key={o.key}>
              <dt className="font-semibold text-gray-900">{o.label}</dt>
              <dd className="mt-0.5">
                <RichText text={scenario.signal_explanations[o.key]!} />
              </dd>
            </div>
          ))}
        </dl>
      </details>

      {/* Original PDFs, for print/citation */}
      <p className="mt-3 text-[11px] text-gray-400">
        Printable version:{" "}
        <a
          className="text-blue-500 hover:text-blue-700"
          href={`${import.meta.env.BASE_URL}explanatory/${scenario.scenario_label}.pdf`}
        >
          scatter PDF
        </a>{" "}
        ·{" "}
        <a
          className="text-blue-500 hover:text-blue-700"
          href={`${import.meta.env.BASE_URL}explanatory/${scenario.scenario_label}_hist.pdf`}
        >
          histogram PDF
        </a>
      </p>
    </article>
  );
}
