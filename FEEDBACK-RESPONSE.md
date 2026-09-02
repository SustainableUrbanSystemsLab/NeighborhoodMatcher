# Response to reviewer feedback (August 2026)

Point-by-point reply to two sets of notes: the ABCD linkage-test notes and the
"Notes and suggestions for the updated geocoding tool" document. Each original
comment is quoted verbatim, followed by what changed, where to see it, and
whether anything is still open.

Branch: `claude/abcd-test-linkage-review-hsbcig` (commits `c983767` reviewer
pass, `ee3887d` ABCD pass, `19b1b35` MNN wording, plus provenance, dark mode,
and run-history work that was not requested by reviewers).

Legend: **Done** · **Partly** (something shipped, something still open) ·
**Open** (not changed, with reasoning).

---

## ABCD test notes

> For the ABCD test specifically, I ran 2. One was just a basic proof-of concept test using the ABCD SVI vars as the target and ACS (2014-2018) as the supplement, leaving some out to then cross-check for linkage accuracy. Most variables matched exactly, with only small discrepancies (~0.1) for the remaining (barring any with missingness which incorrectly matched and would need to be manually excluded).

- No change requested. The "incorrectly matched with missingness" rows are the case the confidence tier and minimum-confidence filter below now handle: a row whose match rests on fewer variables than were linked is at most **Medium**, and can be withheld from the linked dataset automatically.

> I also ran an identical test but with an additional matching variable with substantial missingness as a test of potential data issues. This caused a pretty large discrepancy in the overall linkage quality (only 28.2% MNN-confirmed vs 99.9%, many linkages incorrect). This makes me wonder whether the tool could be tweaked somehow to recognize that more matching variables aren't always better (like quality over quantity). In this case, adding a highly incomplete variable actually made the linkage worse--could the tool detect when a variable is likely to reduce match quality and flag or recommend excluding it, rather than assuming that additional matching information is always beneficial?

- **Done.**
  - New leave-one-variable-out check re-runs the match with each linked variable removed and compares run-level quality (MNN-confirmed %, High-confidence %). A variable whose removal improves the run by 10 points or more gets a red **Consider excluding** chip with a one-click **Exclude and adjust** button back to the Link step.
  - Reproduced this exact experiment in a test: one high-missingness variable collapses MNN confirmation, the check flags it, excluding it recovers 100%.
  - Runs automatically after results when the dataset is small enough; a button above the panel runs it on demand for larger data.
  - Where: results page → **Variable check** panel; CLI `--ablation` writes `<base>_ablation.csv`; docs in `matcher/docs/signals/ablation.md`.

> Another situation where I could see this being useful is when a variable may appear to be a valid match but is actually coded or defined differently across datasets (like the weirdness we noticed with pct living alone, or differences defining poverty (100 vs 180))—could the tool recognize that one variable is not behaving consistently with others and recognize when excluding it may actually produce more accurate matches? Could be asking too much, but just a thought!

- **Done.**
  - New per-variable input report: missingness on each side, an *offset* check (standardized mean difference between the two datasets' values), a *spread ratio* (scale check), and each variable's share of total match distance. A large offset with a normal spread ratio is the signature of a definition shift, which the old scale warning could not see.
  - Combined with the leave-one-out check above, a variable that is both offset and harmful gets flagged twice.
  - Where: same **Variable check** panel; `diagnostics/variable_diagnostics.csv` in the results zip; `matcher/docs/signals/variable_report.md`.
  - Caveat: dataset-level warnings need at least 30 observed values per side, so very small test files will not trigger them.

> â€ weird symbol seems to be triggered in flags at times

- **Done.** This was Excel reading UTF-8 em-dashes as ANSI. Every generated file in the results zip and every CLI CSV now carries a UTF-8 byte-order mark, which Excel honours. Original uploads are still copied byte-for-byte.

> When matching targets rows with missingness, I wonder if it would be beneficial to have the tool also try to fill in the missing values with linked data?

- **Done.**
  - When a target cell in a shared column is blank and the row has a match, the linked dataset fills it with the supplemental value verbatim. A new `filled_from_match` column lists which cells were filled so nothing is silent.
  - Never fills for rows with no match or rejected matches. Matching itself still never imputes; the fill happens only in the output.

> An overall note I have that is related to the ABCD test is that the tool seems to be great at finding 'best' matches with given data but less clear at conveying which should be taken seriously as matches and which should be discarded—i think the quality metrics could be explained in a more interpretable way for laypersons, and ultimately it should be easier to distinguish between good matches that were flagged and poor matches that were flagged

- **Done.**
  - Every row now gets one plain verdict: **High / Medium / Low / No match**, computed by a fixed rule table (documented in `matcher/docs/signals/flags.md`). Shown as a table column, a summary card, and in both CSVs.
  - The drill-down composes a plain-language interpretation from the signals (e.g. "Only 1 of 4 matching variables was available … many supplemental rows were similarly close"), replacing the pipe-separated flag string as the thing a reader looks at first.
  - The How-it-works page gained an orientation paragraph on which signals matter most and in what order.

> The tool does not handle differences in scaling (z-scores, ratio/%, etc.)—this should be made clear to anyone when formatting their data for input
>    * Same with missingness

- **Done.**
  - New **Preparing your data** section in the README, on the About page, and as a checklist on the upload step: same definitions on both sides, raw values only (never pre-standardized), same units, convert sentinel codes like 9999 to blanks.
  - The Link step now shows per-column missing counts and warns about suspected sentinel codes before you run.

> For use in large datasets, when it would not be feasible to manually check matches for quality, it would be helpful to be able to set thresholds of quality of matches so the output only produces links that reach a certain standard set by the user. This is similar to the existing NNDR threshold, but I think rather than adding more flags it could be more beneficial to simply have it not report the matches.

- **Done.**
  - New **Minimum confidence** control on the Link step (off / Medium / High). Links below the tier are written *unlinked* in the linked dataset with a "link withheld" note; the detail file keeps full diagnostics so nothing is lost.
  - Purely a reporting filter: SMD, tier counts, and all other rows are byte-identical to a run with it off.
  - Also a separate **distance cutoff** (see "no genuinely similar row" below) for rejecting matches that are simply too far.

---

## "Notes and suggestions" document

### How it works — the matching algorithm

> (1) "Align shared columns" could be more intuitive. Something like "match/identify" shared columns/variable names would be clearer. Description after is great though!

- **Done.** Retitled **Identify shared columns**; body kept.

> Question: What instance might someone want to exclude a variable from matching, either with or without unlinking? Could include examples, since not totally intuitive.

- **Done.** The step now gives examples: an ID column present in both files that is not a real geographic characteristic, or a variable known to be on incompatible scales. Excluded columns stay in the output but are not used to find the match.

> (2) Can approach the standardization point in a more approachable way
> Ex: Different variables within a dataset may have different scales (e.g., population in the 10,000s, % living alone). The tool converts each variable to a standardized scale (z-score normalization) so that variables with larger numerical values do not automatically have more influence on the match. Further, the mean and standard deviation are calculated across both datasets together, so values are comparable between datasets.

- **Done.** Rewritten close to the suggested text: different variables have different scales, each is converted to a common standardized scale so large-number variables do not dominate, and mean/SD are computed across both datasets together.

> (3) "Measure similarity" may be a more intuitive title than "Compute distances" for a less stats-knowledgeable user; we should also explain what Euclidean distance is in plain language, and even give an example of what someone might want to look for
> Ex: Measure similarity. The tool calculates how similar each target row is to each supplemental row based on the standardized geographic characteristics. For example, if two neighborhoods have very similar levels of crime, their distance will be small (e.g., 0.03), whereas if their characteristics differ substantially, their distance will be larger (e.g., 0.99).

- **Done.** Retitled **Measure similarity** and rewritten with a small/large distance example.

> 4 and 5 look great!

- No change.

### Quality signals

> I think this section is great. Some overall feedback though is that, as someone learning about these quality devices for the first time, I'm left wondering how each piece fits together or which ones matter most when evaluating a match.
> Could add a section that gives an overview like, "For individual matches, start with the flags, NNDR, MNN, and near-miss count. Per-feature contribution can help you understand why a match may be questionable. SMD is a dataset-level check rather than a measure of whether any one match is correct."

- **Done.** New orientation paragraph: start with the confidence tier and the flags, then NNDR, MNN, and near-miss count; per-feature contribution is a diagnostic, not a verdict; SMD is a dataset-level check.

> Could also add an overview for each before the definition to orient:
> - NNDR: How clearly was one supplemental row the best match? Lower NNDR indicates a more clearly identified match.
> - MNN: Does the chosen match work in both directions, rather than being a good match for the target but an even better match for another target? (Confirmed/Not confirmed)
> - Near-miss count: How many other supplemental rows were similarly plausible matches? Fewer near misses indicates a more clearly identified match.
> - Per-feature contribution: Which variables were most responsible for the match? Primarily a diagnostic tool.
> - SMD: Does the matching procedure work well across the dataset as a whole? <0.10 indicates good balance, while larger values indicate increasing differences between the two groups.

- **Done.** Each signal now opens with the plain question it answers, in the wording proposed.

> "likely belongs to another record" is confusing

- **Done.** MNN now reads: the pairing holds in both directions, i.e. the matched supplemental row is not closer to any other target. Same wording on hover in the results table, summary card, and drill-down.

> I also think adding another element to this that reports how many matching variables were used to inform the match would be beneficial—currently, this diagnostic lives as a plain-English flag (target row missing 4 of 4 shared feature(s)), but would be more clear and concise on its own.

- **Partly.** New `features_used` signal is in both CSVs, the drill-down ("features used 2/4"), and feeds the confidence tier. It is not yet a column in the on-screen results table. Open: add the column if the table is not too wide.

> 1 tie being no ties is a bit confusing. Should probably be n row(s) tied -1.

- **Done.** Column renamed **Tied at min** and never shows the winner-inclusive 1; shows "none" or the number of *other* rows tied.

### Worked scenarios

> Scenario 1 looks great

- No change.

> Scenario 2: I wonder why, for feature contributions, Pct. Cottages has nearly 80% contribution (nearly reaching the example level indicative of scale or unit issue from the definition) but that is not flagged—what makes this instance different?

- **Done.** Added a "Why is a high share not flagged?" explanation: no flag fires on contribution alone; concentration signals trouble only together with a large absolute distance or a spread-ratio warning, and here rounding 99.5% to 100% in a single column is a big move in standardized units.

> Scenario 3: I also tested a ratio/percentage scale mismatch (e.g., target = 0.72, supplement = 72%) and the linkage totally failed. This seems to highlight an important distinction that should be made, as Scenario 3 appears to demonstrate that in all cases scaling can be detected after a match is still made, whereas my test demonstrates that this is not always the case. Ultimately, there are two possible outcomes when units don't match, depending on the severity:
> Case 1: Wrong units, but match survives, and scale is flagged by feature contribution
> Case 2: Wrong units (more severe case, more mismatched vars), and match fails.

- **Done.** Rewritten as a two-case explanation: *Moderate* (one variable off, match usually survives, contribution table exposes it) vs. *Severe* (several variables off or ratio-vs-percent on all, match fails outright).

> The scenario also currently states that, "After standardization, the target's Dragon Sightings value becomes an extreme outlier — pulling every candidate's distance upward by roughly the same large amount and effectively neutralizing that feature's discriminating power."—this implies, to me at least, that standardization 'fixes' the scaling issue, which it doesn't. I feel like this could be made clearer.

- **Done.** Text now states explicitly that standardization does not fix unit mismatches; it only stops big-number variables from dominating.

> Scenario 5 gets a bit too detailed I think you can keep it simple. Also "belongs" makes it sound like the algorithm knows the true match, when it doesn't.

- **Done.** Shortened, and reframed as "no ground truth: MNN checks consistency in both directions, not correctness."

### Step 1 — Upload

> Could use a short introductory sentence to orient the user on what the tool is and what it does before getting into the weeds of the matching algorithm
> Ex: "For each row in your target dataset, the tool finds the most similar row in the supplemental dataset based on the geographic characteristics you provide, allowing supplemental information to be linked without directly matching on ZIP code.
> This also will allow for a more explicit definition of "target" and "supplemental"
> - Target dataset: the existing dataset you want to add information to. Ex: your study dataset.
> - Supplemental dataset: the dataset containing the additional information you want to link to the target data. Ex: a publicly available census dataset.

- **Done.** Intro sentence in this wording, then Target = the dataset you want to add information to; Supplemental = the dataset holding the information to link.

> Should also probably include a formatting guide that outlines what each file should contain
> Ex: Format—CSVs with one header row followed by one row per geographic unit. Column names should match between datasets, or you can link columns manually on Step 3.
> Also, can give people things to look out for.
> Ex: Ensure all variables planned to be matched upon are on the same scale. Ensure missingness is handled intentionally (no 9999)

- **Done.** Checklist: CSV with one header row, one row per geographic unit, matching column names or link manually on Step 3, same scale and definitions, missingness handled intentionally (no 9999).

### Step 2 — Agreement(s)

- No comments.

### Step 3 — Link Columns

> Identifies duplicate column names and throws error rather than just choosing one—great!

- No change.

> Does not ID NAs at this step and uses NAs as indicative of poor feature balance (SMD = 0.9)—wonder if there is a way to have it identify NAs and just ignore them.

- **Partly.** Missing counts and sentinel warnings now appear per column before the run, and SMD is computed over observed values only (documented in `matcher/docs/signals/euc_distance.md`, where a stale claim was corrected). Open: if SMD ≈ 0.9 still shows on a column with heavy missingness, send the file; the remaining cause would be the missing-data penalty in the distance, not the SMD itself.

> Coming from someone with little computer knowledge, I have no idea how to see how many CPU cores (parallel workers) my machine has… I am not even sure what the point of this is and if my not changing it could be a problem—maybe indicate to just go with auto if unknown.

- **Done.** Control now says "If you're not sure, leave this on Auto" and explains it only affects speed, never the results.

### Step 4 — Match

- No comments.

### Step 5 — Results

> The 'plain-English flags' could be much more plain-English—especially if you're framing it that way.
> Ex. Current: ambiguous match â€" (?) NNDR 1.00 (>= 0.80) | 42 near-miss row(s) within distance ratio threshold | 5 exact-distance tie(s) | MNN not confirmed â€" supplemental row is closer to a different target; this record may have no valid match | target row missing 3 of 4 shared feature(s); match uses observed features only
> Not only is most of this not very interpretable, it has odd symbols which may indicate an error somewhere, and its largely repetitive of the quality signals reported in the prior columns—a more consequential use would be to give it some interpretations of different combinations of quality outcomes.
> Example: ⚠️ Low-confidence match. Only 1 of 4 matching variables was available, so the match was based on very limited information. Many supplemental records were similarly close, and the algorithm could not identify one clearly better match. This match may be incorrect.

- **Done.** Odd symbols fixed (BOM). The flag string still exists for the CSV, but the on-screen interpretation is now a composed paragraph in the style of this example ("Low-confidence match. Only 1 of 4 matching variables was available …"), driven by the tier and structured signals.

> Very cool to be able to click on the row and see the individual value and quality
> However, click row to "drill down" is not very intuitive—maybe "Click a row to expand match details" or something similar

- **Done.** Now reads "Click a row to expand match details".

### Output

> I like that the output now includes the original datasets, agreements, etc. as outlined in the README.docx

- No change.

> When running trials with varying degrees of missingness in target var(s), I noticed the tool matches the new vars accurately but does not try to fill in the missing target var(s)—is this something we would want? I imagine we'd want the output to be the most complete possible dataset, not only linking entirely new vars but filling in any missingness.

- **Done.** See "fill in the missing values" in the ABCD section: filled from the matched row with a `filled_from_match` provenance column.

> Algorithm skips entirely empty rows and throws error: WARNING: no valid match â€" target shares no observed features with any supplemental row | target row missing 4 of 4 shared feature(s); match uses observed features only.
> 'match uses observed' doesn't make sense in a case where there was no match assigned…

- **Done.** The no-match flag no longer appends that tail.

### Other trial notes

> With 2 of 4 matching variables missing, the tool was sometimes able to identify the correct supplemental row, but NNDR remained very high (~ 0.99). I wonder whether the output could distinguish between an exact/very close match and an ambiguous match. For example, if the selected row is an exact match on all available variables (even if there are near misses), could that be made evident?

- **Done.** New `exact_on_observed` signal. The drill-down says when the chosen row matches exactly on every available variable even though the overall distance is inflated by the missing-data penalty. It is used for explanation, not for the tier, so an exact match on 1 of 4 still reads Low.

> When 3 of 4 matching variables are missing, leaving only one available to match on, the tool began producing incorrect matches—expected, and I wonder if the output could provide a stronger warning such as "low confidence match: only 1 matching variable was available" to distinguish a clear guess from other more informed matches. Not sure ab this one…

- **Done.** A match resting on a single variable when more were linked is forced to **Low**, and the interpretation says so in those words.

> Handles rounding well—perfect matches with low NNDR.

- No change.

> When two supplemental rows are exact duplicates on all matching variables (but not variables being linked), the tool randomly selects one row to match but flags it as ambiguous (NNDR 1.00)—reasonable, but I wonder whether the tool should instead leave the supplemental match blank where there are exact ties, particularly for large datasets where users may not be able to manually review every ambiguous match.

- **Partly.** Ties are now **Low** confidence, the winner rule (first in file order, not random) is documented, and the interpretation lists the tie. Setting **Minimum confidence** to Medium or High withholds them from the linked dataset, which gives the "leave blank" behaviour for large datasets. Open: not blank by default, because for many datasets a tie between two identical rows is still a usable link.

> When a target row has no genuinely similar supplemental row, the algorithm still assigned the 'closest' supplemental row and flagged it as MMN-non-confirmed and potentially invalid—is this what we want? I wonder if there could be an option to reject matches beyond a user-defined distance threshold. For example, if the Euclidian distance exceeds a specific threshold, could the tool return "no match" rather than assigning the least-dissimilar record? (Euclidian distance in this case was 13.95, not sure if it can be threshold-ed like that)

- **Done.** New **Reject matches beyond a distance cutoff** control on the Link step. Distance is averaged per variable used (distance ÷ √variables used), so 1.0 ≈ the rows differ by about one standard deviation on every variable. Rejected rows become "No match" with a distinct flag but keep their nearest candidate in the detail file for review. Off by default.

> Noticing a common theme—tool is good at finding close matches, but not so great at distinguishing when matches shouldn't be taken seriously versus those that should.

- **Done.** This is the theme the confidence tier, minimum-confidence filter, distance cutoff, and plain-language interpretation were built around.

---

## Still open (summary)

- `features_used` as an on-screen table column (in CSVs and drill-down today).
- Exact-tie rows are withheld only when a minimum confidence is set; default still links the first tied row.
- Link-step SMD with heavy missingness: computed over observed values, but please re-test on the file that showed 0.9.
- Automatic exclusion of harmful variables is a recommendation with a one-click apply, not automatic; keeping the researcher in the loop was deliberate.
