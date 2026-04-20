# NOTE: To be rebuilt with new signals from matcher.signals.
# See version-2/analysis/nndr_calibration.py for the initial implementation
# and docs/match_quality_brainstorm.md for design rationale.
#
# Planned additions vs. version-2:
#   - cascading NNDR (d1/d2, d1/d3 ... until threshold)
#   - MNN cross-check
#   - dataset-level SMD per feature
#   - configurable dataset switch (acs-test | dexter | synthetic perturbation)
#   - synthetic perturbation runs for NNDR threshold calibration
#
# Imports will be:
#   from matcher.io import load_csv, clean_val
#   from matcher.align import find_common_headers
#   from matcher.standardize import dual_standardize
#   from matcher.signals import cascading_nndr, mnn_confirmed, dataset_smd