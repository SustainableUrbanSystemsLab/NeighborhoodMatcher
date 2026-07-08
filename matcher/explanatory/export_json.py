"""
Exports the five explanatory scenarios as JSON for the webapp's
"How it works" page, which renders them as native HTML/SVG instead of
embedded PDFs.

Run from matcher/ after changing a scenario:

    uv run --project . python explanatory/export_json.py

Writes webapp/src/data/scenarios.json (checked in — the scenarios are
static teaching content, not build output).
"""

import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import numpy as np

from explanatory.scenarios import (  # noqa: E402
    exact_match,
    rounding_discrepancy,
    scale_mismatch,
    ambiguous_match,
    mnn_not_confirmed,
)

SCENARIOS = [
    exact_match,
    rounding_discrepancy,
    scale_mismatch,
    ambiguous_match,
    mnn_not_confirmed,
]

# The explanation strings were written for the LaTeX/PDF pipeline. Convert
# the handful of constructs they use into plain text + **bold** markers the
# React page understands.
_MATH_REPLACEMENTS = [
    (r"\\geq", "≥"), (r"\\leq", "≤"), (r"\\div", "÷"), (r"\\times", "×"),
    (r"\\approx", "≈"), (r"\\neq", "≠"), (r"\\ldots", "…"), (r"\\dots", "…"),
    (r"\\sqrt", "√"), (r"\\pm", "±"), (r"\\%", "%"), (r"\\_", "_"),
    (r"\\,", " "), (r"\\;", " "), (r"\\ ", " "),
    (r"d_1", "d₁"), (r"d_2", "d₂"), (r"d_i", "dᵢ"), (r"\^2", "²"),
]


def _clean_text(s):
    # LaTeX thousands separator first — it nests inside \textbf{...} args
    # and would defeat the brace-matching below ("2{,}467" -> "2,467").
    s = s.replace("{,}", ",")
    # \textbf{...} / \emph{...} -> **...**, \texttt/\text -> bare content.
    # Iterate the whole rule set until stable so nested commands
    # (e.g. \textbf{Flags: \texttt{...}}) resolve inside-out.
    rules = ((r"\\texttt\{([^{}]*)\}", r"\1"),
             (r"\\text\{([^{}]*)\}", r"\1"),
             (r"\\textbf\{([^{}]*)\}", r"**\1**"),
             (r"\\emph\{([^{}]*)\}", r"**\1**"))
    prev = None
    while prev != s:
        prev = s
        for cmd, rep in rules:
            s = re.sub(cmd, rep, s)
    for pat, rep in _MATH_REPLACEMENTS:
        s = re.sub(pat, rep, s)
    # inline math delimiters -> nothing (content already unicode-converted)
    s = s.replace("$", "")
    # LaTeX dashes: em first, then range en-dash
    s = s.replace("---", "—")
    s = re.sub(r"(?<=[0-9%])--(?=[0-9])", "–", s)
    s = s.replace("--", "—")
    # any straggler backslash command: keep its name as plain text
    s = re.sub(r"\\([A-Za-z]+)", r"\1", s)
    # stray braces left by unhandled constructs
    s = s.replace("{", "").replace("}", "")
    return re.sub(r"\s+", " ", s).strip()


def _jsonable(obj):
    if isinstance(obj, dict):
        return {k: _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return _jsonable(obj.tolist())
    if isinstance(obj, (np.floating, float)):
        f = float(obj)
        return round(f, 6)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    if isinstance(obj, str):
        return _clean_text(obj)
    return obj


def main():
    out = []
    for module in SCENARIOS:
        data = module.build_scenario()
        data = _jsonable(data)
        out.append(data)

    dest = os.path.join(
        os.path.dirname(__file__), "..", "..", "webapp", "src", "data", "scenarios.json"
    )
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w") as f:
        json.dump(out, f, indent=1)
    print(f"wrote {len(out)} scenarios -> {os.path.relpath(dest)}")


if __name__ == "__main__":
    main()
