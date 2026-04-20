# NOTE: Human authorized - standalone NNDR calibration analysis
# Reads acs-test data, computes cascading NNDR per target row,
# reports distribution at multiple thresholds. No files written.

import csv
import numpy as np
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Switch dataset here
DATASET = "dexter"   # "acs-test" | "dexter"

if DATASET == "acs-test":
    TARGET       = os.path.join(SCRIPT_DIR, "../data/acs-test/dataseta.csv")
    SUPPLEMENTAL = os.path.join(SCRIPT_DIR, "../data/acs-test/datasetb.csv")
    EXCLUDE      = ["census tract"]
elif DATASET == "dexter":
    TARGET       = os.path.join(SCRIPT_DIR, "../data/dexter-test/sample id.csv")
    SUPPLEMENTAL = os.path.join(SCRIPT_DIR, "../data/dexter-test/dexter_2605208796_extract.csv")
    EXCLUDE      = ["ID"]

THRESHOLDS  = [0.6, 0.7, 0.8, 0.9]

# ── data loading ──────────────────────────────────────────────────────────────

def load_csv(filepath):
    with open(filepath, "r") as f:
        data = list(csv.reader(f))
    return data[0], data[1:]

def find_common_headers(h1, h2, exclude):
    h2_lookup = {name: idx for idx, name in enumerate(h2)}
    return [
        {"headerName": name, "header1Index": i, "header2Index": h2_lookup[name]}
        for i, name in enumerate(h1)
        if name in h2_lookup and name not in exclude
    ]

def dual_standardize(rows1, rows2):
    table = np.array(rows1 + rows2, dtype=float)
    split = len(rows1)
    means = np.mean(table, axis=0)
    stds  = np.std(table, axis=0)
    stds[stds == 0] = 1
    table = (table - means) / stds
    return table[:split], table[split:]

# ── NNDR ──────────────────────────────────────────────────────────────────────

def cascading_nndr(sorted_dists, thresholds):
    """
    sorted_dists: all distances from one target row to all supplemental rows, sorted ascending.
    Returns d1/d2 ratio and near_miss_count for each threshold.
    near_miss_count = number of supplemental rows where d1/di < threshold (i >= 2).
    """
    d1 = sorted_dists[0]

    if d1 == 0:
        # Perfect match — ratio is 0, no ambiguity
        return 0.0, {t: 0 for t in thresholds}

    nndr = d1 / sorted_dists[1]

    near_miss_counts = {}
    for t in thresholds:
        count = 0
        for di in sorted_dists[1:]:   # i = 2, 3, 4 ...
            if d1 / di >= t:           # near miss: di is close to d1 (ratio stays high)
                count += 1
            else:
                break                  # ratio dropped below threshold — all further rows are farther, stop
        near_miss_counts[t] = count

    return nndr, near_miss_counts

# ── main ──────────────────────────────────────────────────────────────────────

print("Loading data...")
h1, rs1 = load_csv(TARGET)
h2, rs2 = load_csv(SUPPLEMENTAL)
print(f"  Target rows:       {len(rs1)}")
print(f"  Supplemental rows: {len(rs2)}")

common = find_common_headers(h1, h2, EXCLUDE)
print(f"  Shared features:   {len(common)}")
for c in common:
    print(f"    - {c['headerName']}")

def clean_val(v):
    v = v.replace(",", "").replace("$", "").strip()
    return "0" if (v == "" or v.upper() == "NA") else v

filtered_rs1 = [[clean_val(row[c["header1Index"]]) for c in common] for row in rs1]
filtered_rs2 = [[clean_val(row[c["header2Index"]]) for c in common] for row in rs2]

print("\nStandardizing...")
std1, std2 = dual_standardize(filtered_rs1, filtered_rs2)

print("Computing distances (this may take a moment)...")
all_nndr        = []
all_best_dist   = []
all_near_miss   = {t: [] for t in THRESHOLDS}

for target_row in std1:
    dists = np.sqrt(np.sum((std2 - target_row) ** 2, axis=1))
    sorted_dists = np.sort(dists)
    all_best_dist.append(sorted_dists[0])

    nndr, near_miss_counts = cascading_nndr(sorted_dists, THRESHOLDS)
    all_nndr.append(nndr)
    for t in THRESHOLDS:
        all_near_miss[t].append(near_miss_counts[t])

all_nndr      = np.array(all_nndr)
all_best_dist = np.array(all_best_dist)

# ── report ────────────────────────────────────────────────────────────────────

W = 62

def section(title):
    print("\n" + "=" * W)
    print(title)
    print("=" * W)

section("BEST MATCH DISTANCE (d1) DISTRIBUTION")
for label, val in [
    ("Min",    all_best_dist.min()),
    ("Median", np.median(all_best_dist)),
    ("Mean",   all_best_dist.mean()),
    ("Max",    all_best_dist.max()),
    ("Std",    all_best_dist.std()),
]:
    print(f"  {label:<10} {val:.4f}")

section("NNDR (d1/d2) DISTRIBUTION")
for label, val in [
    ("Min",    all_nndr.min()),
    ("Median", np.median(all_nndr)),
    ("Mean",   all_nndr.mean()),
    ("Max",    all_nndr.max()),
    ("Std",    all_nndr.std()),
]:
    print(f"  {label:<10} {val:.4f}")

print("\n  Percentiles:")
for p in [10, 25, 50, 75, 90, 95, 99]:
    print(f"    {p:>3}th  {np.percentile(all_nndr, p):.4f}")

section("ROWS FLAGGED (d1/d2 >= threshold)")
for t in THRESHOLDS:
    flagged = int(np.sum(all_nndr >= t))
    pct     = 100 * flagged / len(all_nndr)
    print(f"  threshold={t}  →  {flagged:>3}/{len(all_nndr)} rows flagged  ({pct:.1f}%)")

section("NEAR-MISS COUNT DISTRIBUTION PER THRESHOLD")
for t in THRESHOLDS:
    counts = np.array(all_near_miss[t])
    print(f"\n  threshold={t}:")
    print(f"    0 near misses   {int(np.sum(counts == 0)):>4}  ({100*np.mean(counts==0):.1f}%)")
    print(f"    1+ near misses  {int(np.sum(counts >= 1)):>4}  ({100*np.mean(counts>=1):.1f}%)")
    print(f"    5+ near misses  {int(np.sum(counts >= 5)):>4}  ({100*np.mean(counts>=5):.1f}%)")
    print(f"    Max             {int(counts.max()):>4}")
    print(f"    Mean            {counts.mean():>7.1f}")
    print(f"    Median          {np.median(counts):>7.1f}")

section("NNDR HISTOGRAM (d1/d2, bins of 0.05)")
bins = np.arange(0, 1.05, 0.05)
hist, _ = np.histogram(all_nndr, bins=bins)
max_count = max(hist) if max(hist) > 0 else 1
for i, count in enumerate(hist):
    bar   = "#" * int(40 * count / max_count)
    label = f"{bins[i]:.2f}–{bins[i+1]:.2f}"
    print(f"  {label} | {bar:<40} {count}")

print()