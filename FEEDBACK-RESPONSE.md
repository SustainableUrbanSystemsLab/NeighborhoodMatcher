# Response to reviewer feedback (August 2026)

Point-by-point reply to two sets of notes: the ABCD linkage-test notes and the
"Notes and suggestions for the updated geocoding tool" document. Each bullet
says what changed, where to see it, and whether anything is still open.

Branch: `claude/abcd-test-linkage-review-hsbcig` (commits `c983767` reviewer
pass, `ee3887d` ABCD pass, `19b1b35` MNN wording, plus provenance, dark mode,
and run-history work that was not requested by reviewers).

Legend: **Done** · **Partly** (something shipped, something still open) ·
**Open** (not changed, with reasoning).

---

## ABCD test notes

- **"More matching variables aren't always better; flag or recommend excluding a variable that hurts linkage."** — **Done.**
  - New leave-one-variable-out check re-runs the match with each linked variable removed and compares run-level quality (MNN-confirmed %, High-confidence %). A variable whose removal improves the run by 10 points or more gets a red **Consider excluding** chip with a one-click **Exclude and adjust** button back to the Link step.
  - Reproduced your exact experiment in a test: one high-missingness variable collapses MNN confirmation, the check flags it, excluding it recovers 100%.
  - Runs automatically after results when the dataset is small enough; a button above the panel runs it on demand for larger data.
  - Where: results page → **Variable check** panel; CLI `--ablation` writes `<base>_ablation.csv`; docs in `matcher/docs/signals/ablation.md`.

- **"Recognize when a variable is coded or defined differently across datasets (pct living alone, poverty 100 vs 180)."** — **Done.**
  - New per-variable input report: missingness on each side, an *offset* check (standardized mean difference between the two datasets' values), a *spread ratio* (scale check), and each variable's share of total match distance. A large offset with a normal spread ratio is the signature of a definition shift, which the old scale warning could not see.
  - Combined with the leave-one-out check above, a variable that is both offset and harmful gets flagged twice.
  - Where: same **Variable check** panel; `diagnostics/variable_diagnostics.csv` in the results zip; `matcher/docs/signals/variable_report.md`.
  - Caveat: dataset-level warnings need at least 30 observed values per side, so very small test files will not trigger them.

- **"Weird `â€` symbol in flags."** — **Done.** This was Excel reading UTF-8 em-dashes as ANSI. Every generated file in the results zip and every CLI CSV now carries a UTF-8 byte-order mark, which Excel honours. Original uploads are still copied byte-for-byte.

- **"Fill in missing target values from the linked row."** — **Done.**
  - When a target cell in a shared column is blank and the row has a match, the linked dataset fills it with the supplemental value verbatim. A new `filled_from_match` column lists which cells were filled so nothing is silent.
  - Never fills for rows with no match or rejected matches. Matching itself still never imputes; the fill happens only in the output.

- **"Good at finding best matches, unclear which to take seriously; quality metrics need to be interpretable for laypersons."** — **Done.**
  - Every row now gets one plain verdict: **High / Medium / Low / No match**, computed by a fixed rule table (documented in `matcher/docs/signals/flags.md`). Shown as a table column, a summary card, and in both CSVs.
  - The drill-down composes a plain-language interpretation from the signals (e.g. "Only 1 of 4 matching variables was available … many supplemental rows were similarly close"), replacing the pipe-separated flag string as the thing a reader looks at first.
  - The How-it-works page gained an orientation paragraph on which signals matter most and in what order.

- **"Tool does not handle scaling differences (z-scores, ratio vs %) or missingness; make this clear when formatting data."** — **Done.**
  - New **Preparing your data** section in the README, on the About page, and as a checklist on the upload step: same definitions on both sides, raw values only (never pre-standardized), same units, convert sentinel codes like 9999 to blanks.
  - The Link step now shows per-column missing counts and warns about suspected sentinel codes before you run.

- **"Set a quality threshold so the output only produces links that meet it, rather than more flags."** — **Done.**
  - New **Minimum confidence** control on the Link step (off / Medium / High). Links below the tier are written *unlinked* in the linked dataset with a "link withheld" note; the detail file keeps full diagnostics so nothing is lost.
  - Purely a reporting filter: SMD, tier counts, and all other rows are byte-identical to a run with it off.
  - Also a separate **distance cutoff** (see "no genuinely similar row" below) for rejecting matches that are simply too far.

---

## "Notes and suggestions" document

### How it works — the matching algorithm

- **(1) "Align shared columns" unclear.** — **Done.** Retitled **Identify shared columns**; body kept.
- **Question: when would someone exclude a variable, with or without unlinking?** — **Done.** The step now gives examples: an ID column present in both files that is not a real geographic characteristic, or a variable known to be on incompatible scales. Excluded columns stay in the output but are not used to find the match.
- **(2) Standardization explained more approachably.** — **Done.** Rewritten close to your suggested text: different variables have different scales, each is converted to a common standardized scale so large-number variables do not dominate, and mean/SD are computed across both datasets together.
- **(3) "Compute distances" → "Measure similarity", explain Euclidean distance plainly with an example.** — **Done.** Retitled and rewritten with a small/large distance example.
- **(4) and (5)** — no change requested.

### Quality signals

- **Overview of how the pieces fit together and which matter most.** — **Done.** New orientation paragraph: start with the confidence tier and the flags, then NNDR, MNN, and near-miss count; per-feature contribution is a diagnostic, not a verdict; SMD is a dataset-level check.
- **One-line lead-in before each definition (NNDR, MNN, near-miss, contribution, SMD).** — **Done.** Each signal now opens with the plain question it answers, in the wording you proposed.
- **"Likely belongs to another record" confusing.** — **Done.** MNN now reads: the pairing holds in both directions, i.e. the matched supplemental row is not closer to any other target. Same wording on hover in the results table, summary card, and drill-down.
- **Report how many matching variables informed the match as its own number, not buried in a flag.** — **Partly.** New `features_used` signal is in both CSVs, the drill-down ("features used 2/4"), and feeds the confidence tier. It is not yet a column in the on-screen results table. Open: add the column if the table is not too wide.
- **"1 tie" meaning no ties.** — **Done.** Column renamed **Tied at min** and never shows the winner-inclusive 1; shows "none" or the number of *other* rows tied.

### Worked scenarios

- **Scenario 2: why is ~80% contribution not flagged?** — **Done.** Added a "Why is a high share not flagged?" explanation: no flag fires on contribution alone; concentration signals trouble only together with a large absolute distance or a spread-ratio warning, and here rounding 99.5% to 100% in a single column is a big move in standardized units.
- **Scenario 3: two outcomes when units mismatch (match survives and is flagged vs. match fails).** — **Done.** Rewritten as a two-case explanation: *Moderate* (one variable off, match usually survives, contribution table exposes it) vs. *Severe* (several variables off or ratio-vs-percent on all, match fails outright).
- **Scenario 3 implies standardization fixes scaling.** — **Done.** Text now states explicitly that standardization does not fix unit mismatches; it only stops big-number variables from dominating.
- **Scenario 5 too detailed; "belongs" implies the algorithm knows the true match.** — **Done.** Shortened, and reframed as "no ground truth: MNN checks consistency in both directions, not correctness."

### Step 1 — Upload

- **Short introductory sentence and definitions of target / supplemental.** — **Done.** Intro sentence in your wording, then Target = the dataset you want to add information to; Supplemental = the dataset holding the information to link.
- **Formatting guide.** — **Done.** Checklist: CSV with one header row, one row per geographic unit, matching column names or link manually on Step 3, same scale and definitions, missingness handled intentionally (no 9999).

### Step 3 — Link columns

- **Duplicate column names throw an error.** — no change requested.
- **NAs not identified at this step; NAs read as poor balance (SMD 0.9).** — **Partly.** Missing counts and sentinel warnings now appear per column before the run, and SMD is computed over observed values only (documented in `matcher/docs/signals/euc_distance.md`, where a stale claim was corrected). Open: if you still see SMD ≈ 0.9 on a column with heavy missingness, send the file; the remaining cause would be the missing-data penalty in the distance, not the SMD itself.
- **CPU cores / parallel workers unclear.** — **Done.** Control now says "If you're not sure, leave this on Auto" and explains it only affects speed, never results.

### Step 5 — Results

- **Plain-English flags are not plain, have odd symbols, repeat the columns.** — **Done.** Odd symbols fixed (BOM). The flag string still exists for the CSV, but the on-screen interpretation is now a composed paragraph in the style of your example ("Low-confidence match. Only 1 of 4 matching variables was available …"), driven by the tier and structured signals.
- **"Drill down" not intuitive.** — **Done.** Now reads "Click a row to expand match details".

### Output

- **Fill in missing target values.** — **Done.** See ABCD section above.
- **Empty rows: "no valid match … match uses observed features only" contradiction.** — **Done.** The no-match flag no longer appends that tail.

### Other trial notes

- **2 of 4 variables missing: correct match but NNDR ~0.99; distinguish exact-on-available from ambiguous.** — **Done.** New `exact_on_observed` signal. The drill-down says when the chosen row matches exactly on every available variable even though the overall distance is inflated by the missing-data penalty. It is used for explanation, not for the tier, so an exact match on 1 of 4 still reads Low.
- **3 of 4 missing: stronger "low confidence, only 1 variable available" warning.** — **Done.** A match resting on a single variable when more were linked is forced to **Low**, and the interpretation says so in those words.
- **Rounding handled well.** — no change.
- **Exact duplicate supplemental rows: leave the match blank instead of picking one?** — **Partly.** Ties are now **Low** confidence, the winner rule (first in file order) is documented, and the interpretation lists the tie. Setting **Minimum confidence** to Medium or High withholds them from the linked dataset, which gives the "leave blank" behaviour for large datasets. Open: not blank by default, because for many datasets a tie between two identical rows is still a usable link.
- **No genuinely similar row: option to reject beyond a distance threshold.** — **Done.** New **Reject matches beyond a distance cutoff** control on the Link step. Distance is averaged per variable used (distance ÷ √variables used), so 1.0 ≈ the rows differ by about one standard deviation on every variable. Rejected rows become "No match" with a distinct flag but keep their nearest candidate in the detail file for review. Off by default.

---

## Still open (summary)

- `features_used` as an on-screen table column (in CSVs and drill-down today).
- Exact-tie rows are withheld only when a minimum confidence is set; default still links the first tied row.
- Link-step SMD with heavy missingness: computed over observed values, but please re-test on the file that showed 0.9.
- Automatic exclusion of harmful variables is a recommendation with a one-click apply, not automatic; keeping the researcher in the loop was deliberate.
