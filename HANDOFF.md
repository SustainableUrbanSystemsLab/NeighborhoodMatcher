# Handoff Notes — Issues, Next Steps, Feedback

> **Layout note (July 2026):** paths below refer to the spring-2026 tree.
> `version-3/` is now `matcher/`, `apps/dataset-merge/` is now `webapp/`, and
> `version-1/` / `version-2/` were removed (recoverable from git history).

Captured at the end of the spring 2026 development cycle as a starting point
for incoming researchers. Items below are a mix of author-flagged concerns,
feedback from collaborators, and observations from the cleanup pass on the
codebase as it stands. Treat this as a draft to edit, prune, or expand — not
a fixed plan.

Scope: `version-3/` backend, calibration / sample data, the
`apps/dataset-merge/` webapp, and the privacy / ethics framing that drove the
v2 → v3 redesign.

---

## Issues

### Privacy & ethics — load-bearing context

- **The brute-force search is a privacy decision, not a convenience one.**
  v2 and v3 were redesigned away from v1 specifically to address HIPAA and
  reverse-engineering concerns about location data — brute force avoids
  building any indexed structure that could leak location through proximity
  patterns. 
- **No external audit of the privacy posture.** The methodology has not been
  reviewed by anyone outside the project for HIPAA or re-identification
  risk. We believe the issue is solved; that belief has not been tested.
- **The PII soft-warning is bypassable.** Nothing prevents a user from
  including census tract ID, location, or other re-identifying columns in
  the matching feature set. The current safeguard is a soft warning, which
  is easy to click through.
- **Performance vs. privacy trade-off is unsurfaced.** The performance
  ceiling discussed below (70k × 70k under 2 minutes) directly conflicts
  with the privacy-driven choice to stay brute-force. Any optimisation work
  has to start from the privacy constraint, not break it.

### Methodology — signal validation

- **Signals are not empirically validated as quality measures.** The signals
  in `version-3/src/matcher/signals.py` (NNDR, MNN, SMD, per-row
  contribution, flags) are theoretically motivated and grounded in
  literature, but no study has been run that asks: "do flagged matches
  actually correlate with bad matches when a human inspects them?" Until
  that's tested, the flags are plausible heuristics, not validated
  diagnostics.
- **NNDR threshold is borrowed from computer vision.** Default `0.8` (Lowe
  2004) has not been calibrated on tabular ACS data. See the calibration
  section.

### Performance

- **Pipeline is too slow for realistic dataset sizes.** Adding the signals
  layer added meaningful overhead. The target workload is roughly
  **70,000 × 70,000 matches in under 2 minutes**; the current pipeline is
  not close to that. Cost lives in the per-target loop in `pipeline.py` /
  `web_api.py` (sorted distances, MNN reverse search, per-row contribution,
  histogram). Vectorising the distance matrix and the per-row signals would
  be the natural starting point, as well as parasllelization. 

### Backend — `version-3/`

- **Missing-value handling is conservative.** `clean_val` (in
  `version-3/src/matcher/io.py`) coerces `""` and `"NA"` to `"0"`. This means
  a missing value is silently treated as zero, which can shift z-scores and
  distances. `pipeline.py` already flags this with a `# Future improvement`
  comment. Real fix: column-mean imputation or an explicit missing flag.
- **Standardized Euclidean ignores feature correlations.** `dual_standardize`
  (in `version-3/src/matcher/standardize.py`) z-scores each column
  independently. When two features are highly correlated they get implicit
  double weight in the distance. The module docstring already notes
  Mahalanobis as the future consideration.

### Webapp — `apps/dataset-merge/`

- **Auto column match is name-only, but the UI does not say so.** The
  pipeline links columns when their headers match exactly (see
  `find_common_headers` in `version-3/src/matcher/align.py`). The webapp
  presents the result as if it had done something more sophisticated. Users
  need to know it's a literal name match so they can override when names
  differ but the columns are the same variable.
- **No fake / sample data downloadable from the frontend.** Researchers
  trying the tool for the first time have no way to see it work without
  bringing their own pair of CSVs.
- **The "How it works" page is too intimidating.** `apps/dataset-merge/src/pages/About.tsx`
  embeds all five explanatory PDFs as iframes plus the full signal glossary.
  For a researcher landing on the page cold, it's a wall of dense material.
  Needs to be cut down, with more inline graphs / visual explainers as the
  primary surface; the long-form descriptions and full PDFs should remain
  reachable but as a links list at the bottom rather than the main view.
- **Per-row drill-down doesn't connect histogram bars back to rows.** In
  `apps/dataset-merge/src/components/ResultsView.tsx`, the per-target
  histogram and rank plot show distance-rank but no way to click a bar and
  see which supplemental row it represents. Researchers want to be able to
  identify near-miss candidates by row.
- **Near-miss output CSVs don't carry the candidate rows.** The linked /
  detail CSVs report `near_miss_count` but not which supplemental rows the
  near-misses are. Researchers asked to be able to inspect or manually link
  these candidates from the CSV alone.
- **Contribution bar visualisation is misleading.** In
  `ResultsView.tsx:600`, the bar width normalises to the row's own
  `maxContrib`, so the longest bar always fills the row. The numeric label
  (`(c * 100).toFixed(1)%`) is correct, but visual comparison across drill-
  downs is broken. Should be `width = c * 100`.
- **`AgreementModal.tsx` is a placeholder.** First line: `// TODO: Expand
  agreement — legal review pending`.

### Calibration / data

- **Both shipped datasets are unsuitable for NNDR calibration.** `acs-test/`
  and `dexter-test/` both contain target rows that exist verbatim in their
  supplemental files (distance = 0).
- **Calibration analysis script was removed.** v2 had `analysis/nndr_calibration.py`;
  v3 had a stub note that was deleted during this cleanup. The synthetic
  perturbation runner (`version-3/analysis/perturb.py`) still exists and has
  written CSVs at 10/25/50% noise, but no analysis script consumes them.
- **No real-population calibration data.** What's needed: a target dataset
  with neighborhood-level variables measured independently of (not extracted
  from) the supplemental ACS pool.

### Repo hygiene

- **Build artifacts and dependencies are tracked in git.**
  `apps/dataset-merge/dist/` and `apps/dataset-merge/node_modules/` are both
  committed; the webapp folder has no `.gitignore`.
  `version-3/src/matcher.egg-info/` is also still tracked even though
  `version-3/.gitignore` now covers it for new clones.
- **Two `.DS_Store` files remain tracked.** `version-3/.DS_Store` and
  `version-2/data/.DS_Store`. `version-3/.gitignore` covers new ones; the
  tracked copies need `git rm --cached`.
- **`version-2/README.md` opens with `**README generated by Claude**`.** v2
  is archived but the AI marker is still there.

---

## Next steps

Top-tier items reflect the priorities surfaced by the author and
collaborators; ordering after that is judgment.

### Critical / blocking confidence in the tool

1. **External HIPAA / ethics audit of the matching methodology.** The v1 → v2/v3
   redesign was driven by privacy concerns; we believe the issue is solved.
   That belief needs an outside reviewer to be defensible.
2. **Harden the PII safeguard.** Move beyond a soft warning. Options: a
   curated block-list of column-name patterns (`tract`, `lat`, `lon`,
   `geoid`, `address`, `zip`, …) that requires an explicit override; or a
   distribution-based check that flags columns with row-uniqueness above a
   threshold. Pair with the ethics audit.
3. **Performance pass — target ~70k × 70k in under 2 minutes.** Vectorise
   the distance matrix; vectorise per-row signals where possible; profile
   the MNN reverse search and the histogram step. **Constraint:** stay
   brute-force at the algorithmic layer (privacy posture); optimise within
   that envelope.
4. **Empirical validation of the signals.** Run an experiment where a human
   labels match quality on a sample, then check whether the flags / NNDR /
   MNN / SMD predictions agree. Until this is done, the signals are
   plausible, not validated.
5. **Source a real calibration dataset.** A target dataset with
   neighborhood-level variables measured independently of the supplemental
   pool. Largest unresolved methodological gap.
6. **Rebuild a calibration analysis script.** Consume the perturbation
   outputs in `version-3/data/acs-test/perturbed/` and produce per-noise-
   level NNDR distributions so the threshold can be tuned empirically.
   v2's `analysis/nndr_calibration.py` is the starting point.

### High — UX overhaul of the webapp

7. **Cut down the "How it works" page** (`apps/dataset-merge/src/pages/About.tsx`).
   Lead with short, visual explainers of each signal; move the embedded
   PDFs and the full glossary to a links list at the bottom for researchers
   who want to dig in. Goal: a non-technical researcher should be able to
   skim the page and feel oriented in under a minute.
8. **Add downloadable sample data to the frontend.** A target/supplemental
   CSV pair the researcher can grab and try before bringing their own.
9. **Surface the auto-link logic in the UI.** A one-line note next to the
   auto-linked columns saying these were matched on identical column names
   only, with a prompt to verify or override.
10. **Make the per-row histogram and rank plot clickable.** Clicking a bar
    or dot should reveal the supplemental row it represents (index, raw
    values).
11. **Include near-miss row data in the output CSVs.** At minimum, the
    target index and distance for each near-miss; ideally the row contents
    so a researcher can manually verify or override the assignment.
12. **Fix the contribution-bar scaling.** One-line change in
    `ResultsView.tsx:600`. Bar width should be `c * 100`, not normalised to
    row max.

### Medium — backend correctness and reporting

13. **Missing-value strategy.** Decide between mean imputation, NA
    propagation, or an explicit per-row missing flag, then update
    `clean_val` and the standardization step. Worth doing before the next
    round of researcher use.
14. **Resolve the legal text in `AgreementModal.tsx`.** Blocks defensible
    upload flow.
15. **Surface dataset-level SMD in the linked CSV summary.** Currently SMD
    is only in the webapp UI and per-row flag messages; a researcher
    reading the CSV alone can't see run-wide SMD without the detail file.
16. **Repo hygiene pass.** Add `apps/dataset-merge/.gitignore`,
    `git rm --cached` the tracked `dist/` / `node_modules/` / `egg-info/` /
    `.DS_Store` files. Strip the AI marker from `version-2/README.md`.

### Lower / longer term

17. **Per-feature ablation signal** described in
    `version-3/docs/old-planning/match_quality_brainstorm.md` under "Per
    Feature Match Contribution by Measuring Degraded Match Quality through
    Systematic Ablation Methodology". Adds selection-based importance to
    complement distance-based contribution.
18. **Mahalanobis distance** (or document the choice to keep standardized
    Euclidean). Account for feature correlations.
10. **Tier 2 preprocessing layer** (column-linkage suggestion beyond name
    match, coverage sufficiency warning).
20. **Tier 3 backdriving with pre-registered correlations.** Architectural
    and ethical constraints already documented; long-term.

---

## Feedback

What worked; worth keeping in future iterations.

- **Brute-force search as a privacy posture.** Worth retaining as a
  load-bearing design choice. Document it as such (see issue above) so it
  isn't accidentally optimised away by a future contributor reaching for a
  kd-tree.
- **Per-signal docs in `version-3/docs/signals/`.** Splitting by signal
  kept each file scoped enough for a non-technical reader without losing
  the link back to the implementation.
- **Explanatory PDF pipeline.** One scenario per signal-failure mode,
  generated by a single template, makes onboarding faster than a single
  long doc — but the *frontend presentation* of those PDFs needs work
  (see UX item 7).
- **Two passes over targets.** Cleanly separates dataset-level signals
  (which need all matches) from per-row signals. Worth preserving even
  when optimising for scale.
- **Pyodide as the bridge.** Letting the webapp and CLI run the same
  Python (`web_api` mirrors `coordinator`) avoided an entire class of
  drift bugs. Verify any new signal works in both entry points before
  merging.

Worth pushing back on / reconsidering.

- **Hard-coded SMD thresholds (0.10, 0.25).** Defensible because they're
  literature-fixed (Austin), but worth surfacing somewhere visible if a
  future researcher disagrees with the convention.
- **Single canonical NNDR threshold per run.** May be insufficient if a
  dataset has heterogeneous feature counts or wildly different feature
  variances; per-feature or per-cluster thresholds are conceivable.
