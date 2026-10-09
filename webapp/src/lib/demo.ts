// Demo mode (/match?demo): the repository's simulated benchmark pair,
// loaded instead of the user's files. 100 synthetic participants, each
// generated from a known census tract, against 73,056 tracts — so the
// answer key (truth_A100.csv) can score the run, which real data never
// allows. scripts/sync-assets.mjs copies the files from simulated_data/
// into public/demo/, and the service worker precaches them with the rest of
// the build: the demo works offline and in the desktop app.

import Papa from "papaparse";
import { parseCSVFile } from "@/lib/csv";
import { saveFile } from "@/lib/platform";
import type { MatchOutput, ParsedDataset } from "@/types";

export const DEMO_TARGET_FILE = "dataset_A100.csv";
export const DEMO_SUPPLEMENTAL_FILE = "dataset_B_tracts.csv";
const DEMO_TRUTH_FILE = "truth_A100.csv";
const DEMO_DIR = "/demo/";

export interface DemoData {
  target: ParsedDataset;
  supplemental: ParsedDataset;
  /** participant_id → GEOID of the tract the participant was generated from */
  truth: Map<string, string>;
}

/** How the run did against the answer key, counted per target row. */
export interface AnswerKeyScore {
  /** rows whose participant is in the answer key */
  total: number;
  /** the nearest supplemental row is the participant's true tract */
  nearestCorrect: number;
  /** links written to the output (accepted matches) */
  linked: number;
  linkedCorrect: number;
  /** nearest row found but not linked: below the minimum confidence or
   *  beyond the distance cutoff */
  heldBack: number;
  heldBackCorrect: number;
  /** no supplemental row shares an observed value with the row */
  noMatch: number;
}

async function fetchDemoFile(name: string): Promise<File> {
  const response = await fetch(DEMO_DIR + name);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return new File([await response.blob()], name, { type: "text/csv" });
}

/** Fetches and parses the sample pair and its answer key. */
export async function loadDemo(): Promise<DemoData> {
  const [targetFile, supplementalFile, truthFile] = await Promise.all([
    fetchDemoFile(DEMO_TARGET_FILE),
    fetchDemoFile(DEMO_SUPPLEMENTAL_FILE),
    fetchDemoFile(DEMO_TRUTH_FILE),
  ]);
  const [target, supplemental, truthText] = await Promise.all([
    parseCSVFile(targetFile),
    parseCSVFile(supplementalFile),
    truthFile.text(),
  ]);
  const [header, ...rows] = Papa.parse<string[]>(truthText.trim(), {
    skipEmptyLines: true,
  }).data;
  const pid = header?.indexOf("participant_id") ?? -1;
  const tract = header?.indexOf("true_tract_geoid") ?? -1;
  if (pid < 0 || tract < 0) {
    throw new Error(`${DEMO_TRUTH_FILE}: expected participant_id and true_tract_geoid columns`);
  }
  return {
    target,
    supplemental,
    truth: new Map(rows.map((r) => [r[pid] ?? "", r[tract] ?? ""])),
  };
}

/** Scores the engine's nearest row for every participant against the
 *  tract it was generated from (tract_geoid passes through the run; it is
 *  never a matching variable). Null when the columns are not there. */
export function scoreAgainstAnswerKey(
  output: MatchOutput,
  demo: DemoData
): AnswerKeyScore | null {
  const pid = demo.target.headers.indexOf("participant_id");
  const geoid = demo.supplemental.headers.indexOf("tract_geoid");
  if (pid < 0 || geoid < 0) return null;
  const score: AnswerKeyScore = {
    total: 0,
    nearestCorrect: 0,
    linked: 0,
    linkedCorrect: 0,
    heldBack: 0,
    heldBackCorrect: 0,
    noMatch: 0,
  };
  for (const row of output.per_target) {
    const truth = demo.truth.get(demo.target.rows[row.target_idx]?.[pid] ?? "");
    if (truth === undefined) continue;
    score.total++;
    if (row.nearest_idx == null) {
      score.noMatch++;
      continue;
    }
    const correct = demo.supplemental.rows[row.nearest_idx]?.[geoid] === truth;
    if (correct) score.nearestCorrect++;
    if (row.match_idx != null) {
      score.linked++;
      if (correct) score.linkedCorrect++;
    } else {
      score.heldBack++;
      if (correct) score.heldBackCorrect++;
    }
  }
  return score;
}

/** Saves one of the sample files (Downloads folder in the desktop app). */
export async function downloadDemoFile(name: string): Promise<string | null> {
  const file = await fetchDemoFile(name);
  return saveFile(file, name);
}
