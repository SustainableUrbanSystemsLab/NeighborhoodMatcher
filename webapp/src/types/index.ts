export interface ParsedDataset {
  headers: string[];
  rows: string[][];
  fileName: string;
  file: File;
}

export interface ColumnLink {
  headerName: string;
  targetIndex: number;
  supplementalIndex: number;
  excluded: boolean;
}

export interface PIIWarning {
  columnName: string;
  datasetLabel: "target" | "supplemental";
  reason: string;
}

export type ConfidenceTier = "High" | "Medium" | "Low" | "No match";

export interface PerTargetDetail {
  target_idx: number;
  /** null when no_match — no supplemental row shares an observed feature,
   *  or the nearest row was rejected by the max-distance cutoff */
  match_idx: number | null;
  /** the nearest supplemental row even when rejected; null only when the
   *  target shares no observed features with any supplemental row */
  nearest_idx: number | null;
  no_match: boolean;
  /** true when the nearest row was discarded by the max-distance cutoff
   *  (diagnostics below still describe that rejected nearest row) */
  rejected: boolean;
  /** true when the link was withheld by the minimum-confidence filter
   *  (a match WAS found; diagnostics describe it, `confidence` keeps the
   *  true tier, the linked row went out unlinked) */
  withheld: boolean;
  best_distance: number | null;
  second_distance: number | null;
  nndr: number | null;
  near_miss: number;
  mnn_confirmed: boolean;
  repeats: number;
  /** missing shared features in the target row */
  target_missing: number;
  /** missing shared features in the matched supplemental row (null when no_match) */
  match_missing: number | null;
  /** shared features observed on BOTH sides of the winning pair */
  features_used: number;
  /** true when the winning pair agrees exactly on every jointly-observed feature */
  exact_on_observed: boolean;
  /** shared columns whose missing target value was filled from the matched row */
  filled_from_match: string[];
  confidence: ConfidenceTier;
  contributions: number[];
  flags: string;
  hist_counts: number[];
  hist_edges: number[];
  top_k_distances: number[];
}

export interface MatchSummary {
  total: number;
  flagged: number;
  mnn_confirmed: number;
  /** rows without an accepted match (zero shared features OR cutoff-rejected) */
  no_match: number;
  /** subset of no_match discarded by the max-distance cutoff */
  rejected: number;
  /** rows whose link was withheld by the minimum-confidence filter
   *  (NOT part of no_match — a match was found, just not reported) */
  withheld: number;
  /** the cutoff in force for this run, null = disabled */
  max_distance: number | null;
  /** the minimum-confidence filter in force, null = disabled */
  min_confidence: "Medium" | "High" | null;
  /** tier counts always reflect TRUE tiers — withholding never moves them */
  tiers: Record<ConfidenceTier, number>;
  mean_nndr: number;
  mean_best_distance: number;
  threshold: number;
}

/** Per-variable input diagnostics (matcher.signals.variable_report), plus
 *  the run-level distance_share added at assembly. */
export interface VariableReportRow {
  feature: string;
  target_missing: number;
  target_missing_pct: number;
  supp_missing: number;
  supp_missing_pct: number;
  target_observed: number;
  supp_observed: number;
  target_mean: number | null;
  supp_mean: number | null;
  target_std: number;
  supp_std: number;
  /** definition-shift check: |mean_t − mean_s| / pooled SD over observed
   *  raw values; null when a side has no observed values (or both sides are
   *  constant with different values) */
  offset_smd: number | null;
  spread_ratio: number | null;
  /** share of the run's total squared match distance driven by this
   *  variable (0..1, sums to ~1 across variables) */
  distance_share: number;
  /** pre-rendered observations from Python — never re-derive in TS */
  notes: string;
}

export interface MatchOutput {
  feature_names: string[];
  smd: number[];
  threshold: number;
  /** dataset-level warnings (e.g. scale mismatch between the two files) */
  warnings: string[];
  /** per-variable report, in feature order */
  variables: VariableReportRow[];
  linked_headers: string[];
  linked_rows: string[][];
  detail_headers: string[];
  detail_rows: string[][];
  per_target: PerTargetDetail[];
  summary: MatchSummary;
}

export type AblationVerdict =
  | "consider_excluding"
  | "load_bearing"
  | "neutral"
  | "insufficient_rows";

/** Run-level quality metrics of one leave-one-variable-out matching variant
 *  (matcher.ablation.variant_metrics). */
export interface AblationMetrics {
  n_rows: number;
  d: number;
  mnn_confirmed: number;
  mnn_confirmed_pct: number;
  no_match: number;
  tiers: Record<ConfidenceTier, number>;
  high_pct: number;
  median_nndr: number | null;
  mean_best_distance: number | null;
}

export interface AblationVariable {
  feature: string;
  metrics: AblationMetrics;
  /** variant − baseline, percentage points; positive = better without it */
  delta_mnn_pct: number;
  delta_high_pct: number;
  verdict: AblationVerdict;
}

/** Leave-one-variable-out report (matcher.web_api.assemble_ablation). */
export interface AblationReport {
  ablation_version: number;
  threshold: number;
  /** true when targets were deterministically subsampled for compute */
  sampled: boolean;
  sample_size: number;
  n_targets: number;
  baseline: AblationMetrics;
  variables: AblationVariable[];
}

export type AblationState =
  | { status: "idle" }
  | { status: "running"; progress: number }
  | { status: "done"; report: AblationReport }
  /** dataset too large for an automatic run — offered as a button instead */
  | { status: "gated" }
  /** fewer than two linked variables — nothing to leave out */
  | { status: "unavailable" }
  | { status: "error"; message: string };

export type AppStep = "upload" | "agreement" | "link" | "matching" | "results";
