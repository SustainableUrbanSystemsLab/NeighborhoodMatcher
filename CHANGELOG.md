# Changelog

All notable changes to NeighborhoodMatcher. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/): every change that ships bumps the
version (`python scripts/bump_version.py patch|minor|major`), and CI refuses a
pull request that changes shipped code without one.

## [0.8.7] - 2026-09-04

### Changed

- The downloaded results package is now named `YYYYMMDD-HHMM-matcher_results.zip` (local time the run completed), so multiple downloads sort chronologically and never silently overwrite each other. Restore's "not a readable zip" error message updated to match.

## [0.8.6] - 2026-09-04

### Changed

- Scenario cards' distance-strip caption now colors the words "Blue" and "amber" to match the dots they describe, using the same text-safe chart tokens (`--chart-best-text` / `--chart-warn-text`) the app already uses for on-chart labels — legible against the page canvas in both themes (verified AA).

## [0.8.5] - 2026-09-04

### Changed

- Footer credits both PIs as links (Dr. Benson Ku's Emory profile; Dr. Patrick Kastner's lab site) and drops the separate "Sustainable Urban Systems Lab" line; README matches.
- The About page's "Scenarios" section no longer pre-expands Scenario 1 when opened — every scenario card starts collapsed, consistent with the section itself being collapsed by default.

## [0.8.4] - 2026-09-04

### Changed

- Results table heading renamed **Row diagnostics** (was "Per-row diagnostics"); matches the results-zip README.
- Row diagnostics page size now offers **1000 rows per page** in addition to 10/25/50/100.
- Removed the paragraph explaining why a run used fewer CPU cores than reported; the run still states target/supplemental row counts and total comparisons.
- Footer credits Dr. Benson Ku and the Sustainable Urban Systems Lab as links (Emory faculty profile; lab website) rather than plain text; README matches.

## [0.8.2] - 2026-09-04

### Fixed

- Dark mode is GitHub's **Dark dimmed** theme (canvas `#212830`, insets `#262c36`, text `#d1d7e0`), not the near-black Dark default; boxes stay the canvas colour with a border. Link and danger text use the next lighter step of the same Primer scale where the token itself sits a hair under WCAG AA on this canvas.

## [0.8.1] - 2026-09-04

### Fixed

- GitHub's surface structure in both themes: boxes are the canvas colour with a border, the muted shade only for headers and insets; tokens from `@primer/primitives` 11.10.0; tinted callouts composited over the canvas; light semantic text mapped to Primer foreground tokens so every page passes WCAG AA in both modes.
- Start over returns minimum confidence to the High default.

## [0.8.0] - 2026-09-04

### Added

- Sortable **Variables used** column (k/n) in the results table.
- Minimum confidence defaults to **High** in the webapp (engine default stays off).
- Manual Column Linking collapses into a block whose summary counts unlinked columns.
- Pictograms for each quality signal on the How-it-works page; concise algorithm steps and signal definitions; scenarios collapsed.
- Pictogram checklist for file format and pre-upload checks, shared by the upload step and the About page.

## [0.7.0] - 2026-09-02

### Added

- Second header / label rows (NDA and ABCD exports) are detected and skipped on both the CLI and the webapp, never silently; the upload card quotes the row and offers **Keep it as data**; `run_info` records the skip.
- Parse errors that hit a label row say what the line is; worker errors show the exception's own sentence instead of a Python traceback.

## [0.6.1] - 2026-09-02

### Fixed

- Ablation subsample delivers exactly the budgeted row count (the stride form returned about half when n barely exceeded t).
- Per-variable scale note and the dataset scale warning share one helper and one limit, so they can never disagree.
- Restoring a run from its zip re-creates manual links between differently named columns (`column_links` in `run_info.csv`); older packages get a warning.
- Background variable check is cancelled explicitly when a new run, restore or Exclude-and-adjust supersedes it.

## [0.6.0] - 2026-08-23

### Added

- Service worker caches the pinned Pyodide runtime (never the app or engine code).
- Metadata-only run history in the browser, and reopening a run from its downloaded results zip.

## [0.5.0] - 2026-08-23

### Added

- Dark mode following the OS setting, switchable per device, GitHub palette.

## [0.4.0] - 2026-08-22

### Added

- Report provenance: authors, tool version and timestamp on the results page, in `run_info.csv` and in the CLI's `<base>_run_info.csv`; site footer with version and build.

## [0.3.0] - 2026-08-22

### Added

- Per-variable input report with the offset-SMD definition-shift check.
- Leave-one-variable-out ablation with `consider_excluding` / `load_bearing` verdicts (results panel, CLI `--ablation`).
- Minimum-confidence reporting filter (`min_confidence`), withheld rows written unlinked.
- UTF-8 BOM on CLI CSVs; MNN explained in plain language on the results page.

## [0.2.0] - 2026-08-21

### Added

- Per-row confidence tier (High / Medium / Low / No match), `features_used` and `exact_on_observed` signals.
- Optional distance cutoff; output completion of missing target cells from the matched row (`filled_from_match`).
- Plain-language drill-down, pre-run missing counts and sentinel detection, UTF-8 BOM on generated zip files.

## [0.1.0]

### Added

- Initial release: brute-force nearest-neighbour matching on jointly standardized shared columns, NNDR / MNN / near-miss / per-feature contribution / SMD signals, CLI and browser (Pyodide) front ends.
