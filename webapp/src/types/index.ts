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
  /** the cutoff in force for this run, null = disabled */
  max_distance: number | null;
  tiers: Record<ConfidenceTier, number>;
  mean_nndr: number;
  mean_best_distance: number;
  threshold: number;
}

export interface MatchOutput {
  feature_names: string[];
  smd: number[];
  threshold: number;
  /** dataset-level warnings (e.g. scale mismatch between the two files) */
  warnings: string[];
  linked_headers: string[];
  linked_rows: string[][];
  detail_headers: string[];
  detail_rows: string[][];
  per_target: PerTargetDetail[];
  summary: MatchSummary;
}

export type AppStep = "upload" | "agreement" | "link" | "matching" | "results";
