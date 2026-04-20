# NOTE: Human authorized
#
# Generates one PDF per scenario.
# Run from version-3/ with the project venv active:
#   python explanatory/build.py [scenario_label ...]
# Omit arguments to build all scenarios.

import os
import sys
import subprocess
import shutil
import tempfile

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import jinja2

HERE     = os.path.dirname(os.path.abspath(__file__))
OUT_DIR  = os.path.join(HERE, "output")
TEMPLATE = os.path.join(HERE, "template.tex.j2")

os.makedirs(OUT_DIR, exist_ok=True)

# ── Jinja2 environment with LaTeX-safe delimiters ────────────────────────────
env = jinja2.Environment(
    loader=jinja2.FileSystemLoader(HERE),
    block_start_string="<%",
    block_end_string="%>",
    variable_start_string="<<",
    variable_end_string=">>",
    comment_start_string="<#",
    comment_end_string="#>",
    trim_blocks=True,
    lstrip_blocks=True,
)


def _tex_escape(s):
    """Escape characters that LaTeX treats as special."""
    replacements = {
        "&":  r"\&",
        "%":  r"\%",
        "$":  r"\$",
        "#":  r"\#",
        "_":  r"\_",
        "{":  r"\{",
        "}":  r"\}",
        "~":  r"\textasciitilde{}",
        "^":  r"\textasciicircum{}",
        "\\": r"\textbackslash{}",
    }
    return "".join(replacements.get(c, c) for c in s)


def _fmt_val(val, col):
    """Format a raw numeric value per the column's format spec."""
    if col["fmt"] == "d":
        return f"{int(round(val)):,}"
    return f"{val:{col['fmt']}}"


# ── Histogram ────────────────────────────────────────────────────────────────

def build_histogram(supp_table, out_path):
    """Sorted bar chart of distances, best match highlighted."""
    ranks = [r["rank"] for r in supp_table]
    dists = [r["dist"]  for r in supp_table]
    colors = [
        "#4CAF50" if r["is_best"] else "#4472C4"
        for r in supp_table
    ]

    fig, ax = plt.subplots(figsize=(10, 4))
    max_dist = max(d for d in dists if d > 0) if any(d > 0 for d in dists) else 1.0

    # For zero-distance bars, draw a thin visible stub so the bar is rendered
    plot_dists = [d if d > 0 else max_dist * 0.015 for d in dists]
    bars = ax.bar(ranks, plot_dists, color=colors, edgecolor="white", linewidth=0.5)

    # Label the best-match bar
    best = next(r for r in supp_table if r["is_best"])
    annotate_y = plot_dists[best["rank"] - 1]
    ax.annotate(
        f"Best match\n(d = {best['dist']:.4f})",
        xy=(best["rank"], annotate_y),
        xytext=(best["rank"] + 1.4, max_dist * 0.30),
        fontsize=8,
        arrowprops=dict(arrowstyle="->", color="#333333", lw=0.8),
        color="#333333",
    )

    ax.set_xlabel("Candidate (sorted by distance, closest first)", fontsize=9)
    ax.set_ylabel("Standardized Distance", fontsize=9)
    ax.set_title("Distance from Target to Each of the 20 Candidates", fontsize=10, fontweight="bold")
    ax.set_xticks(ranks)
    ax.set_xticklabels([str(r) for r in ranks], fontsize=7)
    ax.tick_params(axis="y", labelsize=8)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

    legend_handles = [
        mpatches.Patch(color="#4CAF50", label="Selected match"),
        mpatches.Patch(color="#4472C4", label="Other candidates"),
    ]
    ax.legend(handles=legend_handles, fontsize=8, loc="upper left")

    plt.tight_layout()
    plt.savefig(out_path, format="pdf", bbox_inches="tight")
    plt.close(fig)


# ── Context builder ───────────────────────────────────────────────────────────

def build_context(data, histogram_path):
    """Convert scenario data dict into the template context dict."""
    columns = data["columns"]

    # Target row cells (LaTeX-formatted)
    target_cells = " & ".join(
        _fmt_val(v, c) for v, c in zip(data["target_raw"], columns)
    )

    # Supplemental table rows
    for row in data["supp_table"]:
        row["cells"] = " & ".join(
            _fmt_val(v, c) for v, c in zip(row["raw"], columns)
        )
        row["dist_fmt"] = f"{row['dist']:.4f}"

    # Worked example rows
    ex = data["example"]
    example_rows = []
    for i, col in enumerate(columns):
        example_rows.append({
            "display":    col["display"],
            "target_raw": _fmt_val(data["target_raw"][i], col),
            "cand_raw":   _fmt_val(ex["raw"][i], col),
            "mean":       f"{ex['raw_means'][i]:.2f}",
            "std":        f"{ex['raw_stds'][i]:.2f}",
            "z_target":   f"{ex['z_target'][i]:+.4f}",
            "z_cand":     f"{ex['z_example'][i]:+.4f}",
            "sq_diff":    f"{ex['sq_diffs'][i]:.4f}",
        })

    sq_sum      = float(np.sum(ex["sq_diffs"]))
    smd_fmt     = [f"{v:.4f}" for v in data["signals"]["smd"]]
    flags_tex   = _tex_escape(data["signals"]["flags"]) if data["signals"]["flags"] else ""

    # Per-feature contribution rows
    contribs = data["signals"].get("contributions", None)
    if contribs is not None and float(np.sum(contribs)) > 0:
        contrib_rows = [
            {"display": col["display"], "pct": f"{float(c)*100:.1f}\\%"}
            for col, c in zip(columns, contribs)
        ]
    else:
        contrib_rows = [
            {"display": col["display"], "pct": "n/a (perfect match)"}
            for col in columns
        ]

    # Signals formatted for display
    signals = {
        "euc_distance":    f"{data['signals']['euc_distance']:.4f}",
        "nndr":            f"{data['signals']['nndr']:.4f}",
        "near_miss_count": str(data["signals"]["near_miss_count"]),
        "mnn_confirmed":   "True" if data["signals"]["mnn_confirmed"] else "False",
        "repeats":         str(data["signals"]["repeats"]),
        "smd_fmt":         smd_fmt,
        "flags":           flags_tex,
    }

    # Multi-target table: if extra_target_rows supplied, show all targets with labels.
    extra = data.get("extra_target_rows", None)
    if extra:
        target_table_rows = [{"label": "Target A", "cells": target_cells}]
        for r in extra:
            cells = " & ".join(_fmt_val(v, c) for v, c in zip(r["raw"], columns))
            target_table_rows.append({"label": r["label"], "cells": cells})
    else:
        target_table_rows = None

    return {
        "scenario_title":       data["scenario_title"],
        "scenario_subtitle":    data["scenario_subtitle"],
        "description":          data["description"],
        "columns":              columns,
        "target_row_cells":     target_cells,
        "target_table_rows":    target_table_rows,
        "rounding_note":        data.get("rounding_note", None),
        "supp_table":           data["supp_table"],
        "example_rows":         example_rows,
        "example_sq_sum":       f"{sq_sum:.4f}",
        "example_distance":     f"{ex['distance']:.4f}",
        "histogram_path":       histogram_path,
        "contrib_rows":         contrib_rows,
        "signals":              signals,
        "signal_explanations":  data["signal_explanations"],
    }


# ── PDF compilation ───────────────────────────────────────────────────────────

def compile_pdf(tex_source, label):
    """Write .tex to a temp dir, run pdflatex twice, copy PDF to output/."""
    with tempfile.TemporaryDirectory() as tmp:
        tex_path = os.path.join(tmp, f"{label}.tex")
        with open(tex_path, "w") as f:
            f.write(tex_source)

        for _ in range(2):  # two passes for correct page numbers / refs
            result = subprocess.run(
                ["pdflatex", "-interaction=nonstopmode", f"{label}.tex"],
                cwd=tmp,
                capture_output=True,
                text=True,
            )

        pdf_tmp = os.path.join(tmp, f"{label}.pdf")
        if not os.path.exists(pdf_tmp):
            print(f"  [ERROR] pdflatex failed for {label}")
            print(result.stdout[-3000:])
            return None

        dest = os.path.join(OUT_DIR, f"{label}.pdf")
        shutil.copy(pdf_tmp, dest)
        return dest


# ── Scenario registry ─────────────────────────────────────────────────────────

def _load_scenarios():
    from explanatory.scenarios.exact_match          import build_scenario as exact_match
    from explanatory.scenarios.rounding_discrepancy import build_scenario as rounding_discrepancy
    from explanatory.scenarios.scale_mismatch       import build_scenario as scale_mismatch
    from explanatory.scenarios.ambiguous_match      import build_scenario as ambiguous_match
    from explanatory.scenarios.mnn_not_confirmed    import build_scenario as mnn_not_confirmed
    return {
        "exact_match":          exact_match,
        "rounding_discrepancy": rounding_discrepancy,
        "scale_mismatch":       scale_mismatch,
        "ambiguous_match":      ambiguous_match,
        "mnn_not_confirmed":    mnn_not_confirmed,
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def main(labels=None):
    scenarios = _load_scenarios()
    if labels:
        scenarios = {k: v for k, v in scenarios.items() if k in labels}

    template = env.get_template("template.tex.j2")

    for label, builder in scenarios.items():
        print(f"Building: {label} ...")
        data = builder()

        # Save histogram as PDF alongside the .tex (temp dir handles isolation)
        hist_path = os.path.join(OUT_DIR, f"{label}_hist.pdf")
        build_histogram(data["supp_table"], hist_path)

        ctx = build_context(data, hist_path)
        tex = template.render(**ctx)

        out = compile_pdf(tex, label)
        if out:
            print(f"  -> {out}")

    print("Done.")


if __name__ == "__main__":
    # Allow running as: python explanatory/build.py [label ...]
    sys.path.insert(0, os.path.join(HERE, ".."))
    sys.path.insert(0, os.path.join(HERE, "..", "src"))
    requested = sys.argv[1:] or None
    main(requested)
