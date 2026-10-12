"""Experiment 3: all-perovskite tandem design.

  (a) fix the Pb-Sn bottom cell (1.25 eV) and sweep the top band gap to find the 2-junction optimum
  (b) 2-junction vs 3-junction (terrestrial AM1.5G / space AM0)
Thicknesses are optimized so the currents match automatically.

    python examples/03_tandem_designer.py --bottom 1.25 --ere-top 1e-4
"""
import argparse

import numpy as np

from _common import plt, save, COLORS
from perolab import SubCell, simulate, optimize_thickness, FACS_I_BR, PB_SN

ap = argparse.ArgumentParser()
ap.add_argument("--bottom", type=float, default=1.25)
ap.add_argument("--ere", type=float, default=1e-3, help="ERE of middle and bottom cells")
ap.add_argument("--ere-top", type=float, default=1e-4,
                help="ERE of the wide-gap top cell (larger voltage loss in practice)")
ap.add_argument("--icl-loss", type=float, default=0.02, help="fraction of light lost per interconnecting layer")
args = ap.parse_args()

bottom = SubCell(eg=args.bottom, thickness_nm=1100, ere=args.ere, label="bottom")

print("\n(a) 2-junction top band-gap scan")
tops = np.linspace(1.62, 2.05, 18)
res = {"AM1.5G": [], "AM0": []}
for spec in res:
    for eg in tops:
        _, r = optimize_thickness([SubCell(eg=eg, thickness_nm=350, ere=args.ere_top), bottom],
                                  spec, icl_loss=args.icl_loss)
        res[spec].append(r["total"].pce)
for spec, v in res.items():
    i = int(np.argmax(v))
    x = FACS_I_BR.fraction_for(tops[i])
    print(f"  {spec}: best top {tops[i]:.2f} eV (Br {x:.2f}) -> {v[i]:.2f}%")

print("\n(b) 2-junction vs 3-junction")
rows = []
designs = {
    "2J 1.77/1.25": [SubCell(eg=1.77, thickness_nm=350, ere=args.ere_top), bottom],
    "3J 1.95/1.55/1.25": [SubCell(eg=1.95, thickness_nm=200, ere=args.ere_top),
                          SubCell(eg=1.55, thickness_nm=300, ere=args.ere), bottom],
    "3J 2.05/1.60/1.25": [SubCell(eg=2.05, thickness_nm=200, ere=args.ere_top),
                          SubCell(eg=1.60, thickness_nm=300, ere=args.ere), bottom],
}
for name, stack in designs.items():
    for spec in ["AM1.5G", "AM0"]:
        cells, r = optimize_thickness(stack, spec, icl_loss=args.icl_loss)
        t = r["total"]
        thick = "/".join(f"{c.thickness_nm:.0f}" for c in cells)
        rows.append((name, spec, t.pce))
        print(f"  {name:20s} {spec:6s} PCE {t.pce:5.2f}%  Voc {t.voc:.2f} V  "
              f"Jsc {t.jsc:5.2f}  thickness (nm) {thick}")

fig, ax = plt.subplots(1, 2, figsize=(10, 4))
for (spec, v), c in zip(res.items(), COLORS):
    ax[0].plot(tops, v, color=c, marker="o", ms=3, label=spec)
ax[0].set(xlabel="Top-cell bandgap (eV)", ylabel="PCE (%)",
          title=f"2J all-perovskite, bottom {args.bottom} eV")
ax[0].legend()
names = list(designs)
w = 0.38
for k, (spec, c) in enumerate(zip(["AM1.5G", "AM0"], COLORS)):
    vals = [p for n, s, p in rows if s == spec]
    ax[1].bar(np.arange(len(names)) + (k - 0.5) * w, vals, w, color=c, label=spec)
ax[1].set_xticks(range(len(names)), names, fontsize=8)
ax[1].set(ylabel="PCE (%)", title="2J vs 3J (thickness auto-matched)")
ax[1].legend()
save(fig, "03_tandem.png")
