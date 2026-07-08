"""
End-to-end regression floor: run the matcher against the simulated ACS
benchmark (simulated_data/ at the repo root) and fail if any scored floor
regresses. See analysis/benchmark_simulated.py for the scoring and floors.

Skipped automatically when simulated_data/ is not present.
"""

import os
import sys

import pytest

ANALYSIS_DIR = os.path.join(os.path.dirname(__file__), "..", "analysis")
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "simulated_data")

pytestmark = pytest.mark.skipif(
    not os.path.isdir(DATA_DIR),
    reason="simulated_data/ not present",
)

sys.path.insert(0, ANALYSIS_DIR)

from benchmark_simulated import check_floors, run_benchmark  # noqa: E402


@pytest.fixture(scope="module")
def a100_results(tmp_path_factory):
    out = str(tmp_path_factory.mktemp("bench"))
    return run_benchmark(DATA_DIR, "A100", output_dir=out)


def test_a100_floors(a100_results):
    per_scenario, totals = a100_results
    failures = check_floors(per_scenario, totals)
    assert not failures, "\n".join(failures)


def test_a100_missing_all_is_never_a_confident_match(a100_results):
    per_scenario, _ = a100_results
    ma = per_scenario["missing_all"]
    assert ma["no_match"] == ma["n"]


def test_a100_runtime_stays_vectorized(a100_results):
    """100 x 73k took ~20s with the per-row loop and <1s vectorized. A cap
    of 10s trips if someone reintroduces per-row Python matching without
    being flaky on slow CI runners."""
    _, totals = a100_results
    assert totals["runtime_s"] < 10.0


def test_a20_zscored_variant_warns():
    """Pre-standardized input must produce scale-mismatch warnings."""
    from matcher.pipeline import coordinator
    import tempfile

    out = os.path.join(tempfile.mkdtemp(), "z.csv")
    warnings = coordinator(
        os.path.join(DATA_DIR, "dataset_A20_zscored.csv"),
        os.path.join(DATA_DIR, "dataset_B_tracts.csv"),
        output=out,
    )
    assert any("scale mismatch" in w for w in warnings)
