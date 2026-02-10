## NOTE: Partially written with AI - Claude Opus 4.6 - All work checked 

import sys
sys.path.append("src")
from demo import load_csv, find_common_headers, dual_standardize_data, brute_find_best_match

import numpy as np
from concurrent.futures import ProcessPoolExecutor, as_completed

def add_noise(data, noise_level): # input: whole data table, noise level (.10 = up to 10% different)
    table = np.array(data, dtype=float)

    stds = np.std(table, axis=0)
    stds[stds == 0] = 1 # Handles edgecase where a column has identical rows

    """
    Generates noise proportional to the standard deviation

    np.random.normal(
        0 = mean of the dist, equally likely to add or subtract
        noise_level * stds = Creates a noise level relative to column's original spread
        table.shape = size, creates an output array the size of the data
    )
    """
    noise = np.random.normal(0, noise_level * stds, table.shape)

    return table + noise # Adds the noise to each cell of the array

def run_experiment(target_file, supplemental_file, n_columns, noise_level):
    # Load data
    h1, rs1 = load_csv(target_file)
    h2, rs2 = load_csv(supplemental_file)

    # Find common headers, exclude census tract (identifier, not a feature)
    common = find_common_headers(h1, h2)
    common = [c for c in common if c["headerName"] not in ["census tract"]]

    # Limit to n_columns shared columns
    common = common[:n_columns]

    # Extract census tract IDs for ground truth comparison
    target_tracts = [row[0] for row in rs1]
    supp_tracts = [row[0] for row in rs2]

    # Filter to common columns and clean
    filtered_rs1 = [[row[col["header1Index"]].replace(",", "") or "0" for col in common] for row in rs1]
    filtered_rs2 = [[row[col["header2Index"]].replace(",", "") or "0" for col in common] for row in rs2]

    # Add noise to target data only
    noisy_rs1 = add_noise(filtered_rs1, noise_level).tolist()

    # Standardize together (noisy target + clean supplemental)
    std_rows_1, std_rows_2 = dual_standardize_data(noisy_rs1, filtered_rs2)

    # Match and check correctness
    successes = 0
    population = len(std_rows_1)

    for row_1_ind, row in enumerate(std_rows_1):
        (_, row_2_ind), _ = brute_find_best_match(row, std_rows_2)

        # Did it match to the correct tract?
        if target_tracts[row_1_ind] == supp_tracts[row_2_ind]:
            successes += 1

    match_rate = successes / population
    return match_rate

def experiment_coordinator(target_file, supplemental_file, column_counts, noise_levels):
    results = {}

    with ProcessPoolExecutor() as pool: # Multithreading 
        futures = {
            pool.submit(run_experiment, target_file, supplemental_file, n_cols, noise): (n_cols, noise)
            for n_cols in column_counts
            for noise in noise_levels
        }

        for future in as_completed(futures):
            n_cols, noise = futures[future]
            rate = future.result()
            results[(n_cols, noise)] = rate
            print(f"Columns: {n_cols}, Noise: {noise}, Match Rate: {rate:.4f}")

    return results

def dump_heatmap_csv(filepath, results, column_counts, noise_levels):
    import csv
    with open(filepath, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Columns \\ Noise"] + [str(n) for n in noise_levels])
        for n_cols in column_counts:
            row = [n_cols] + [results.get((n_cols, noise), "") for noise in noise_levels]
            writer.writerow(row)

if __name__ == "__main__":
    column_counts = [2, 4, 6, 8, 10, 12]
    noise_levels = [0, 0.005, 0.01, 0.015, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.12, 0.15, 0.18, 0.2]

    results = experiment_coordinator(
        target_file="data/acs-test/dataseta.csv",
        supplemental_file="data/acs-test/datasetb.csv",
        column_counts=column_counts,
        noise_levels=noise_levels
    )

    dump_heatmap_csv("data/experiment_results.csv", results, column_counts, noise_levels)