// "File format & pre-upload checklist": one pictogram per point, in the same
// illustrative style as the algorithm steps on the How-it-works page
// (AlgorithmSteps.tsx). Shared by the upload step and the About page so the
// two never drift. Purely decorative-explanatory; the text is authoritative.

const RULE = "var(--chart-rule)";
const SLATE = "var(--chart-muted)";
const SLATE_DARK = "var(--chart-muted-strong)";
const BLUE = "var(--chart-best)";
const BLUE_LIGHT = "var(--chart-best-soft)";
const GREEN = "var(--chart-ok)";
const AMBER = "var(--chart-near)";
const RED = "var(--chart-cutoff)";

function Check({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={7} fill={GREEN} />
      <path d={`M${x - 3.2} ${y} l2.3 2.4 l4.2 -5`} fill="none" stroke="#fff" strokeWidth={1.8} />
    </g>
  );
}

function Cross({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={7} fill={RED} />
      <path d={`M${x - 3} ${y - 3} l6 6 M${x + 3} ${y - 3} l-6 6`} fill="none" stroke="#fff" strokeWidth={1.8} />
    </g>
  );
}

function PictoFormat() {
  // One header row, then one row per unit.
  const cols = [10, 48, 86];
  return (
    <svg viewBox="0 0 120 90" className="h-full w-full" aria-hidden="true">
      {cols.map((x) => (
        <rect key={`h${x}`} x={x} y={12} width={26} height={13} rx={3} fill={BLUE_LIGHT} />
      ))}
      {[32, 50, 68].map((y) =>
        cols.map((x) => (
          <rect key={`${x}-${y}`} x={x} y={y} width={26} height={11} rx={3} fill={RULE} />
        ))
      )}
      <text x={116} y={22} fontSize={9} fill={SLATE_DARK} textAnchor="end" fontWeight={600}>
        1
      </text>
    </svg>
  );
}

function PictoNames() {
  // Same names link on their own (solid); different names linked by hand (dashed).
  return (
    <svg viewBox="0 0 120 90" className="h-full w-full" aria-hidden="true">
      <rect x={8} y={22} width={34} height={12} rx={3} fill={BLUE_LIGHT} />
      <rect x={78} y={22} width={34} height={12} rx={3} fill={BLUE_LIGHT} />
      <line x1={42} y1={28} x2={78} y2={28} stroke={BLUE} strokeWidth={2} />
      <rect x={8} y={56} width={34} height={12} rx={3} fill={BLUE_LIGHT} />
      <rect x={78} y={56} width={34} height={12} rx={3} fill={RULE} />
      <line x1={42} y1={62} x2={78} y2={62} stroke={SLATE_DARK} strokeWidth={2} strokeDasharray="4 3" />
      <circle cx={42} cy={28} r={2.5} fill={BLUE} />
      <circle cx={78} cy={28} r={2.5} fill={BLUE} />
      <circle cx={42} cy={62} r={2.5} fill={SLATE_DARK} />
      <circle cx={78} cy={62} r={2.5} fill={SLATE_DARK} />
    </svg>
  );
}

function PictoScale() {
  // Two rulers whose ticks line up: same units, same scale.
  const ticks = [14, 34, 54, 74, 94];
  return (
    <svg viewBox="0 0 120 90" className="h-full w-full" aria-hidden="true">
      {[30, 62].map((y, i) => (
        <g key={y}>
          <line x1={10} y1={y} x2={100} y2={y} stroke={i === 0 ? SLATE : BLUE} strokeWidth={2} />
          {ticks.map((x) => (
            <line key={x} x1={x} y1={y - 6} x2={x} y2={y + 6} stroke={i === 0 ? SLATE : BLUE} strokeWidth={2} />
          ))}
        </g>
      ))}
      <Check x={108} y={46} />
    </svg>
  );
}

function PictoDefinition() {
  // Same shape, quietly shifted: a definition or coding difference.
  return (
    <svg viewBox="0 0 120 90" className="h-full w-full" aria-hidden="true">
      <line x1={8} y1={74} x2={112} y2={74} stroke={SLATE_DARK} strokeWidth={1.5} />
      <path d="M14 72 Q 40 14, 66 72" fill="none" stroke={SLATE} strokeWidth={2} />
      <path d="M50 72 Q 76 14, 102 72" fill="none" stroke={BLUE} strokeWidth={2} />
      <path d="M44 24 L72 24 M67 20 L72 24 L67 28" fill="none" stroke={AMBER} strokeWidth={2} />
      <line x1={40} y1={28} x2={40} y2={72} stroke={SLATE} strokeWidth={1} strokeDasharray="3 3" />
      <line x1={76} y1={28} x2={76} y2={72} stroke={BLUE} strokeWidth={1} strokeDasharray="3 3" />
    </svg>
  );
}

function PictoMissing() {
  // A blank cell is fine; a sentinel code is not.
  const cols = [10, 48, 86];
  return (
    <svg viewBox="0 0 120 90" className="h-full w-full" aria-hidden="true">
      {cols.map((x) => (
        <rect key={`h${x}`} x={x} y={10} width={26} height={11} rx={3} fill={BLUE_LIGHT} />
      ))}
      {[28, 46, 64].map((y) =>
        cols.map((x) => {
          const blank = x === 48 && y === 46;
          const sentinel = x === 86 && y === 64;
          if (blank) {
            return (
              <rect key={`${x}-${y}`} x={x + 0.75} y={y + 0.75} width={24.5} height={9.5} rx={2.5}
                    fill="none" stroke={GREEN} strokeWidth={1.5} strokeDasharray="3 2" />
            );
          }
          return (
            <rect key={`${x}-${y}`} x={x} y={y} width={26} height={11} rx={3}
                  fill={sentinel ? "var(--chart-warn-bg)" : RULE} />
          );
        })
      )}
      <text x={99} y={72.5} fontSize={8.5} fill="var(--chart-warn-text)" textAnchor="middle" fontWeight={700}>
        9999
      </text>
      <Check x={72} y={44} />
      <Cross x={110} y={62} />
    </svg>
  );
}

function PictoFewer() {
  // Three complete variables beat a fourth that is mostly missing.
  const xs = [14, 38, 62, 86];
  const rows = [16, 30, 44, 58, 72];
  return (
    <svg viewBox="0 0 120 90" className="h-full w-full" aria-hidden="true">
      {xs.map((x, c) =>
        rows.map((y, r) => {
          const missing = c === 3 && r < 4;
          return missing ? (
            <rect key={`${c}-${r}`} x={x + 0.75} y={y + 0.75} width={18.5} height={9.5} rx={2.5}
                  fill="none" stroke={SLATE} strokeWidth={1} strokeDasharray="2.5 2" />
          ) : (
            <rect key={`${c}-${r}`} x={x} y={y} width={20} height={11} rx={3}
                  fill={c === 3 ? RULE : BLUE_LIGHT} />
          );
        })
      )}
      <Cross x={104} y={22} />
    </svg>
  );
}

interface Item {
  Icon: () => JSX.Element;
  title: string;
  detail: string;
}

const ITEMS: Item[] = [
  {
    Icon: PictoFormat,
    title: "CSV: one header row, then one row per geographic unit.",
    detail: "Matching variables must be numeric.",
  },
  {
    Icon: PictoNames,
    title: "Same column names in both files.",
    detail: "Differently named columns can be linked by hand at Link Columns.",
  },
  {
    Icon: PictoScale,
    title: "Same units and scale, raw values.",
    detail:
      "Not 0.72 in one file and 72% in the other; never already-standardized (z-scored) columns.",
  },
  {
    Icon: PictoDefinition,
    title: "Same definition and coding.",
    detail:
      "A poverty rate at 100% of the poverty line in one file and 180% in the other looks valid but degrades every link. The results page checks for this (offset SMD).",
  },
  {
    Icon: PictoMissing,
    title: "Missing values blank or NA.",
    detail:
      "Convert sentinel codes like 9999 or -99 to blanks first; left in, they count as real extreme values.",
  },
  {
    Icon: PictoFewer,
    title: "Fewer well-measured variables beat many spotty ones.",
    detail:
      "Missing values are never imputed — each adds a fixed distance penalty. Exclude weak variables at Link Columns; the results page tells you if one is hurting the linkage.",
  },
];

export function DataChecklist() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {ITEMS.map(({ Icon, title, detail }) => (
        <li key={title} className="flex items-start gap-3">
          <div className="h-14 w-20 flex-none rounded border border-gray-100 bg-gray-50/60 p-1">
            <Icon />
          </div>
          <div className="text-xs leading-relaxed text-gray-600">
            <strong className="text-gray-800">{title}</strong> {detail}
          </div>
        </li>
      ))}
    </ul>
  );
}
