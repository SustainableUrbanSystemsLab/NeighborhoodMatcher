// Plain-language interpretation of a row's match quality, composed from the
// structured signals (NOT parsed from the Python flag strings, so the two
// can never drift). The tier itself is computed in Python
// (matcher.signals.confidence_tier) — this file only explains it.

import type { PerTargetDetail } from "@/types";

/** One or two sentences a non-statistician can act on. */
export function tierSentence(
  detail: PerTargetDetail,
  nFeatures: number,
  threshold: number
): string {
  const {
    confidence,
    no_match,
    rejected,
    features_used,
    exact_on_observed,
    near_miss,
    repeats,
    mnn_confirmed,
    nndr,
  } = detail;

  if (no_match) {
    if (rejected) {
      return (
        "No match reported: the nearest supplemental row was farther than the " +
        "distance cutoff you set, so it was not assigned. Its diagnostics are " +
        "shown below for review."
      );
    }
    return (
      "No match possible: this target row shares no observed matching " +
      "variables with any supplemental row."
    );
  }

  const reasons: string[] = [];

  if (repeats > 1) {
    reasons.push(
      `${repeats} supplemental rows are exactly tied at the minimum distance, ` +
        "so the tool matched the first in file order — review the tied rows " +
        "before trusting this assignment"
    );
  }
  if (!mnn_confirmed) {
    reasons.push(
      "the matched supplemental row is even closer to a different target row, " +
        "so this pairing is one-sided and may not be a real correspondence"
    );
  }
  if (nndr != null && nndr >= threshold) {
    reasons.push(
      "the second-best candidate was almost as close as the chosen match " +
        `(NNDR ${nndr.toFixed(2)})`
    );
  }
  if (features_used === 1 && nFeatures > 1) {
    reasons.push(
      `only 1 of ${nFeatures} matching variables was available for this pair, ` +
        "so the match rests on very limited information"
    );
  } else if (features_used < nFeatures) {
    reasons.push(
      `only ${features_used} of ${nFeatures} matching variables were available ` +
        "for this pair"
    );
  }
  if (near_miss > 0) {
    reasons.push(
      `${near_miss} other supplemental row${near_miss === 1 ? " was" : "s were"} ` +
        "similarly close"
    );
  }

  const exactNote = exact_on_observed
    ? features_used < nFeatures
      ? " The chosen row agrees exactly on every variable that was available."
      : " The chosen row agrees exactly on every matching variable."
    : "";

  if (confidence === "High") {
    return (
      "High-confidence match: one supplemental row is clearly closest, the " +
      "pairing holds in both directions, and every matching variable was " +
      "compared." + exactNote
    );
  }

  const label =
    confidence === "Low" ? "Low-confidence match" : "Medium-confidence match";
  const tail =
    confidence === "Low" ? " This match may be incorrect — review it before use." : "";
  if (reasons.length === 0) {
    return `${label}.${exactNote}${tail}`;
  }
  const joined =
    reasons.length === 1
      ? reasons[0]
      : reasons.slice(0, -1).join("; ") + "; and " + reasons[reasons.length - 1];
  return `${label}: ${joined}.${exactNote}${tail}`;
}

/** Colors for the tier chip (Tailwind utility classes). */
export function tierChipClasses(tier: PerTargetDetail["confidence"]): string {
  switch (tier) {
    case "High":
      return "bg-green-100 text-green-800 border-green-200";
    case "Medium":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "Low":
      return "bg-red-100 text-red-800 border-red-200";
    default:
      return "bg-gray-200 text-gray-700 border-gray-300";
  }
}

/** Sort weight: worst first when descending. */
export function tierRank(tier: PerTargetDetail["confidence"]): number {
  switch (tier) {
    case "High":
      return 3;
    case "Medium":
      return 2;
    case "Low":
      return 1;
    default:
      return 0;
  }
}
