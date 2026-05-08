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
  match_idx: number;
  best_distance: number;
  second_distance: number;
  nndr: number;
  near_miss: number;
  mnn_confirmed: boolean;
  repeats: number;
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
  mean_nndr: number;
  mean_best_distance: number;
  threshold: number;
}

export interface MatchOutput {
  feature_names: string[];
  smd: number[];
  threshold: number;
  linked_headers: string[];
  linked_rows: string[][];
  detail_headers: string[];
  detail_rows: string[][];
  per_target: PerTargetDetail[];
  summary: MatchSummary;
}

export type AppStep = "upload" | "agreement" | "link" | "matching" | "results";
