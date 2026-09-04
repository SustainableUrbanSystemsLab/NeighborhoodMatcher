"""
features_used / exact_on_observed: winner-pair observed-feature stats added
for the confidence tier and the "exact on available variables" distinction
under heavy missingness (NNDR alone saturates toward 1 there because the
missing-dim penalty dominates both d1 and d2).
"""

import json

import numpy as np
import pytest

from matcher.distance import winner_observed_stats
from matcher.web_api import assemble_results, coordinate_in_memory, match_shard


TARGET_CSV = """pid,a,b,c
t1,1,2,3
t2,1,,3
t3,,,9
t4,,,
"""

SUPP_CSV = """geo,a,b,c
g1,1,2,3
g2,1,5,3
g3,4,4,4
"""


def _reference_stats(targets, refs, best_index):
    """Per-pair loop with explicit NaN masking — the spec the vectorized
    helper must reproduce."""
    features_used, exact = [], []
    for row, j in zip(targets, best_index):
        if j < 0:
            features_used.append(0)
            exact.append(False)
            continue
        n_obs = 0
        sq = 0.0
        for a, b in zip(row, refs[j]):
            if not (np.isnan(a) or np.isnan(b)):
                n_obs += 1
                sq += (a - b) ** 2
        features_used.append(n_obs)
        exact.append(sq == 0.0)
    return features_used, exact


def test_vectorized_matches_reference_on_random_missingness():
    rng = np.random.default_rng(7)
    targets = rng.normal(size=(30, 4))
    refs = rng.normal(size=(20, 4))
    targets[rng.random(targets.shape) < 0.3] = np.nan
    refs[rng.random(refs.shape) < 0.3] = np.nan
    best_index = rng.integers(-1, 20, size=30)

    got_fu, got_exact = winner_observed_stats(targets, refs, best_index)
    want_fu, want_exact = _reference_stats(targets, refs, best_index)
    assert list(got_fu) == want_fu
    assert list(got_exact) == want_exact


def test_end_to_end_values():
    result = coordinate_in_memory(TARGET_CSV, SUPP_CSV, threshold=0.8)
    per = result["per_target"]

    # t1 matches g1 exactly on all 3 features
    assert per[0]["features_used"] == 3
    assert per[0]["exact_on_observed"] is True

    # t2 is missing b; matches g1 or g2 exactly on the 2 observed features
    assert per[1]["features_used"] == 2
    assert per[1]["exact_on_observed"] is True

    # t3 observes only c=9 — no supplemental row has c=9, so not exact
    assert per[2]["features_used"] == 1
    assert per[2]["exact_on_observed"] is False

    # t4 is all-missing — the no-match path
    assert per[3]["no_match"] is True
    assert per[3]["features_used"] == 0
    assert per[3]["exact_on_observed"] is False

    # Both CSVs carry the new columns
    assert "features_used" in result["linked_headers"]
    assert "exact_on_observed" in result["linked_headers"]
    assert "features_used" in result["detail_headers"]
    fu_col = result["linked_headers"].index("features_used")
    assert result["linked_rows"][0][fu_col] == "3"


@pytest.mark.parametrize("n_shards", [2, 4])
def test_sharded_equals_single_for_new_fields(n_shards):
    n = 4
    bounds = np.linspace(0, n, n_shards + 1).astype(int)
    shards = [
        match_shard(TARGET_CSV, SUPP_CSV, threshold=0.8,
                    row_lo=int(lo), row_hi=int(hi))
        for lo, hi in zip(bounds[:-1], bounds[1:])
    ]
    sharded = assemble_results(TARGET_CSV, SUPP_CSV, shards, threshold=0.8)
    single = coordinate_in_memory(TARGET_CSV, SUPP_CSV, threshold=0.8)
    assert sharded == single


def test_shard_payload_new_fields_json_serializable():
    shard = match_shard(TARGET_CSV, SUPP_CSV, threshold=0.8)
    text = json.dumps(shard)
    assert json.loads(text) == shard
    assert shard["features_used"] == [3, 2, 1, 0]
    assert [bool(v) for v in shard["exact_on_observed"]] == [True, True, False, False]


def test_assemble_rejects_versionless_shard():
    shard = match_shard(TARGET_CSV, SUPP_CSV, threshold=0.8)
    del shard["shard_version"]
    with pytest.raises(ValueError, match="recompute the shards"):
        assemble_results(TARGET_CSV, SUPP_CSV, [shard], threshold=0.8)
