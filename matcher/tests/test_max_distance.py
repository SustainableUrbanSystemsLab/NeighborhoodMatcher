"""
Optional max-distance rejection: a match whose best_distance divided by
sqrt(features_used) exceeds the user's cutoff is routed to the no-match
path with a distinct flag, keeping the nearest row's diagnostics visible.
Default (None) must leave every output byte identical to before.
"""

import numpy as np
import pytest

from matcher.distance import validate_max_distance
from matcher.web_api import assemble_results, coordinate_in_memory, match_shard


# t2 sits far from every supplemental row; the rest match closely.
TARGET_CSV = """pid,a,b
t1,10,100
t2,1000,9999
t3,20,200
"""

SUPP_CSV = """geo,a,b,extra
g1,10,100,x
g2,20,200,y
g3,30,300,z
"""


def test_cutoff_off_is_identical():
    base = coordinate_in_memory(TARGET_CSV, SUPP_CSV, threshold=0.8)
    off = coordinate_in_memory(TARGET_CSV, SUPP_CSV, threshold=0.8, max_distance=None)
    assert off == base


def test_far_row_rejected_with_diagnostics_kept():
    base = coordinate_in_memory(TARGET_CSV, SUPP_CSV, threshold=0.8)
    far = base["per_target"][1]
    assert far["no_match"] is False  # without a cutoff the far row is matched

    cutoff = 1.0
    result = coordinate_in_memory(
        TARGET_CSV, SUPP_CSV, threshold=0.8, max_distance=cutoff
    )
    row = result["per_target"][1]
    assert row["rejected"] is True
    assert row["no_match"] is True
    assert row["match_idx"] is None
    assert row["nearest_idx"] == far["match_idx"]  # rejected row identified
    assert row["best_distance"] == far["best_distance"]  # diagnostics kept
    assert row["confidence"] == "No match"
    assert "exceeded the distance cutoff" in row["flags"]
    assert "no valid match" not in row["flags"]  # distinct from zero-overlap

    # Close rows are untouched
    for idx in (0, 2):
        assert result["per_target"][idx]["rejected"] is False
        assert result["per_target"][idx]["no_match"] is False

    # Linked row is blanked like a no-match row; detail keeps the distance
    dist_col = result["linked_headers"].index("euc_distance")
    assert result["linked_rows"][1][dist_col] == ""
    d_dist_col = result["detail_headers"].index("euc_distance")
    assert result["detail_rows"][1][d_dist_col] != ""

    # Summary bookkeeping
    assert result["summary"]["rejected"] == 1
    assert result["summary"]["no_match"] == 1
    assert result["summary"]["max_distance"] == cutoff
    assert result["summary"]["tiers"]["No match"] == 1


def test_boundary_is_not_rejected():
    base = coordinate_in_memory(TARGET_CSV, SUPP_CSV, threshold=0.8)
    far = base["per_target"][1]
    exact_ratio = far["best_distance"] / np.sqrt(far["features_used"])

    at = coordinate_in_memory(
        TARGET_CSV, SUPP_CSV, threshold=0.8, max_distance=exact_ratio
    )
    assert at["per_target"][1]["rejected"] is False  # strict >, not >=

    below = coordinate_in_memory(
        TARGET_CSV, SUPP_CSV, threshold=0.8, max_distance=exact_ratio * 0.999
    )
    assert below["per_target"][1]["rejected"] is True


@pytest.mark.parametrize("n_shards", [2, 3])
def test_sharded_equals_single_with_cutoff(n_shards):
    n = 3
    bounds = np.linspace(0, n, n_shards + 1).astype(int)
    shards = [
        match_shard(TARGET_CSV, SUPP_CSV, threshold=0.8,
                    row_lo=int(lo), row_hi=int(hi))
        for lo, hi in zip(bounds[:-1], bounds[1:])
    ]
    sharded = assemble_results(
        TARGET_CSV, SUPP_CSV, shards, threshold=0.8, max_distance=1.0
    )
    single = coordinate_in_memory(
        TARGET_CSV, SUPP_CSV, threshold=0.8, max_distance=1.0
    )
    assert sharded == single


@pytest.mark.parametrize("bad", [0, -1.0, float("nan"), float("inf"), "1", True])
def test_validate_max_distance_rejects_bad_values(bad):
    with pytest.raises(ValueError):
        validate_max_distance(bad)


def test_validate_max_distance_accepts_none_and_positive():
    validate_max_distance(None)
    validate_max_distance(0.5)
    validate_max_distance(3)
