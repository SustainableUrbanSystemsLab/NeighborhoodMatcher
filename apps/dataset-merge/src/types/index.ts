export interface ParsedDataset {
  headers: string[];
  rows: string[][];
  fileName: string;
}

export interface ColumnLink {
  headerName: string;
  targetIndex: number;
  supplementalIndex: number;
  excluded: boolean;
}

export interface MatchResult {
  targetRowIndex: number;
  matchedSupplementalIndex: number;
  euclideanDistance: number;
  repeatCount: number;
  nearRepeatCount: number;
  near1PctCount: number;
  near5PctCount: number;
  matchQuality: number;
  matchFlag: MatchFlag;
  flagReasons: string[];
  mergedRow: string[];
}

export interface MatchOutput {
  headers: string[];
  results: MatchResult[];
  mergedRows: string[][];
}

export interface PIIWarning {
  columnName: string;
  datasetLabel: "target" | "supplemental";
  reason: string;
}

export type MatchFlag = "OK" | "Warning" | "Extreme Warning";

export type ProgressCallback = (current: number, total: number) => void;

export type AppStep = "upload" | "agreement" | "link" | "matching" | "results";
