"""
Leave-one-variable-out ablation: measures each linked variable's actual
effect on linkage quality by re-matching with that variable left out and
comparing run-level quality against the same rows matched with everything.

Motivation (real researcher use): adding a single high-missingness variable
to an otherwise clean run collapsed MNN confirmation from 99.9% to 28.2% —
every pair charged the missing-data penalty on that dimension, and the
penalty term drowned the signal from the complete variables. The same
failure shape appears when a variable is coded differently in the two files.
More matching variables are not automatically better; this signal finds the
ones that hurt.

Method: for each variable i, drop column i from the already-standardized
arrays and re-run the matching engine. Joint z-scoring is per-column, so
column re-slicing is bitwise identical to a fresh run with that link
excluded (pinned by tests/test_ablation.py). A variable whose removal
IMPROVES run-level quality beyond a margin is recommended for exclusion —
the harm-detection inverse of classical permutation feature importance
(Breiman 2001; Fisher, Rudin & Dominici 2019 "model reliance"; Parikh et
al. 2023 Variable Importance Matching; ReliefF), which measures how much
quality DEGRADES on removal. Design history in
docs/old-planning/match_quality_brainstorm.md.

Cost control: the suite is d+1 full matching passes (element-ops roughly
t * M * d * (d+1)). Above the budget, targets are subsampled with a
deterministic evenly-spaced pattern — run-level rates are statistics, so a
sample answers the question; determinism keeps reruns identical.

Semantics worth knowing:
- Sampled runs compute "restricted-run MNN": the reverse search sees only
  the sampled targets. Valid because the baseline is computed on the SAME
  sample — deltas compare like with like — but the absolute percentages can
  differ from the full run's.
- Ablation ignores max_distance and min_confidence: it diagnoses the raw
  matching geometry, not the reporting configuration.
- Inside a variant, confidence tiers are computed with n_features = d - 1:
  each variant is judged as the run a researcher would get after excluding
  that link.

Recommendation rule (margins are heuristics, documented in
docs/signals/ablation.md): with n >= ABLATION_MIN_ROWS sampled rows, a
verdict fires when MNN-confirmed % or High-tier % moves by at least
ABLATION_MARGIN_PCT points. At n = 50 the worst-case binomial standard
error of a percentage is ~7.1 points, so a 10-point swing is ~1.4 SE — a
pragmatic floor; from n ≈ 200 (the sampling floor) it exceeds 3 SE. A
baseline near 100% cannot improve by 10 points, so already-clean runs never
flag anything.
"""

import math

import numpy as np

from .distance import match_all, validate_threshold, winner_observed_stats
from .signals import confidence_tier

# Version stamp for variant payloads that cross the worker-pool boundary —
# independent of web_api.SHARD_VERSION (shard payloads are untouched by this
# feature). Bump when the variant payload shape changes.
ABLATION_VERSION = 1

# Element-ops budget for the whole suite (~15 s single-core at a few 1e8
# numpy element-ops/s). Suite cost ~= t * M * d * (d + 1).
ABLATION_BUDGET_OPS = 6_000_000_000
ABLATION_TARGET_CAP = 2000    # sampling more targets stops sharpening verdicts
ABLATION_SAMPLE_FLOOR = 200   # sample at least this many when sampling at all
ABLATION_MARGIN_PCT = 10.0    # percentage-point move that triggers a verdict
ABLATION_MIN_ROWS = 50        # below this, no verdicts — sample too small


def ablation_sample_indices(n_targets, m, d,
                            budget=ABLATION_BUDGET_OPS,
                            cap=ABLATION_TARGET_CAP,
                            floor=ABLATION_SAMPLE_FLOOR):
    """
    Deterministic target sample for the ablation suite.

    Returns (indices, sampled): indices is a list of target-row indices,
    evenly spaced from row 0 (no RNG — reruns are identical); sampled is
    False when every target row fits the budget.
    """
    if n_targets <= 0:
        return [], False
    per_target_ops = max(m * d * (d + 1), 1)
    t_budget = budget // per_target_ops
    t = min(n_targets, max(floor, min(cap, t_budget)))
    if t >= n_targets:
        return list(range(n_targets)), False
    step = math.ceil(n_targets / t)
    return list(range(0, n_targets, step)), True


def variant_metrics(std_rows_1, std_rows_2, threshold, drop_index=None,
                    sample_indices=None, chunk_size=64, progress_cb=None):
    """
    Run-level quality metrics for one matching variant.

    std_rows_1, std_rows_2 : jointly standardized arrays (may contain NaN).
    drop_index             : column to leave out (None = baseline, all
                             columns). Column re-slicing of the prepared
                             arrays == fresh run with that link excluded.
    sample_indices         : target rows to match (None = all rows).

    Uses the exact (fast=False) engine path so results are bitwise
    reproducible. Returns a JSON-safe dict:
        n_rows, d, mnn_confirmed, mnn_confirmed_pct, no_match,
        tiers {High/Medium/Low/"No match"}, high_pct,
        median_nndr (over matched rows, None when none),
        mean_best_distance (over matched rows, None when none).

    Percentages use n_rows as the denominator (a no-match row counts as not
    confirmed) so they stay comparable across variants of the same sample.
    """
    targets = np.asarray(std_rows_1, dtype=float)
    refs = np.asarray(std_rows_2, dtype=float)
    d_full = targets.shape[1]

    if sample_indices is not None:
        targets = targets[np.asarray(sample_indices, dtype=int)]
    if drop_index is not None:
        if not 0 <= drop_index < d_full:
            raise ValueError(
                f"drop_index {drop_index} out of range for {d_full} features"
            )
        keep = [c for c in range(d_full) if c != drop_index]
        targets = targets[:, keep]
        refs = refs[:, keep]

    d = targets.shape[1]
    if d == 0:
        raise ValueError("variant has no features left to match on")

    res = match_all(targets, refs, threshold=threshold,
                    chunk_size=chunk_size, progress_cb=progress_cb)
    features_used, _ = winner_observed_stats(targets, refs, res["best_index"])

    n_rows = len(targets)
    matched = res["best_index"] >= 0
    tiers = {"High": 0, "Medium": 0, "Low": 0, "No match": 0}
    for i in range(n_rows):
        tier = confidence_tier(
            not matched[i], False, float(res["nndr"][i]), threshold,
            int(res["repeats"][i]), bool(res["mnn_confirmed"][i]),
            int(res["near_miss"][i]), int(features_used[i]), d,
        )
        tiers[tier] += 1

    confirmed = int(np.count_nonzero(res["mnn_confirmed"] & matched))
    no_match = int(np.count_nonzero(~matched))
    matched_nndr = res["nndr"][matched]
    matched_dist = res["best_distance"][matched]

    return {
        "n_rows": int(n_rows),
        "d": int(d),
        "mnn_confirmed": confirmed,
        "mnn_confirmed_pct": (confirmed / n_rows * 100.0) if n_rows else 0.0,
        "no_match": no_match,
        "tiers": tiers,
        "high_pct": (tiers["High"] / n_rows * 100.0) if n_rows else 0.0,
        "median_nndr": (float(np.median(matched_nndr)) if matched.any() else None),
        "mean_best_distance": (float(matched_dist.mean()) if matched.any() else None),
    }


def build_recommendations(baseline, variants, feature_names,
                          margin=ABLATION_MARGIN_PCT,
                          min_rows=ABLATION_MIN_ROWS):
    """
    Per-feature deltas and verdicts from a baseline plus one variant per
    feature (variants[i] = metrics with feature i left out).

    Deltas are variant − baseline, so POSITIVE means the run got better
    without the variable. Verdicts:
        insufficient_rows  — sample below min_rows; deltas reported, no call
        consider_excluding — removal improves MNN% or High% by >= margin,
                             with no counter-signal at or beyond the margin
        load_bearing       — removal hurts MNN% or High% by >= margin
        neutral            — otherwise
    consider_excluding and load_bearing are mutually exclusive by
    construction (the counter-signal veto).
    """
    out = []
    n_rows = baseline["n_rows"]
    for name, metrics in zip(feature_names, variants):
        delta_mnn = metrics["mnn_confirmed_pct"] - baseline["mnn_confirmed_pct"]
        delta_high = metrics["high_pct"] - baseline["high_pct"]
        if n_rows < min_rows:
            verdict = "insufficient_rows"
        elif ((delta_mnn >= margin or delta_high >= margin)
                and min(delta_mnn, delta_high) > -margin):
            verdict = "consider_excluding"
        elif delta_mnn <= -margin or delta_high <= -margin:
            verdict = "load_bearing"
        else:
            verdict = "neutral"
        out.append({
            "feature": name,
            "metrics": metrics,
            "delta_mnn_pct": float(delta_mnn),
            "delta_high_pct": float(delta_high),
            "verdict": verdict,
        })
    return out


def ablation_suite(std_rows_1, std_rows_2, feature_names, threshold,
                   sample_indices=None, progress_cb=None):
    """
    Full suite: baseline plus one leave-one-out variant per feature, run
    serially (the CLI / single-worker path; the webapp fans variants out
    across its worker pool and assembles with web_api.assemble_ablation).

    Returns the ablation report:
        {"ablation_version", "threshold", "sampled", "sample_size",
         "n_targets", "baseline": {metrics},
         "variables": [{"feature", "metrics", "delta_mnn_pct",
                        "delta_high_pct", "verdict"}, ...]}
    """
    validate_threshold(threshold)
    d = len(feature_names)
    if d < 2:
        raise ValueError(
            "ablation needs at least two linked variables — removing the "
            "only one would leave nothing to match on"
        )
    n_targets = len(std_rows_1)
    sample_size = len(sample_indices) if sample_indices is not None else n_targets
    sampled = sample_indices is not None and sample_size < n_targets

    total_runs = d + 1

    def _sub_progress(run_index):
        if progress_cb is None:
            return None

        def cb(frac):
            try:
                progress_cb((run_index + frac) / total_runs)
            except Exception:
                pass
        return cb

    baseline = variant_metrics(
        std_rows_1, std_rows_2, threshold,
        sample_indices=sample_indices, progress_cb=_sub_progress(0),
    )
    variants = [
        variant_metrics(
            std_rows_1, std_rows_2, threshold, drop_index=i,
            sample_indices=sample_indices, progress_cb=_sub_progress(i + 1),
        )
        for i in range(d)
    ]

    return {
        "ablation_version": ABLATION_VERSION,
        "threshold": float(threshold),
        "sampled": bool(sampled),
        "sample_size": int(sample_size),
        "n_targets": int(n_targets),
        "baseline": baseline,
        "variables": build_recommendations(baseline, variants, feature_names),
    }
