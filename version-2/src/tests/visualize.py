## NOTE: Heavily written with AI - Claude Opus 4.6

import csv
import numpy as np
import matplotlib.pyplot as plt

import seaborn as sns # Wrapper for matplotlib.pyplot
import squarify # Wrapper for seaborns for tree plots

def load_results(filepath):
    with open(filepath, "r") as f:
        reader = csv.reader(f)
        header = next(reader)
        noise_levels = [float(n) for n in header[1:]]

        column_counts = []
        match_rates = []

        for row in reader:
            if not row[0]:
                continue
            column_counts.append(int(float(row[0])))
            match_rates.append([float(v) for v in row[1:]])

    return noise_levels, column_counts, np.array(match_rates)

def plot_heatmap_even(noise_levels, column_counts, match_rates, output_path="data/heatmap_even.png"):
    fig, ax = plt.subplots(figsize=(20, 8))

    im = ax.imshow(match_rates, cmap="RdYlGn", vmin=0, vmax=1, aspect="auto")

    ax.set_xticks(range(len(noise_levels)))
    ax.set_xticklabels([str(n) for n in noise_levels], rotation=45, ha="right")
    ax.set_yticks(range(len(column_counts)))
    ax.set_yticklabels([str(c) for c in column_counts])

    ax.set_xlabel("Noise Level")
    ax.set_ylabel("Number of Columns")
    ax.set_title("Match Rate by Column Count and Noise Level (Even Spacing)")

    # Add text annotations in each cell
    for i in range(len(column_counts)):
        for j in range(len(noise_levels)):
            val = match_rates[i, j]
            color = "white" if val < 0.5 else "black"
            ax.text(j, i, f"{val:.2f}", ha="center", va="center", color=color, fontsize=5)

    plt.colorbar(im, ax=ax, label="Match Rate")
    plt.tight_layout()
    plt.savefig(output_path, dpi=150)
    print(f"Even heatmap saved to {output_path}")

def plot_heatmap(noise_levels, column_counts, match_rates, output_path="data/heatmap.png"):
    fig, ax = plt.subplots(figsize=(14, 6))

    # Build edge arrays for pcolormesh (needs N+1 edges for N cells)
    noise_arr = np.array(noise_levels)
    col_arr = np.array(column_counts)

    # Create bin edges halfway between each value
    noise_edges = np.concatenate([[noise_arr[0] - (noise_arr[1] - noise_arr[0]) / 2],
        (noise_arr[:-1] + noise_arr[1:]) / 2,
        [noise_arr[-1] + (noise_arr[-1] - noise_arr[-2]) / 2]])

    col_edges = np.concatenate([[col_arr[0] - 0.5],
        (col_arr[:-1] + col_arr[1:]) / 2,
        [col_arr[-1] + 0.5]])

    im = ax.pcolormesh(noise_edges, col_edges, match_rates, cmap="RdYlGn", vmin=0, vmax=1)

    ax.set_xlabel("Noise Level")
    ax.set_ylabel("Number of Columns")
    ax.set_title("Match Rate by Column Count and Noise Level")
    ax.set_yticks(column_counts)
    ax.invert_yaxis()

    plt.colorbar(im, ax=ax, label="Match Rate")
    plt.tight_layout()
    plt.savefig(output_path, dpi=150)
    print(f"Heatmap saved to {output_path}")

def plot_line_chart(noise_levels, column_counts, match_rates, output_path="data/line_chart.png"):
    fig, ax = plt.subplots(figsize=(10, 6))

    for i, n_cols in enumerate(column_counts):
        ax.plot(noise_levels, match_rates[i], marker="o", label=f"{n_cols} columns", linewidth=2, markersize=4)

    ax.set_xlabel("Noise Level")
    ax.set_ylabel("Match Rate")
    ax.set_title("Match Rate Degradation by Noise Level")
    ax.legend()
    ax.set_ylim(-0.05, 1.05)
    ax.grid(True, alpha=0.3)

    plt.tight_layout()
    plt.savefig(output_path, dpi=150)
    print(f"Line chart saved to {output_path}")

if __name__ == "__main__":
    noise_levels, column_counts, match_rates = load_results("data/experiment_results.csv")
    plot_heatmap_even(noise_levels, column_counts, match_rates)
    plot_heatmap(noise_levels, column_counts, match_rates)
    plot_line_chart(noise_levels, column_counts, match_rates)