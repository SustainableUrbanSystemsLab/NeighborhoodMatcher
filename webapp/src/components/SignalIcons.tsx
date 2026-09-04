// "Quality signals" on the How-it-works page: one small pictogram per signal,
// in the same illustrative style as the algorithm steps and the data
// checklist. Decorative only; the text next to each icon is authoritative.

const RULE = "var(--chart-rule)";
const SLATE = "var(--chart-muted)";
const SLATE_DARK = "var(--chart-muted-strong)";
const BLUE = "var(--chart-best)";
const BLUE_LIGHT = "var(--chart-best-soft)";
const GREEN = "var(--chart-ok)";
const AMBER = "var(--chart-near)";
const RED = "var(--chart-cutoff)";

const BOX = "0 0 48 48";

/** Confidence tier: three bars, short-to-long, red / amber / green. */
export function IconTier() {
  return (
    <svg viewBox={BOX} className="h-full w-full" aria-hidden="true">
      <rect x={8} y={30} width={10} height={10} rx={2} fill={RED} />
      <rect x={19} y={20} width={10} height={20} rx={2} fill={AMBER} />
      <rect x={30} y={8} width={10} height={32} rx={2} fill={GREEN} />
    </svg>
  );
}

/** NNDR + near misses: a target with the closest and second-closest rows. */
export function IconNndr() {
  return (
    <svg viewBox={BOX} className="h-full w-full" aria-hidden="true">
      <line x1={12} y1={36} x2={24} y2={20} stroke={BLUE} strokeWidth={2} />
      <line x1={12} y1={36} x2={38} y2={30} stroke={SLATE} strokeWidth={2} strokeDasharray="3 2" />
      <circle cx={12} cy={36} r={5} fill={SLATE_DARK} />
      <circle cx={24} cy={20} r={4.5} fill={BLUE} />
      <circle cx={38} cy={30} r={4.5} fill={AMBER} />
    </svg>
  );
}

/** MNN: two rows pointing at each other. */
export function IconMnn() {
  return (
    <svg viewBox={BOX} className="h-full w-full" aria-hidden="true">
      <circle cx={11} cy={24} r={5} fill={SLATE_DARK} />
      <circle cx={37} cy={24} r={5} fill={BLUE} />
      <path d="M17 20 h13 l-3 -3 M30 20 l-3 3" fill="none" stroke={GREEN} strokeWidth={2} />
      <path d="M31 28 h-13 l3 3 M18 28 l3 -3" fill="none" stroke={GREEN} strokeWidth={2} />
    </svg>
  );
}

/** Features used: four variable cells, one of them missing. */
export function IconFeatures() {
  return (
    <svg viewBox={BOX} className="h-full w-full" aria-hidden="true">
      {[6, 17, 28].map((x) => (
        <rect key={x} x={x} y={18} width={9} height={12} rx={2} fill={BLUE} />
      ))}
      <rect
        x={39}
        y={18}
        width={9}
        height={12}
        rx={2}
        fill="none"
        stroke={SLATE}
        strokeWidth={1.5}
        strokeDasharray="2 2"
      />
    </svg>
  );
}

/** Ties: two rows at exactly the same distance from the target. */
export function IconTies() {
  return (
    <svg viewBox={BOX} className="h-full w-full" aria-hidden="true">
      <circle cx={24} cy={24} r={13} fill="none" stroke={RULE} strokeWidth={1.5} strokeDasharray="3 2" />
      <circle cx={24} cy={24} r={5} fill={SLATE_DARK} />
      <circle cx={24} cy={11} r={4.5} fill={BLUE} />
      <circle cx={24} cy={37} r={4.5} fill={BLUE} />
    </svg>
  );
}

/** Per-feature contribution: one segment of the bar dominates. */
export function IconContribution() {
  return (
    <svg viewBox={BOX} className="h-full w-full" aria-hidden="true">
      <rect x={6} y={18} width={36} height={12} rx={2} fill={BLUE_LIGHT} />
      <rect x={6} y={18} width={26} height={12} rx={2} fill={AMBER} />
      <rect x={32} y={18} width={5} height={12} fill={BLUE} />
      <rect x={37} y={18} width={5} height={12} rx={2} fill={SLATE} />
    </svg>
  );
}

/** SMD: two distributions, mostly overlapping. */
export function IconSmd() {
  return (
    <svg viewBox={BOX} className="h-full w-full" aria-hidden="true">
      <line x1={5} y1={38} x2={43} y2={38} stroke={RULE} strokeWidth={1.5} />
      <path d="M7 37 Q 20 6, 33 37" fill="none" stroke={SLATE} strokeWidth={2} />
      <path d="M14 37 Q 27 6, 40 37" fill="none" stroke={BLUE} strokeWidth={2} />
    </svg>
  );
}

/** Flags: a flag on a pole. */
export function IconFlags() {
  return (
    <svg viewBox={BOX} className="h-full w-full" aria-hidden="true">
      <line x1={13} y1={8} x2={13} y2={42} stroke={SLATE_DARK} strokeWidth={2.5} strokeLinecap="round" />
      <path d="M15 9 h20 l-6 7 l6 7 h-20 z" fill={AMBER} />
    </svg>
  );
}
