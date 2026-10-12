"""Experiment 7: fabrication bench - how film and device change with the recipe.

    python examples/07_fabrication_lab.py
    python examples/07_fabrication_lab.py --preset "Classic MAPbI3 (n-i-p, Spiro)" --anneal 150

See Recipe in perolab/fabrication.py for all recipe fields. Here: preset comparison + anneal-temperature scan.
"""
import argparse
from dataclasses import replace

import numpy as np

from _common import plt, save, COLORS
from perolab.fabrication import PRESET_RECIPES, build_cell

ap = argparse.ArgumentParser()
ap.add_argument("--preset", default="Record p-i-n (FA-Cs, SAM/LiF-C60)")
ap.add_argument("--anneal", type=float, default=None)
args = ap.parse_args()

print(f"\n{'Preset':42s} {'Eg':>6s} {'Grain':>6s} {'Life':>7s} {'Voc':>6s} {'Jsc':>6s} {'FF':>5s} {'PCE':>6s}")
for name, r in PRESET_RECIPES.items():
    c = build_cell(r)
    print(f"{name:42s} {c.eg:6.3f} {c.grain_nm:5.0f}n {c.tau_ns:6.0f}n {c.voc:6.3f} {c.jsc:6.1f} {c.ff:5.3f} {c.pce:6.2f}")

r = PRESET_RECIPES[args.preset]
if args.anneal:
    r = replace(r, anneal_C=args.anneal)
c = build_cell(r)
print(f"\n[{args.preset}] tolerance factor {c.tolerance:.3f}, coverage {c.coverage*100:.1f}%, defects {c.trap_cm3:.2e} cm⁻³, ERE {c.ere:.1e}")
for w in c.warnings:
    print("  ⚠", w)
for n in c.notes:
    print("  ·", n)

temps = np.arange(60, 181, 5)
fig, ax = plt.subplots(1, 2, figsize=(10, 4))
for (name, rr), col in zip(list(PRESET_RECIPES.items())[:3], COLORS):
    pce = [build_cell(replace(rr, anneal_C=float(T))).pce for T in temps]
    dec = [build_cell(replace(rr, anneal_C=float(T))).decomposed * 100 for T in temps]
    ax[0].plot(temps, pce, color=col, label=name.split(" (")[0])
    ax[1].plot(temps, dec, color=col)
ax[0].set(xlabel="Anneal temperature (°C), 30 min", ylabel="PCE (%)", title="Anneal window")
ax[0].legend(fontsize=8)
ax[1].set(xlabel="Anneal temperature (°C)", ylabel="Decomposed to PbI2 (%)", title="Over-annealing", yscale="log", ylim=(1e-3, 100))
save(fig, "07_fabrication.png")
