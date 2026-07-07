import csv


def load_csv(filepath):
    """Loads a CSV file. Returns (headers, rows)."""
    with open(filepath, "r") as f:
        data = list(csv.reader(f))
    return data[0], data[1:]


def clean_val(v):
    """Strips commas, dollar signs, and whitespace. Converts empty strings and NA to '0'."""
    v = v.replace(",", "").replace("$", "").strip()
    return "0" if (v == "" or v.upper() == "NA") else v


def dump_csv(filepath, headers, rows):
    """Writes headers and rows to a CSV file."""
    with open(filepath, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(rows)
