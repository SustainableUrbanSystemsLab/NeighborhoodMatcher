"""
The browser worker pool runs match_shard on row slices and merges via
assemble_results. That sharded path must produce EXACTLY the same result
dict as coordinate_in_memory (single shard) — same flags, same MNN, same
CSV strings — or parallel runs would silently disagree with the CLI.
"""

import numpy as np
import pytest

from matcher.web_api import assemble_results, coordinate_in_memory, match_shard


TARGET_CSV = """pid,a,b
t1,10,100
t2,20,200
t3,,300
t4,,
t5,31,310
t6,10,100
"""

# Includes: exact matches, an exact tie (two identical supp rows), missing
# target features, an all-missing target (no-match), an all-missing supp row.
SUPP_CSV = """geo,a,b,extra
g1,10,100,x
g2,10,100,y
g3,20,200,z
g4,30,300,w
g5,,,v
"""


def _shard_and_assemble(n_shards):
    n = 6
    bounds = np.linspace(0, n, n_shards + 1).astype(int)
    shards = [
        match_shard(TARGET_CSV, SUPP_CSV, threshold=0.8,
                    row_lo=int(lo), row_hi=int(hi))
        for lo, hi in zip(bounds[:-1], bounds[1:])
    ]
    return assemble_results(TARGET_CSV, SUPP_CSV, shards, threshold=0.8)


@pytest.mark.parametrize("n_shards", [2, 3, 6])
def test_sharded_equals_single_worker(n_shards):
    single = coordinate_in_memory(TARGET_CSV, SUPP_CSV, threshold=0.8)
    sharded = _shard_and_assemble(n_shards)
    assert sharded == single


def test_shards_merge_in_any_order():
    single = coordinate_in_memory(TARGET_CSV, SUPP_CSV, threshold=0.8)
    shards = [
        match_shard(TARGET_CSV, SUPP_CSV, row_lo=lo, row_hi=hi)
        for lo, hi in [(0, 2), (2, 4), (4, 6)]
    ]
    sharded = assemble_results(TARGET_CSV, SUPP_CSV, list(reversed(shards)))
    assert sharded == single


def test_mnn_needs_global_merge():
    """A supplemental row whose true nearest target lives in ANOTHER shard:
    per-shard MNN would wrongly confirm; the merged col_min must not."""
    single = coordinate_in_memory(TARGET_CSV, SUPP_CSV)
    sharded = _shard_and_assemble(6)  # one row per shard — worst case
    got = [p["mnn_confirmed"] for p in sharded["per_target"]]
    want = [p["mnn_confirmed"] for p in single["per_target"]]
    assert got == want
    # sanity: the fixture actually exercises an unconfirmed row (t2 and t3
    # both nearest g3/g4 territory) — otherwise this test proves nothing
    assert not all(want)


def test_gapped_shards_rejected():
    shards = [
        match_shard(TARGET_CSV, SUPP_CSV, row_lo=0, row_hi=2),
        match_shard(TARGET_CSV, SUPP_CSV, row_lo=4, row_hi=6),
    ]
    with pytest.raises(ValueError, match="tile"):
        assemble_results(TARGET_CSV, SUPP_CSV, shards)


def test_overlapping_shards_rejected():
    shards = [
        match_shard(TARGET_CSV, SUPP_CSV, row_lo=0, row_hi=4),
        match_shard(TARGET_CSV, SUPP_CSV, row_lo=2, row_hi=6),
    ]
    with pytest.raises(ValueError, match="tile"):
        assemble_results(TARGET_CSV, SUPP_CSV, shards)


def test_shard_payload_is_json_serializable():
    """Shard dicts cross worker boundaries via postMessage — no numpy
    scalars, no inf/nan (encoded as None)."""
    import json
    shard = match_shard(TARGET_CSV, SUPP_CSV, row_lo=2, row_hi=6)
    text = json.dumps(shard, allow_nan=False)  # raises on inf/nan
    assert json.loads(text) == shard
