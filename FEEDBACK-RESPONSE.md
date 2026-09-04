# Response to reviewer feedback (August 2026)

Point-by-point reply to the ABCD linkage-test notes and the
"Notes and suggestions for the updated geocoding tool" document. 

Branch: `claude/abcd-test-linkage-review-hsbcig` (commits `c983767` reviewer
pass, `ee3887d` ABCD pass, `19b1b35` MNN wording, dark mode,
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
  - Reproduced this exact experiment: [`test_collapse_fixture_reproduces_mnn_collapse`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_ablation.py#L241) builds a dataset where one high-missingness variable collapses MNN confirmation, and [`test_suite_flags_exactly_the_harmful_variable`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_ablation.py#L252) checks that the leave-one-out check flags that variable and nothing else. [`test_variant_equals_fresh_run_with_link_excluded`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_ablation.py#L80) proves each leave-one-out variant equals a fresh run with that link excluded.
  - Runs automatically after results when the dataset is small enough; a button above the panel runs it on demand for larger data.
  - Where: results page → **Variable check** panel; CLI `--ablation` writes `<base>_ablation.csv`; docs in `matcher/docs/signals/ablation.md`.

> Another situation where I could see this being useful is when a variable may appear to be a valid match but is actually coded or defined differently across datasets (like the weirdness we noticed with pct living alone, or differences defining poverty (100 vs 180))—could the tool recognize that one variable is not behaving consistently with others and recognize when excluding it may actually produce more accurate matches? Could be asking too much, but just a thought!

- **Done.**
  - New per-variable input report: missingness on each side, an *offset* check (standardized mean difference between the two datasets' values), a *spread ratio* (scale check), and each variable's share of total match distance. A large offset with a normal spread ratio is the signature of a definition shift, which the old scale warning could not see.
  - Combined with the leave-one-out check above, a variable that is both offset and harmful gets flagged twice.
  - Where: same **Variable check** panel; `diagnostics/variable_diagnostics.csv` in the results zip; `matcher/docs/signals/variable_report.md`.
  - Caveat: dataset-level warnings need at least 30 observed values per side, so very small test files will not trigger them.
  - Verified by: [`test_poverty_style_shift_is_noted_but_scale_check_silent`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_variable_report.py#L41) (a 100% vs 180% FPL style shift is caught by the offset check while the old scale check stays silent), [`test_missing_pct_and_high_missingness_note`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_variable_report.py#L51), [`test_warning_gate_on_observed_count`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_variable_report.py#L139).
  - Panel wiring verified by: [`test_distance_share_matches_definition`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_variable_panel.py#L49) and [`test_cli_and_web_distance_share_agree`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_variable_panel.py#L105).

> â€ weird symbol seems to be triggered in flags at times

- **Done.** This was Excel reading UTF-8 em-dashes as ANSI. Every generated file in the results zip and every CLI CSV now carries a UTF-8 byte-order mark, which Excel honours. Original uploads are still copied byte-for-byte. Verified by: [`test_coordinator_outputs_start_with_bom`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_io_bom.py#L48) and [`test_dump_csv_bom_round_trips_through_load_csv`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_io_bom.py#L30).

> When matching targets rows with missingness, I wonder if it would be beneficial to have the tool also try to fill in the missing values with linked data?

- **Done.**
  - When a target cell in a shared column is blank and the row has a match, the linked dataset fills it with the supplemental value verbatim. A new `filled_from_match` column lists which cells were filled so nothing is silent.
  - Never fills for rows with no match or rejected matches. Matching itself still never imputes; the fill happens only in the output.
  - Verified by: [`test_blank_cell_filled_with_raw_supplemental_string`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_fill_from_match.py#L45), [`test_observed_cells_untouched`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_fill_from_match.py#L39), [`test_no_match_row_not_filled`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_fill_from_match.py#L61), [`test_rejected_row_not_filled`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_fill_from_match.py#L97).

> An overall note I have that is related to the ABCD test is that the tool seems to be great at finding 'best' matches with given data but less clear at conveying which should be taken seriously as matches and which should be discarded—i think the quality metrics could be explained in a more interpretable way for laypersons, and ultimately it should be easier to distinguish between good matches that were flagged and poor matches that were flagged

- **Done.**
  - Every row now gets one plain verdict: **High / Medium / Low / No match**, computed by a fixed rule table (documented in `matcher/docs/signals/flags.md`). Shown as a table column, a summary card, and in both CSVs.
  - The drill-down composes a plain-language interpretation from the signals (e.g. "Only 1 of 4 matching variables was available … many supplemental rows were similarly close"), replacing the pipe-separated flag string as the thing a reader looks at first.
  - The How-it-works page gained an orientation paragraph on which signals matter most and in what order.
  - Verified by: the rule table in [`test_clean_row_is_high`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_confidence_tier.py#L23) through [`test_single_feature_run_can_be_high`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_confidence_tier.py#L69) (one test per rule, including precedence between rules), and [`test_csv_confidence_matches_per_target`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_confidence_tier.py#L76) for CSV/screen agreement.

> The tool does not handle differences in scaling (z-scores, ratio/%, etc.)—this should be made clear to anyone when formatting their data for input
> 
> * Same with missingness

- **Done.**
  - New **Preparing your data** section in the README, on the About page, and as a checklist on the upload step: same definitions on both sides, raw values only (never pre-standardized), same units, convert sentinel codes like 9999 to blanks.
  - The Link step now shows per-column missing counts and warns about suspected sentinel codes before you run.

> For use in large datasets, when it would not be feasible to manually check matches for quality, it would be helpful to be able to set thresholds of quality of matches so the output only produces links that reach a certain standard set by the user. This is similar to the existing NNDR threshold, but I think rather than adding more flags it could be more beneficial to simply have it not report the matches.

- **Done.**
  - New **Minimum confidence** control on the Link step (off / Medium / High), defaulting to **High** in the webapp. Links below the tier are written *unlinked* in the linked dataset with a "link withheld" note; the detail file keeps full diagnostics so nothing is lost.
  - Purely a reporting filter: SMD, tier counts, and all other rows are byte-identical to a run with it off.
  - Verified by: [`test_medium_withholds_exactly_the_low_rows`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_min_confidence.py#L57), [`test_high_also_withholds_medium`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_min_confidence.py#L93), [`test_run_level_statistics_unchanged`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_min_confidence.py#L100), [`test_off_is_identical_to_base_run`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_min_confidence.py#L51), and [`test_cli_web_parity_with_filter`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_min_confidence.py#L168) (CLI and webapp agree).
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
> 
> - NNDR: How clearly was one supplemental row the best match? Lower NNDR indicates a more clearly identified match.
> - MNN: Does the chosen match work in both directions, rather than being a good match for the target but an even better match for another target? (Confirmed/Not confirmed)
> - Near-miss count: How many other supplemental rows were similarly plausible matches? Fewer near misses indicates a more clearly identified match.
> - Per-feature contribution: Which variables were most responsible for the match? Primarily a diagnostic tool.
> - SMD: Does the matching procedure work well across the dataset as a whole? <0.10 indicates good balance, while larger values indicate increasing differences between the two groups.

- **Done.** Each signal now opens with the plain question it answers, in the wording proposed.

> "likely belongs to another record" is confusing

- **Done.** MNN now reads: the pairing holds in both directions, i.e. the matched supplemental row is not closer to any other target. Same wording on hover in the results table, summary card, and drill-down.

> I also think adding another element to this that reports how many matching variables were used to inform the match would be beneficial—currently, this diagnostic lives as a plain-English flag (target row missing 4 of 4 shared feature(s)), but would be more clear and concise on its own.

- **Done.** New `features_used` signal is in both CSVs, the drill-down ("features used 2/4"), and feeds the confidence tier. The results table now has a sortable **Variables used** column showing `k/n` (observed on both sides / linked), shaded amber when fewer than all linked variables informed the match, with a hover explanation.

> 1 tie being no ties is a bit confusing. Should probably be n row(s) tied -1.

- **Done.** Column renamed **Tied at min** and never shows the winner-inclusive 1; shows "none" or the number of *other* rows tied.

### Scenarios

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
> 
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

- **Done.** The explanatory paragraph was trimmed to a single line stating the detected core count; the control defaults to Auto.

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

- **Done.** The no-match flag no longer appends that tail. Verified by: [`test_no_match_with_missing_features_omits_observed_features_tail`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_no_match_flags.py#L11).

### Other trial notes

> With 2 of 4 matching variables missing, the tool was sometimes able to identify the correct supplemental row, but NNDR remained very high (~ 0.99). I wonder whether the output could distinguish between an exact/very close match and an ambiguous match. For example, if the selected row is an exact match on all available variables (even if there are near misses), could that be made evident?

- **Done.** New `exact_on_observed` signal. The drill-down says when the chosen row matches exactly on every available variable even though the overall distance is inflated by the missing-data penalty. It is used for explanation, not for the tier, so an exact match on 1 of 4 still reads Low. Verified by: [`test_end_to_end_values`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_observed_signals.py#L65) and [`test_vectorized_matches_reference_on_random_missingness`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_observed_signals.py#L51).

> When 3 of 4 matching variables are missing, leaving only one available to match on, the tool began producing incorrect matches—expected, and I wonder if the output could provide a stronger warning such as "low confidence match: only 1 matching variable was available" to distinguish a clear guess from other more informed matches. Not sure ab this one…

- **Done.** A match resting on a single variable when more were linked is forced to **Low**, and the interpretation says so in those words. Verified by: [`test_single_feature_of_many_is_low`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_confidence_tier.py#L47).

> Handles rounding well—perfect matches with low NNDR.

- No change.

> When two supplemental rows are exact duplicates on all matching variables (but not variables being linked), the tool randomly selects one row to match but flags it as ambiguous (NNDR 1.00)—reasonable, but I wonder whether the tool should instead leave the supplemental match blank where there are exact ties, particularly for large datasets where users may not be able to manually review every ambiguous match.

- **Partly.** Ties are now **Low** confidence, the winner rule (first in file order, not random) is documented, and the interpretation lists the tie. Setting **Minimum confidence** to Medium or High withholds them from the linked dataset, which gives the "leave blank" behaviour for large datasets. Open: not blank by default, because for many datasets a tie between two identical rows could still a usable link. Verified by: [`test_tie_is_low`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_confidence_tier.py#L35).

> When a target row has no genuinely similar supplemental row, the algorithm still assigned the 'closest' supplemental row and flagged it as MMN-non-confirmed and potentially invalid—is this what we want? I wonder if there could be an option to reject matches beyond a user-defined distance threshold. For example, if the Euclidian distance exceeds a specific threshold, could the tool return "no match" rather than assigning the least-dissimilar record? (Euclidian distance in this case was 13.95, not sure if it can be threshold-ed like that)

- **Done.** New **Reject matches beyond a distance cutoff** control on the Link step. Distance is averaged per variable used (distance ÷ √variables used), so 1.0 ≈ the rows differ by about one standard deviation on every variable. Rejected rows become "No match" with a distinct flag but keep their nearest candidate in the detail file for review. Off by default. Verified by: [`test_far_row_rejected_with_diagnostics_kept`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_max_distance.py#L35), [`test_boundary_is_not_rejected`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_max_distance.py#L72), [`test_cutoff_off_is_identical`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_max_distance.py#L29).

> Noticing a common theme—tool is good at finding close matches, but not so great at distinguishing when matches shouldn't be taken seriously versus those that should.

- **Done.** This is the theme the confidence tier, minimum-confidence filter, distance cutoff, and plain-language interpretation were built around.

---

## Still open (summary)

- Exact-tie rows are withheld only when a minimum confidence is set; default still links the first tied row.
- Link-step SMD with heavy missingness: computed over observed values, but please re-test on the file that showed 0.9.
- Excluding a harmful variable is a recommendation with a one-click apply, not automatic. A *harmful variable* here means a linked matching variable whose presence makes the run worse than it would be without it: when the leave-one-out check re-runs the match with that variable removed and the run-level quality improves by 10 points or more (share of MNN-confirmed matches, or share of High-confidence matches), the variable is flagged **Consider excluding**. The usual causes are heavy missingness on one side (the missing-data penalty swamps the real signal, as in the ABCD run where MNN confirmation fell from 99.9% to 28.2%) or a definition that differs between the two files (poverty at 100% vs 180% of the federal poverty line), so the variable pulls matches toward the wrong rows. The tool does not drop it on its own; keeping the researcher in the loop was deliberate, since the same signal can also come from a variable that is simply noisy but legitimately measured.

---

## Test coverage, point by point

Which automated test pins each change above. Paths are under
`matcher/tests/`; run with `pytest` from `matcher/`. Items marked *copy only*
are wording changes with no behaviour to test; items marked *browser-verified*
are webapp behaviour (the webapp has no unit-test runner) that was exercised
with Playwright scripts kept outside the repository.

### ABCD test notes

**Rows with missingness matched incorrectly (proof-of-concept run)**

- [`signals/test_confidence_tier.py::test_partial_missingness_is_medium`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_confidence_tier.py#L55) — a match resting on fewer variables than were linked is at most Medium.
- [`signals/test_confidence_tier.py::test_single_feature_of_many_is_low`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_confidence_tier.py#L47) — one variable out of several forces Low.
- [`test_min_confidence.py::test_medium_withholds_exactly_the_low_rows`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_min_confidence.py#L57), [[`test_min_confidence.py::test_high_also_withholds_medium`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_min_confidence.py#L93)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_min_confidence.py#L93) — those rows can be withheld automatically.
- [`test_pipeline.py::test_missing_target_features_are_flagged`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_pipeline.py#L67) — the "missing k of n shared feature(s)" flag reaches the CSV.

**One high-missingness variable collapsed MNN confirmation (28.2% vs 99.9%)**

- [`test_ablation.py::test_collapse_fixture_reproduces_mnn_collapse`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_ablation.py#L241) — reproduces the experiment: adding the sparse variable collapses MNN-confirmed %.
- [`test_ablation.py::test_suite_flags_exactly_the_harmful_variable`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_ablation.py#L252) — the leave-one-out check flags that variable and none of the clean ones; excluding it recovers.
- [`test_ablation.py::test_variant_equals_fresh_run_with_link_excluded`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_ablation.py#L80), [[`test_ablation.py::test_baseline_variant_matches_full_run`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_ablation.py#L101)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_ablation.py#L101) — "re-run without it" is bitwise the run you get by excluding the link.
- [`test_ablation.py::test_load_bearing_variable_detected`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_ablation.py#L288) — the inverse verdict (removal hurts) is detected, so the check is not biased toward exclusion.
- [`test_ablation.py::test_recommendation_margins_and_veto`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_ablation.py#L185), [[`test_ablation.py::test_recommendation_insufficient_rows`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_ablation.py#L201)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_ablation.py#L201), [[`test_ablation.py::test_saturated_baseline_never_flags`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_ablation.py#L210)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_ablation.py#L210) — the 10-point margin, the counter-signal veto, the 50-row floor, and no flags when the baseline is already perfect.
- [`test_ablation.py::test_sample_*`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_ablation.py) (5 tests) — deterministic subsampling delivers exactly the budgeted rows; [[`test_ablation.py::test_sample_delivers_exact_size_when_n_barely_exceeds_t`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_ablation.py#L146)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_ablation.py#L146) is a regression for a case that silently halved the sample.
- [`test_ablation.py::test_coordinator_ablation_writes_csv_and_prints_table`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_ablation.py#L374) — CLI `--ablation` output.
- [`signals/test_variable_report.py::test_missing_pct_and_high_missingness_note`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_variable_report.py#L51) — the > 50% missingness note itself.

**A variable coded or defined differently (pct living alone; poverty 100% vs 180%)**

- [`signals/test_variable_report.py::test_poverty_style_shift_is_noted_but_scale_check_silent`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_variable_report.py#L41) — the exact case: same spread, shifted mean; the old scale warning stays silent, the offset-SMD note fires.
- [`signals/test_variable_report.py::test_offset_smd_hand_computed`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_variable_report.py#L29) — the statistic against a hand calculation.
- [`signals/test_variable_report.py::test_warning_gate_on_observed_count`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_variable_report.py#L139), [[`signals/test_variable_report.py::test_no_warning_below_offset_threshold`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_variable_report.py#L157)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_variable_report.py#L157) — the ≥ 30-observed gate and the 0.5 threshold.
- [`signals/test_variable_report.py::test_constant_columns_equal_and_different`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_variable_report.py#L119) — constant-but-different coding is noted even though no SMD can be computed.
- "excluding it may produce more accurate matches" — the ablation tests above.

**`â€` weird symbol in flags**

- [`test_io_bom.py::test_dump_csv_starts_with_bom`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_io_bom.py#L24), [[`test_io_bom.py::test_coordinator_outputs_start_with_bom`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_io_bom.py#L48)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_io_bom.py#L48) — every CLI CSV starts with the UTF-8 BOM Excel needs.
- [`test_io_bom.py::test_dump_csv_bom_round_trips_through_load_csv`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_io_bom.py#L30), [[`test_io_bom.py::test_bom_invisible_to_plain_utf8_sig_reader`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_io_bom.py#L38)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_io_bom.py#L38) — the BOM is harmless on the way back in.
- Webapp zip files: *browser-verified* (byte-level check that `linked_dataset.csv` begins with the BOM).

**Fill in missing target values from linked data**

- [`test_fill_from_match.py::test_blank_cell_filled_with_raw_supplemental_string`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_fill_from_match.py#L45), [[`test_fill_from_match.py::test_na_token_cell_filled`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_fill_from_match.py#L54)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_fill_from_match.py#L54) — blank and `NA` cells are filled verbatim.
- [`test_fill_from_match.py::test_observed_cells_untouched`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_fill_from_match.py#L39) — observed values are never overwritten.
- [`test_fill_from_match.py::test_no_match_row_not_filled`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_fill_from_match.py#L61), [`test_fill_from_match.py::test_rejected_row_not_filled`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_fill_from_match.py#L97), [`test_min_confidence.py::test_no_fill_on_withheld_rows`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_min_confidence.py#L128) — never for no-match, cutoff-rejected, or withheld rows.
- [`test_fill_from_match.py::test_supplemental_missing_cell_stays_blank`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_fill_from_match.py#L68), [[`test_fill_from_match.py::test_provenance_lists_columns_in_shared_order`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_fill_from_match.py#L81)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_fill_from_match.py#L81), [[`test_fill_from_match.py::test_reserved_name_collision_warns`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_fill_from_match.py#L112)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_fill_from_match.py#L112), [[`test_fill_from_match.py::test_sharded_equals_single_with_fills`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_fill_from_match.py#L125)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_fill_from_match.py#L125).

**Quality metrics interpretable; good vs bad flagged matches**

- `signals/test_confidence_tier.py` (13 tests) — the whole High / Medium / Low / No match rule table, including precedence ([[`signals/test_confidence_tier.py::test_no_match_wins`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_confidence_tier.py#L27)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_confidence_tier.py#L27), [[`signals/test_confidence_tier.py::test_rejected_wins`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_confidence_tier.py#L31)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_confidence_tier.py#L31), [[`signals/test_confidence_tier.py::test_rejected_beats_tie`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_confidence_tier.py#L61)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_confidence_tier.py#L61), [[`signals/test_confidence_tier.py::test_tie_beats_near_miss`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_confidence_tier.py#L65)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_confidence_tier.py#L65)) and [[`signals/test_confidence_tier.py::test_csv_confidence_matches_per_target`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_confidence_tier.py#L76)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_confidence_tier.py#L76) (CSV column ≡ per-row payload).
- The composed plain-language interpretation lives in the webapp (`confidence-text.ts`): *browser-verified* only.

**Scaling and missingness must be made clear up front**

- Documentation — *copy only*. The detection behind the advice: [`test_standardize.py::test_scale_warning_fires_on_prestandardized_target`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_standardize.py#L62), [`test_simulated_benchmark.py::test_a20_zscored_variant_warns`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_simulated_benchmark.py#L53), [`test_pipeline.py::test_scale_mismatch_warning_returned`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_pipeline.py#L133), [`test_edge_cases.py::test_constant_vs_varying_column_warns`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_edge_cases.py#L171), and [`signals/test_variable_report.py::test_scale_note_agrees_with_dataset_scale_warning`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_variable_report.py#L96) (the per-variable note and the dataset warning can never disagree).
- Per-column missing counts and sentinel detection on the Link step: *browser-verified*.

**Quality threshold so the output only reports links that meet a standard**

- [`test_min_confidence.py::test_medium_withholds_exactly_the_low_rows`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_min_confidence.py#L57), [[`test_min_confidence.py::test_high_also_withholds_medium`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_min_confidence.py#L93)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_min_confidence.py#L93) — the exact withheld set per tier.
- [`test_min_confidence.py::test_off_is_identical_to_base_run`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_min_confidence.py#L51), [[`test_min_confidence.py::test_run_level_statistics_unchanged`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_min_confidence.py#L100)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_min_confidence.py#L100) — a pure reporting filter: SMD, tier counts, and every other row are byte-identical.
- [`test_min_confidence.py::test_precedence_cutoff_rejection_beats_withholding`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_min_confidence.py#L117), [`::test_validation_*`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_min_confidence.py) (3), [[`test_min_confidence.py::test_sharded_equals_single_with_filter`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_min_confidence.py#L158)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_min_confidence.py#L158), [[`test_min_confidence.py::test_cli_web_parity_with_filter`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_min_confidence.py#L168)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_min_confidence.py#L168).

### "Notes and suggestions" document

- **"Identify shared columns"**, **standardization wording**, **"Measure similarity"**, **signals orientation paragraph**, **per-signal overviews**, **MNN wording**, **Scenario 2/3/5 text**, **Step 1 intro and checklist**, **CPU-cores wording**, **"Click a row to expand"** — *copy only*. The behaviour those texts describe is pinned elsewhere: [`test_align.py::test_exclude_removes_column`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_align.py#L20) (excluding a column), [`test_standardize.py::test_combined_mean_is_zero`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_standardize.py#L6) / [`test_standardize.py::test_combined_std_is_one`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_standardize.py#L14) (joint z-scoring), [`test_distance.py::test_known_345_triangle`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_distance.py#L12) (Euclidean distance), `signals/test_mnn_confirmed.py` (8 tests, MNN in both directions).

**Report how many matching variables informed the match (`features_used`)**

- [`test_observed_signals.py::test_end_to_end_values`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_observed_signals.py#L65) — hand-checked `features_used` / `exact_on_observed` per row.

- [`test_observed_signals.py::test_vectorized_matches_reference_on_random_missingness`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_observed_signals.py#L51) — the vectorized engine agrees with a per-row reference under random missingness.

- [`test_observed_signals.py::test_sharded_equals_single_for_new_fields`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_observed_signals.py#L95), [[`test_observed_signals.py::test_shard_payload_new_fields_json_serializable`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_observed_signals.py#L108)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_observed_signals.py#L108), [[`test_observed_signals.py::test_assemble_rejects_versionless_shard`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_observed_signals.py#L116)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_observed_signals.py#L116).

- Results-table **Variables used** column (`k/n`, sortable, amber when k < n): *browser-verified*.

**"1 tie being no ties" is confusing**

- Display change is *browser-verified*. Engine semantics: [`test_distance.py::test_repeat_count_one_when_unique`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_distance.py#L35), [`test_distance.py::test_repeat_count_on_exact_tie`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_distance.py#L40); [`signals/test_build_flags.py::test_repeat_count_of_one_no_flag`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_build_flags.py#L90), [[`signals/test_build_flags.py::test_repeat_count_of_two_flags_tie`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_build_flags.py#L99)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_build_flags.py#L99).

**Step 3 — NAs used as evidence of poor balance (SMD = 0.9)**

- [`signals/test_dataset_smd.py::test_missing_cells_excluded_from_smd`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_dataset_smd.py#L151) — SMD is computed over observed cells only; a blank never shifts it.
- Pre-run missing counts on the Link step: *browser-verified*.

**Step 5 — flags should be plain English; odd symbols**

- Odd symbols: the BOM tests above. Flag content: `signals/test_build_flags.py` (15 tests, one per trigger) and `signals/test_no_match_flags.py` (below). The composed paragraph is webapp code: *browser-verified*.

**Empty rows: "match uses observed features" on a no-match row makes no sense**

- [`signals/test_no_match_flags.py::test_no_match_with_missing_features_omits_observed_features_tail`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_no_match_flags.py#L11), [[`signals/test_no_match_flags.py::test_no_match_without_missing_reports_warning_only`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_no_match_flags.py#L24)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_no_match_flags.py#L24) — the tail is gone on no-match rows.
- [`signals/test_no_match_flags.py::test_matched_path_keeps_observed_features_tail`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_no_match_flags.py#L36) — and still present where it belongs.
- [`test_pipeline.py::test_all_missing_target_is_no_match_not_confident`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_pipeline.py#L80), [`test_simulated_benchmark.py::test_a100_missing_all_is_never_a_confident_match`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_simulated_benchmark.py#L39).

**Distinguish an exact match on the available variables from an ambiguous one**

- [`test_observed_signals.py::test_end_to_end_values`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_observed_signals.py#L65) — `exact_on_observed` is True for a row that matches exactly on every available variable and False otherwise.
- [`test_distance.py::test_partial_agreement_cannot_fake_an_exact_match`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_distance.py#L122), [[`test_distance.py::test_partial_missing_still_finds_best`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_distance.py#L157)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_distance.py#L157).

**Only one of four variables available → stronger warning**

- [`signals/test_confidence_tier.py::test_single_feature_of_many_is_low`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_confidence_tier.py#L47) (forced Low) and [[`signals/test_confidence_tier.py::test_single_feature_run_can_be_high`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_confidence_tier.py#L69)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_confidence_tier.py#L69) (a run that only ever had one variable is not penalised).

**Handles rounding well**

- [`test_edge_cases.py::test_float_dust_column_does_not_repel_exact_twin`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_edge_cases.py#L109).

**Exact duplicate supplemental rows: leave blank rather than pick one?**

- [`signals/test_confidence_tier.py::test_tie_is_low`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_confidence_tier.py#L35), [[`signals/test_confidence_tier.py::test_tie_beats_near_miss`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_confidence_tier.py#L65)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_confidence_tier.py#L65) — a tie is Low.
- [`test_match_all.py::test_exact_matches_and_ties`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_match_all.py#L61), [[`test_match_all.py::test_exact_mode_preserves_coincidental_ties`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_match_all.py#L152)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_match_all.py#L152) — the winner is the reference brute-force winner (first in file order), never random.
- [`test_edge_cases.py::test_all_rows_identical_is_flagged_maximally_ambiguous`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_edge_cases.py#L298).
- Withholding ties for large datasets: [`test_min_confidence.py::test_medium_withholds_exactly_the_low_rows`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_min_confidence.py#L57).

**Reject matches beyond a user-defined distance**

- [`test_max_distance.py::test_far_row_rejected_with_diagnostics_kept`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_max_distance.py#L35) — rejected → No match, nearest candidate kept in the detail file.
- [`test_max_distance.py::test_boundary_is_not_rejected`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_max_distance.py#L72) (strict `>`), [[`test_max_distance.py::test_cutoff_off_is_identical`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_max_distance.py#L29)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_max_distance.py#L29) (off ≡ byte-identical), [[`test_max_distance.py::test_sharded_equals_single_with_cutoff`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_max_distance.py#L89)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_max_distance.py#L89), [[`test_max_distance.py::test_validate_max_distance_rejects_bad_values`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_max_distance.py#L107)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_max_distance.py#L107), [[`test_max_distance.py::test_validate_max_distance_accepts_none_and_positive`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_max_distance.py#L112)](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_max_distance.py#L112).
- [`signals/test_confidence_tier.py::test_rejected_wins`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_confidence_tier.py#L31), [`signals/test_confidence_tier.py::test_rejected_beats_tie`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/signals/test_confidence_tier.py#L61); [`test_min_confidence.py::test_precedence_cutoff_rejection_beats_withholding`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_min_confidence.py#L117).

**Common theme: good at finding close matches, not at saying which to take seriously**

- Everything under confidence tiers, minimum confidence, distance cutoff, and the plain-language flags above; [`test_min_confidence.py::test_cli_web_parity_with_filter`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_min_confidence.py#L168) and [`test_variable_panel.py::test_cli_and_web_distance_share_agree`](https://github.com/SustainableUrbanSystemsLab/NeighborhoodMatcher/blob/claude/abcd-test-linkage-review-hsbcig/matcher/tests/test_variable_panel.py#L105) pin that the CLI and the webapp report the same verdicts.
