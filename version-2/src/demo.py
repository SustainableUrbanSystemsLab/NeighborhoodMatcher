# NOTE: Human written

import csv
import numpy as np

# NOTE: Currently using standardized Euclidean distance (z-score normalization + Euclidean).
# Limitation: does not account for correlations between variables.
# Future consideration: swap in Mahalanobis distance and A/B test accuracy on real data.

def load_csv(filepath): # Loads a CSV, returns headers and rows
    with open(filepath, "r") as f:
        reader = csv.reader(f)
        data = list(reader)

    headers = data[0]
    rows = data[1:]

    return headers, rows

def find_common_headers(headers1, headers2): # Finds common headers between two lists, returns list of dicts
    hit_list = []
    h2_lookup = {name: idx for idx, name in enumerate(headers2)} # reduces lookups 

    for h1Ind, target in enumerate(headers1):
        if target in h2_lookup:
            hit_list.append({"headerName": target, "header1Index": h1Ind, "header2Index": h2_lookup[target]})

    return hit_list # returns {"headerName": "medianIncome", "header1Index": 2, "header2Index": 1}

def dual_standardize_data(raw_rows_1, raw_rows_2): # Takes 2 datasets, converts to z-scores, returns 2 std datasets
    table = np.array(raw_rows_1 + raw_rows_2, dtype=float) # Need to standardize with all rows, so the same raw values match up between datasets
    split_point = len(raw_rows_1)
    
    means = np.mean(table, axis=0)
    
    stds = np.std(table, axis=0)
    stds[stds == 0] = 1 # Handles edgecase where a column has identical rows

    table = (table - means) / stds

    std_rows_1 = table[0:split_point]
    std_rows_2 = table[split_point:]
    return std_rows_1, std_rows_2

def euclidean_distance(normal_row_1, normal_row_2): # Finds euc distance between two rows
    return np.sqrt(np.sum((normal_row_1 - normal_row_2)**2))

def brute_find_best_match(target_row, refrence_rows): # Brute force test every refrence row 
    best_match = (np.inf,"unk") # distance, index

    repeat_counter = 0 
    for i, ref_row in enumerate(refrence_rows):

        distance = euclidean_distance(target_row, ref_row)
        if distance < best_match[0]: 
            best_match = (distance, i)
            repeat_counter = 1

        # Know distance and the number of supplemental rows at that distance - append as new columns?
        elif distance == best_match[0]:
            repeat_counter += 1

    return best_match, repeat_counter

def row_merge(target_row, supplemental_row, common): # Merges target row with non-shared supplemental columns
    shared_s_indices = {col["header2Index"] for col in common}
    extras = [val for i, val in enumerate(supplemental_row) if i not in shared_s_indices]
    return target_row + extras

def new_header(target_headers, supplemental_headers, common):
    shared_s_indices = {col["header2Index"] for col in common}
    new_headers = target_headers + [h for i, h in enumerate(supplemental_headers) if i not in shared_s_indices] 
    return new_headers

def dump_csv(filepath, headers, merged_rows):
    with open(filepath, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(merged_rows)
    return 

def coordinator(target, supplemental, exclude=[]):

    # Load Data
    h1, rs1 = load_csv(target)
    h2, rs2 = load_csv(supplemental)

    # Find Common
    common = find_common_headers(h1, h2)
    common = [c for c in common if c["headerName"] not in exclude]
    print(common)

    # Extract just the common columns from each row
    # NOTE: Empty cells default to 0. Future improvement: impute column mean or flag missing data.
    filtered_rs1 = [[row[col["header1Index"]].replace(",", "") or "0" for col in common] for row in rs1]
    filtered_rs2 = [[row[col["header2Index"]].replace(",", "") or "0" for col in common] for row in rs2]

    # Standardization 
    std_rows_1, std_rows_2 = dual_standardize_data(filtered_rs1,filtered_rs2) 

    merged_rows = []

    for row_1_ind, row in enumerate(std_rows_1):
        (euc_distance, row_2_ind), repeats = brute_find_best_match(row, std_rows_2)
        merged_rows.append(row_merge(rs1[row_1_ind], rs2[row_2_ind], common) + [euc_distance, repeats])

    new_h = new_header(h1, h2, common) + ["euc_distance", "repeats"]
    dump_csv("data/output.csv", new_h, merged_rows)

coordinator(target="data/acs-test/dataseta.csv", supplemental="data/acs-test/datasetb.csv", exclude=["census tract"]) # Change filenames for use