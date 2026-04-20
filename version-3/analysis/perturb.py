"""
Introduces Gaussian noise to numeric feature columns of a CSV dataset.
Noise is scaled relative to each column's standard deviation, so a
noise_level of 0.1 adds perturbation with SD = 10% of each column's SD.

Outputs one CSV per noise level into OUTPUT_DIR.

Usage:
    python analysis/perturb.py
"""

import csv
import os

import numpy as np

INPUT       = "data/acs-test/real-data/dataseta.csv"
OUTPUT_DIR  = "data/acs-test/perturbed"
ID_COLUMN   = "census tract"
NOISE_LEVELS = [0.10, 0.25, 0.50]   # fractions of per-column SD
SEED        = 42


def _is_numeric(value):
    try:
        float(value.strip().replace(",", "").replace("$", ""))
        return True
    except ValueError:
        return False


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    rng = np.random.default_rng(SEED)

    with open(INPUT, newline="") as f:
        reader = csv.reader(f)
        headers = next(reader)
        rows    = list(reader)

    # Numeric columns that are not the ID
    numeric_cols = [
        i for i, h in enumerate(headers)
        if h.strip() != ID_COLUMN.strip()
        and all(_is_numeric(row[i]) for row in rows)
    ]

    # Float matrix over numeric columns only
    matrix = np.array(
        [[float(row[c].replace(",", "")) for c in numeric_cols] for row in rows],
        dtype=float,
    )
    col_stds = matrix.std(axis=0)
    col_stds[col_stds == 0] = 1.0   # guard constant columns

    for level in NOISE_LEVELS:
        noise     = rng.normal(scale=level, size=matrix.shape) * col_stds
        perturbed = matrix + noise

        out_rows = []
        for r, raw_row in enumerate(rows):
            new_row = list(raw_row)
            for j, c in enumerate(numeric_cols):
                new_row[c] = str(round(perturbed[r, j], 4))
            out_rows.append(new_row)

        filename = f"dataseta_noise_{int(level * 100):03d}pct.csv"
        with open(os.path.join(OUTPUT_DIR, filename), "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(headers)
            writer.writerows(out_rows)

        print(f"  {filename}  (noise = {level:.0%} of each column SD)")

    print(f"\nWritten {len(NOISE_LEVELS)} files to {OUTPUT_DIR}/")


if __name__ == "__main__":
    main()