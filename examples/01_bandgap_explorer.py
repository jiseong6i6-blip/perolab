"""Experiment 1: composition -> band gap.

    python examples/01_bandgap_explorer.py --target 1.77
Give a target band gap and get the Br fraction / Sn fraction needed.
"""
import argparse

import numpy as np

from _common import plt, save, COLORS
from perolab import MA_I_BR, FACS_I_BR, PB_SN

ap = argparse.ArgumentParser()
ap.add_argument("--target", type=float, nargs="*", default=[1.25, 1.55, 1.77, 1.95])
args = ap.parse_args()

f = np.linspace(0, 1, 201)
fig, ax = plt.subplots(1, 2, figsize=(10, 4))
for m, c in zip([MA_I_BR, FACS_I_BR], COLORS):
    ax[0].plot(f, m.bandgap(f), color=c, label=m.name)
ax[0].set(xlabel="Br fraction x", ylabel="Bandgap (eV)", title="I/Br mixing (top-cell side)")
ax[0].legend()
ax[1].plot(f, PB_SN.bandgap(f), color=COLORS[2], label=PB_SN.name)
i = np.argmin(PB_SN.bandgap(f))
ax[1].scatter([f[i]], [PB_SN.bandgap(f[i])], color=COLORS[2], zorder=3)
ax[1].annotate(f"min {PB_SN.bandgap(f[i]):.2f} eV @ Sn {f[i]:.2f}", (f[i], PB_SN.bandgap(f[i])),
               textcoords="offset points", xytext=(5, 10))
ax[1].set(xlabel="Sn fraction y", ylabel="Bandgap (eV)", title="Pb/Sn mixing (bottom-cell side)")
ax[1].legend()
save(fig, "01_bandgap.png")

print("\nTarget band gap -> composition needed")
for eg in args.target:
    if eg >= FACS_I_BR.eg_a:
        x = FACS_I_BR.fraction_for(eg)
        print(f"  {eg:.2f} eV : FA0.8Cs0.2Pb(I1-xBrx)3, Br x = {x:.2f}")
    else:
        y = PB_SN.fraction_for(eg)
        print(f"  {eg:.2f} eV : Pb1-ySnyI3, Sn y = {y:.2f}  (minimum {PB_SN.bandgap(f).min():.2f} eV)")
