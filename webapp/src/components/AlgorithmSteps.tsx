// Small illustrative SVGs for the five matching-algorithm steps on the
// About page. Purely decorative-explanatory; the authoritative description
// is the adjacent text.

const SLATE = "#94a3b8";
const SLATE_DARK = "#475569";
const BLUE = "#2563eb";
const BLUE_LIGHT = "#bfdbfe";
const GREEN = "#10b981";
const AMBER = "#f59e0b";

function StepAlign() {
  // Two header stacks; identical names linked.
  const rows = [0, 1, 2];
  return (
    <svg viewBox="0 0 120 90" className="h-full w-full" aria-hidden="true">
      {rows.map((r) => (
        <rect key={`l${r}`} x={8} y={16 + r * 22} width={34} height={12} rx={3}
              fill={r === 2 ? "#e2e8f0" : BLUE_LIGHT} />
      ))}
      {rows.map((r) => (
        <rect key={`r${r}`} x={78} y={16 + r * 22} width={34} height={12} rx={3}
              fill={r === 1 ? "#e2e8f0" : BLUE_LIGHT} />
      ))}
      {/* links: row0<->row0, row1<->row2 (name match across positions) */}
      <path d="M42 22 C 58 22, 62 22, 78 22" fill="none" stroke={BLUE} strokeWidth={2} />
      <path d="M42 44 C 58 44, 62 66, 78 66" fill="none" stroke={BLUE} strokeWidth={2} />
      <circle cx={42} cy={22} r={2.5} fill={BLUE} />
      <circle cx={78} cy={22} r={2.5} fill={BLUE} />
      <circle cx={42} cy={44} r={2.5} fill={BLUE} />
      <circle cx={78} cy={66} r={2.5} fill={BLUE} />
    </svg>
  );
}

function StepStandardize() {
  // Two differently-scaled distributions collapsing onto one z axis.
  return (
    <svg viewBox="0 0 120 90" className="h-full w-full" aria-hidden="true">
      {/* wide flat curve */}
      <path d="M6 30 Q 30 6, 54 30" fill="none" stroke={SLATE} strokeWidth={2} />
      {/* narrow tall curve */}
      <path d="M74 30 Q 88 2, 102 30" fill="none" stroke={BLUE} strokeWidth={2} />
      {/* arrows down */}
      <path d="M30 38 L30 50 M27 46 L30 50 L33 46" fill="none" stroke={SLATE_DARK} strokeWidth={1.5} />
      <path d="M88 38 L88 50 M85 46 L88 50 L91 46" fill="none" stroke={SLATE_DARK} strokeWidth={1.5} />
      {/* shared z axis with identical curves */}
      <line x1={10} y1={78} x2={110} y2={78} stroke={SLATE_DARK} strokeWidth={1.5} />
      <path d="M30 76 Q 46 56, 62 76" fill="none" stroke={SLATE} strokeWidth={2} />
      <path d="M46 76 Q 62 56, 78 76" fill="none" stroke={BLUE} strokeWidth={2} />
      <text x={112} y={81} fontSize={8} fill={SLATE_DARK} textAnchor="end">z</text>
    </svg>
  );
}

const CLOUD: Array<[number, number]> = [
  [66, 18], [84, 30], [98, 22], [74, 46], [92, 52], [104, 40],
  [70, 66], [88, 72], [102, 62],
];

function StepDistances() {
  const t: [number, number] = [22, 45];
  return (
    <svg viewBox="0 0 120 90" className="h-full w-full" aria-hidden="true">
      {CLOUD.map(([x, y], i) => (
        <line key={i} x1={t[0]} y1={t[1]} x2={x} y2={y} stroke={SLATE} strokeWidth={0.8} opacity={0.7} />
      ))}
      {CLOUD.map(([x, y], i) => (
        <circle key={`c${i}`} cx={x} cy={y} r={3} fill={SLATE} />
      ))}
      <circle cx={t[0]} cy={t[1]} r={5} fill={BLUE} />
    </svg>
  );
}

function StepBest() {
  const t: [number, number] = [22, 45];
  const best = CLOUD[3]!; // [74, 46]
  return (
    <svg viewBox="0 0 120 90" className="h-full w-full" aria-hidden="true">
      {CLOUD.map(([x, y], i) => (
        <line key={i} x1={t[0]} y1={t[1]} x2={x} y2={y} stroke={SLATE} strokeWidth={0.8} opacity={0.15} />
      ))}
      {CLOUD.map(([x, y], i) => (
        <circle key={`c${i}`} cx={x} cy={y} r={3} fill={SLATE} opacity={i === 3 ? 0 : 0.5} />
      ))}
      <line x1={t[0]} y1={t[1]} x2={best[0]} y2={best[1]} stroke={BLUE} strokeWidth={2.5} />
      <circle cx={t[0]} cy={t[1]} r={5} fill={BLUE} />
      <circle cx={best[0]} cy={best[1]} r={4.5} fill={GREEN} />
      <path d={`M${best[0] - 2.2} ${best[1]} l1.6 1.8 l3 -3.6`} fill="none" stroke="#fff" strokeWidth={1.4} />
    </svg>
  );
}

function StepSignals() {
  return (
    <svg viewBox="0 0 120 90" className="h-full w-full" aria-hidden="true">
      {/* matched pair */}
      <circle cx={22} cy={30} r={5} fill={BLUE} />
      <circle cx={52} cy={30} r={4.5} fill={GREEN} />
      <line x1={27} y1={30} x2={47} y2={30} stroke={BLUE} strokeWidth={2} />
      {/* signal chips */}
      <rect x={70} y={12} width={42} height={13} rx={3.5} fill="#dcfce7" />
      <text x={91} y={21.5} fontSize={7.5} fill="#166534" textAnchor="middle">NNDR 0.21</text>
      <rect x={70} y={31} width={42} height={13} rx={3.5} fill="#dcfce7" />
      <text x={91} y={40.5} fontSize={7.5} fill="#166534" textAnchor="middle">MNN ✓</text>
      <rect x={70} y={50} width={42} height={13} rx={3.5} fill="#fef3c7" />
      <text x={91} y={59.5} fontSize={7.5} fill="#92400e" textAnchor="middle">1 near miss</text>
      {/* flag string */}
      <rect x={12} y={68} width={100} height={13} rx={3.5} fill="#f1f5f9" />
      <circle cx={20} cy={74.5} r={2.5} fill={AMBER} />
      <rect x={27} y={72} width={60} height={5} rx={2.5} fill={SLATE} opacity={0.5} />
    </svg>
  );
}

export const STEP_VISUALS = [
  StepAlign,
  StepStandardize,
  StepDistances,
  StepBest,
  StepSignals,
];
