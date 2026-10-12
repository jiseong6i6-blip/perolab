"""Experiment 9: ion migration and J-V hysteresis - drift-diffusion solver (IonMonger equations).

    python examples/09_ion_hysteresis.py --rate 0.1            # 100 mV/s
    python examples/09_ion_hysteresis.py --rate 0.1 --N0 1.6e24 # 1/10 of the ions
    python examples/09_ion_hysteresis.py --from-cell            # use the ion values of the default fabrication cell

Procedure: ion equilibrium at 1.2 V -> hold 5 s -> reverse 1.2->0 V -> forward 0->1.2 V (same as the IonMonger example).
One run takes tens of seconds.
"""
import argparse
from dataclasses import replace

import numpy as np

from _common import plt, save, COLORS
from perolab.ionic import IonicDevice, IonicSolver, hysteresis_scan, hysteresis_index

ap = argparse.ArgumentParser()
ap.add_argument("--rate", type=float, default=0.1)
ap.add_argument("--N0", type=float, default=None, help="mobile vacancy density [m⁻³] (default 1.6e25)")
ap.add_argument("--T", type=float, default=298.0)
ap.add_argument("--from-cell", action="store_true")
args = ap.parse_args()

d = replace(IonicDevice(), T=args.T)
if args.N0:
    d = replace(d, N0=args.N0)
if args.from_cell:
    from perolab.fabrication import build_cell, Recipe
    c = build_cell(Recipe())
    d = replace(d, N0=c.ion_N0_cm3 * 1e6, EAI=c.ion_Ea_eV, b=c.recipe.thickness_nm * 1e-9)
    print(f"Fabrication cell: N0 {c.ion_N0_cm3:.2e} cm⁻³, Ea {c.ion_Ea_eV:.2f} eV, thickness {c.recipe.thickness_nm:.0f} nm")
print(f"Ion diffusivity {d.DI:.2e} m²/s, built-in voltage {d.Vbi:.2f} V")
rev, fwd = hysteresis_scan(d, args.rate)
hi, a, b = hysteresis_index(rev, fwd)
print(f"Reverse: Voc {a['voc']:.3f} V, FF {a['ff']:.3f}, PCE {a['pce']:.2f}%")
print(f"Forward: Voc {b['voc']:.3f} V, FF {b['ff']:.3f}, PCE {b['pce']:.2f}%")
print(f"Hysteresis index HI = {hi:.3f}  (0 = no hysteresis)")

fig, ax = plt.subplots(figsize=(6, 4))
ax.plot(rev[0], rev[1], color=COLORS[0], label="reverse (1.2→0 V)")
ax.plot(fwd[0], fwd[1], color=COLORS[1], label="forward (0→1.2 V)")
ax.set(xlim=(0, 1.2), ylim=(0, 25), xlabel="Voltage (V)", ylabel="J (mA/cm²)",
       title=f"{args.rate*1000:.0f} mV/s, T={args.T:.0f} K, HI={hi:.2f}")
ax.legend()
save(fig, "09_hysteresis.png")
