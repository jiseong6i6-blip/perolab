"""Experiment 2: single-junction cell - how band gap, non-radiative loss (ERE) and thickness affect efficiency.

    python examples/02_single_junction.py --eg 1.55 --ere 1e-3 --thickness 600
"""
import argparse

import numpy as np

from _common import plt, save, COLORS
from perolab import SubCell, simulate, sq_limit

ap = argparse.ArgumentParser()
ap.add_argument("--eg", type=float, default=1.55)
ap.add_argument("--ere", type=float, default=1e-3)
ap.add_argument("--thickness", type=float, default=600)
ap.add_argument("--spectrum", default="AM1.5G", choices=["AM1.5G", "AM0"])
args = ap.parse_args()

cell = SubCell(eg=args.eg, ere=args.ere, thickness_nm=args.thickness)
r = simulate([cell], args.spectrum)["total"]
print(f"\n[{args.spectrum}] Eg {args.eg} eV, thickness {args.thickness} nm, ERE {args.ere:g}")
print(f"  Jsc {r.jsc:.2f} mA/cm²  Voc {r.voc:.3f} V  FF {r.ff*100:.1f}%  PCE {r.pce:.2f}%")
print(f"  SQ limit at the same band gap: {sq_limit(args.eg, args.spectrum):.2f}%")

egs = np.linspace(1.15, 2.1, 30)
fig, ax = plt.subplots(1, 2, figsize=(10, 4))
ax[0].plot(egs, [sq_limit(e, args.spectrum) for e in egs], "k--", label="SQ limit")
for ere, c in zip([1e-1, 1e-2, 1e-3, 1e-4], COLORS):
    pce = [simulate([SubCell(eg=e, ere=ere, thickness_nm=args.thickness)], args.spectrum)["total"].pce for e in egs]
    ax[0].plot(egs, pce, color=c, label=f"ERE {ere:g}")
ax[0].set(xlabel="Bandgap (eV)", ylabel="PCE (%)", title=f"Single junction ({args.spectrum})")
ax[0].legend(fontsize=8)
ax[1].plot(r.v, r.j, color=COLORS[0])
ax[1].set(xlim=(0, r.voc * 1.05), ylim=(0, r.jsc * 1.1), xlabel="Voltage (V)",
          ylabel="Current density (mA/cm²)", title=f"J-V  PCE {r.pce:.1f}%")
save(fig, "02_single_junction.png")
