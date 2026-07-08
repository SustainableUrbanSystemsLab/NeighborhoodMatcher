"""
Regression benchmark: run the v3 matcher against the simulated ACS datasets
(simulated_data/ at the repo root) and score it against ground truth.

The simulated data (see simulated_data/readme.docx) pairs fake participants
with the real tract each was generated from, so top-1 accuracy is directly
measurable — something real runs never allow. Scenarios cover the known
failure modes: natural duplicate tracts, +/-2 perturbation, and 1/3/5
missing features.

Usage:
    uv run --project matcher python analysis/benchmark_simulated.py \
        [--size A20|A100|A10000] [--data DIR] [--check]

--check exits non-zero when any floor metric regresses; CI uses this via
tests/test_simulated_benchmark.py.

Stdlib + matcher only (no pandas) so it runs anywhere the package does.
"""

import argparse
import csv
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from matcher.pipeline import coordinator  # noqa: E402


def _read_rows(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return list(reader)


def run_benchmark(data_dir, size="A100", output_dir=None):
    """Runs the matcher on dataset_<size> x dataset_B_tracts and scores it.

    Returns (per_scenario, totals) where per_scenario maps scenario ->
    dict(n, correct, flagged, wrong_flagged, no_match) and totals holds
    run-wide counts plus runtime_s.
    """
    target = os.path.join(data_dir, f"dataset_{size}.csv")
    supplemental = os.path.join(data_dir, "dataset_B_tracts.csv")
    truth_path = os.path.join(data_dir, f"truth_{size}.csv")

    tmp_dir = output_dir or tempfile.mkdtemp(prefix="matcher_bench_")
    output = os.path.join(tmp_dir, f"linked_{size}.csv")

    t0 = time.time()
    warnings = coordinator(target, supplemental, output=output)
    runtime = time.time() - t0

    truth = {r["participant_id"]: r["true_tract_geoid"] for r in _read_rows(truth_path)}
    linked = _read_rows(output)

    per_scenario = {}
    totals = {
        "n": 0, "correct": 0, "wrong": 0, "wrong_flagged": 0,
        "correct_flagged": 0, "no_match": 0,
        "runtime_s": runtime, "warnings": len(warnings),
        "output": output,
    }
    for row in linked:
        pid = row["participant_id"]
        scenario = row["scenario"]
        correct = row["tract_geoid"] == truth[pid]
        flagged = bool(row["flags"])
        no_match = row["flags"].startswith("WARNING: no valid match")

        s = per_scenario.setdefault(
            scenario, {"n": 0, "correct": 0, "flagged": 0, "wrong_flagged": 0, "no_match": 0}
        )
        s["n"] += 1
        s["correct"] += correct
        s["flagged"] += flagged
        s["no_match"] += no_match
        totals["n"] += 1
        totals["no_match"] += no_match
        if correct:
            totals["correct"] += 1
            totals["correct_flagged"] += flagged
        else:
            totals["wrong"] += 1
            totals["wrong_flagged"] += flagged
            s["wrong_flagged"] += flagged

    return per_scenario, totals


# Floors, not targets: chosen below current measured performance so the
# benchmark trips on regressions without being brittle to small shifts.
# Measured 2026-07 (post missing-data + vectorization fixes), A100:
# clean 1.00, duplicate_group 1.00, missing_one 1.00, missing_three 1.00,
# perturbed 0.50, overall 0.95, wrong-flagged 0.80.
FLOORS = {
    "clean_accuracy": 1.0,
    "duplicate_group_accuracy": 1.0,
    "missing_one_accuracy": 0.9,
    "overall_accuracy": 0.85,
    "wrong_flagged_rate": 0.6,
}


def check_floors(per_scenario, totals):
    """Returns a list of violated-floor messages (empty = pass)."""
    def acc(name):
        s = per_scenario.get(name)
        return (s["correct"] / s["n"]) if s and s["n"] else None

    failures = []
    checks = {
        "clean_accuracy": acc("clean"),
        "duplicate_group_accuracy": acc("duplicate_group"),
        "missing_one_accuracy": acc("missing_one"),
        "overall_accuracy": totals["correct"] / totals["n"] if totals["n"] else None,
        "wrong_flagged_rate": (
            totals["wrong_flagged"] / totals["wrong"] if totals["wrong"] else None
        ),
    }
    for name, value in checks.items():
        if value is not None and value < FLOORS[name]:
            failures.append(f"{name} = {value:.3f} below floor {FLOORS[name]}")

    # missing_all rows carry no identifying information: every one of them
    # must be an explicit no-match, never a confident fabricated match.
    ma = per_scenario.get("missing_all")
    if ma and ma["no_match"] != ma["n"]:
        failures.append(
            f"missing_all: {ma['no_match']}/{ma['n']} rows are no-match — "
            "the rest matched something, which means missing data is being imputed again"
        )
    return failures


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--size", default="A100", choices=["A20", "A100", "A10000"])
    ap.add_argument("--data", default=None, help="simulated_data directory")
    ap.add_argument("--output", default=None, help="directory for the linked CSVs")
    ap.add_argument("--check", action="store_true", help="exit 1 if a floor metric regresses")
    args = ap.parse_args()

    data_dir = args.data or os.path.join(
        os.path.dirname(__file__), "..", "..", "simulated_data"
    )
    per_scenario, totals = run_benchmark(data_dir, args.size, args.output)

    print(f"\n{args.size} x dataset_B_tracts — {totals['runtime_s']:.2f}s, "
          f"{totals['warnings']} dataset warning(s)")
    print(f"{'scenario':<18}{'n':>6}{'accuracy':>10}{'flagged':>9}{'no-match':>10}")
    for name in sorted(per_scenario):
        s = per_scenario[name]
        print(f"{name:<18}{s['n']:>6}{s['correct'] / s['n']:>10.3f}"
              f"{s['flagged'] / s['n']:>9.2f}{s['no_match']:>10}")
    overall = totals["correct"] / totals["n"]
    wrong_flagged = totals["wrong_flagged"] / totals["wrong"] if totals["wrong"] else 1.0
    fp = totals["correct_flagged"] / totals["correct"] if totals["correct"] else 0.0
    print(f"\noverall accuracy {overall:.1%} | wrong matches flagged {wrong_flagged:.0%} "
          f"| correct matches flagged {fp:.1%}")
    print(f"linked output: {totals['output']}")

    if args.check:
        failures = check_floors(per_scenario, totals)
        if failures:
            print("\nFLOOR REGRESSIONS:", file=sys.stderr)
            for f in failures:
                print(f"  - {f}", file=sys.stderr)
            sys.exit(1)
        print("all floors passed")


if __name__ == "__main__":
    main()
