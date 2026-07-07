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

export interface PerTargetDetail {
  target_idx: number;
  /** null when no_match — no supplemental row shares an observed feature */
  match_idx: number | null;
  no_match: boolean;
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
  no_match: number;
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
