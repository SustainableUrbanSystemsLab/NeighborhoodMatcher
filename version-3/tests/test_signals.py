# Signals tests — skeleton.
# Tests will be written alongside implementation in matcher/signals.py.
#
# Planned test coverage:
#
#   cascading_nndr:
#     - exact match (d1=0) returns nndr=0, near_miss_count=0
#     - clear unique match returns low nndr, zero near misses
#     - ambiguous match returns high nndr, positive near_miss_count
#     - threshold sensitivity (same data, different thresholds)
#
#   mnn_confirmed:
#     - symmetric match returns True
#     - one-directional match returns False
#
#   per_row_feature_contribution:
#     - contributions sum to 1.0
#     - zero-distance row returns all zeros
#
#   dataset_smd:
#     - perfect balance returns SMD=0 per feature
#     - known imbalance returns correct SMD
#     - flags |SMD| > 0.10 and > 0.25 correctly
#
#   build_flags: 
#     - no issues produces empty string
#     - near miss produces expected flag text
#     - no-match condition produces WARNING prefix