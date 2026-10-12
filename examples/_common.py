"""Shared by the examples: output folder, plot style, package path."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

OUT = os.path.join(ROOT, "outputs")
os.makedirs(OUT, exist_ok=True)

import warnings
warnings.filterwarnings("ignore", message="Glyph .* missing")
# fonts: plain sans-serif (all labels are English)
plt.rcParams["font.family"] = ["DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False
plt.rcParams.update({
    "figure.dpi": 120, "savefig.dpi": 150, "font.size": 10,
    "axes.spines.top": False, "axes.spines.right": False,
    "axes.grid": True, "grid.alpha": 0.25,
})
COLORS = ["#2a6fdb", "#e0663a", "#1f9e77", "#8e5bd8", "#c23b6b", "#6b7280"]


def save(fig, name):
    path = os.path.join(OUT, name)
    if fig.get_layout_engine() is None:
        fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)
    print(f"  -> saved: outputs/{name}")
    return path
