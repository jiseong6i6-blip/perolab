"""Experiment 8: environment bench - the same cell in air / N2 / Ar / vacuum, with and without encapsulation, and in orbit: lifetime comparison.

    python examples/08_environment_lab.py
"""
from dataclasses import replace

import numpy as np

from _common import plt, save, COLORS
from dataclasses import replace

from perolab.environment import Conditions, simulate_aging, space_conditions
from perolab.fabrication import PRESET_RECIPES, build_cell

cell = build_cell(PRESET_RECIPES["Record p-i-n (FA-Cs, SAM/LiF-C60)"])
mapi = build_cell(PRESET_RECIPES["Classic MAPbI3 (n-i-p, Spiro)"])
scen = {
    "Air 25 °C 50% RH, unencapsulated": Conditions(atmosphere="air", rh_pct=50, temp_C=25, suns=1, hours=2000),
    "N2 glovebox 25 °C": Conditions(atmosphere="n2_glovebox", temp_C=25, suns=1, hours=2000),
    "Ar glovebox 25 °C": Conditions(atmosphere="ar_glovebox", temp_C=25, suns=1, hours=2000),
    "Damp heat 85/85, glass": Conditions(atmosphere="air", rh_pct=85, temp_C=85, suns=0, encapsulation="glass_glass_pib", hours=2000),
    "Outdoor 45 °C 1 sun, glass": Conditions(atmosphere="air", rh_pct=60, temp_C=45, suns=1, encapsulation="glass_glass_pib", hours=20000),
    "Space LEO 1 yr, thin film": space_conditions("leo", 8766),
    "Space GEO 1 yr, thin film": space_conditions("geo", 8766),
}
# intrinsic (ion/interface) degradation speed: 1 = average 2014-2020 paper cell, 0.05 = certified-grade recent cell.
# The record FA-Cs cell is treated as certified-grade, the classic MAPbI3 cell as average (same choice as the web lab's 'auto').
Q_RECORD = 0.05
print(f"\n{'Condition':34s} {'FA-Cs T80':>12s} {'MAPbI3 T80':>12s}   dominant pathway (FA-Cs)")
fig, ax = plt.subplots(1, 2, figsize=(11, 4.2))
for (name, c), col in zip(scen.items(), COLORS + ["#444"]):
    a = simulate_aging(cell.stack, replace(c, intrinsic_scale=Q_RECORD))
    b = simulate_aging(mapi.stack, c)
    top = max(a["share"], key=a["share"].get)
    f = lambda v: "> period" if not np.isfinite(v) else (f"{v:,.0f} h" if v >= 1 else f"{v*60:.0f} min")
    print(f"{name:34s} {f(a['t80_h']):>12s} {f(b['t80_h']):>12s}   {top}")
    ax[0].plot(a["t_h"][1:], a["retention"][1:] * 100, color=col, label=name)
ax[0].set(xscale="log", xlabel="time (h)", ylabel="PCE retained (%)", title="FA-Cs p-i-n cell", ylim=(0, 102))
ax[0].axhline(80, color="k", lw=0.6, ls="--")
ax[0].legend(fontsize=7)
names = list(scen)
shares = [simulate_aging(cell.stack, replace(scen[n], intrinsic_scale=Q_RECORD))["share"] for n in names]
mechs = list(shares[0])
left = np.zeros(len(names))
for m, col in zip(mechs, COLORS + ["#999", "#333", "#d4a017", "#17becf"]):
    v = np.array([s[m] for s in shares])
    ax[1].barh(range(len(names)), v, left=left, color=col, label=m)
    left += v
ax[1].set_yticks(range(len(names)), [n.split(",")[0] for n in names], fontsize=7)
ax[1].set(xlabel="share of total damage", title="Which mechanism dominates")
ax[1].legend(fontsize=6, loc="lower right")
save(fig, "08_environment.png")
