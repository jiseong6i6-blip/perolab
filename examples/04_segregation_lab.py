"""Experiment 4: halide segregation - light on, then off (segregation -> recovery).

    python examples/04_segregation_lab.py --x-br 0.4 --suns 1 --light-s 300 --dark-s 1800
    python examples/04_segregation_lab.py --x-br 0.4 --vacancy 0.2      # fewer vacancies
    python examples/04_segregation_lab.py --x-br 0.4 --dark-temp 173    # space eclipse (-100°C)

Output: composition-map snapshots, PL peak shift curve, segregation-degree curve
"""
import argparse

import numpy as np

from _common import plt, save, COLORS
from perolab import SegregationParams, SegregationSim

ap = argparse.ArgumentParser()
ap.add_argument("--x-br", type=float, default=0.40)
ap.add_argument("--suns", type=float, default=1.0)
ap.add_argument("--temp", type=float, default=300.0)
ap.add_argument("--dark-temp", type=float, default=None, help="temperature during the dark period (default: same)")
ap.add_argument("--light-s", type=float, default=300.0)
ap.add_argument("--dark-s", type=float, default=1800.0)
ap.add_argument("--vacancy", type=float, default=1.0)
ap.add_argument("--gb-passivation", type=float, default=0.0)
ap.add_argument("--grain", type=float, default=150.0)
ap.add_argument("--omega", type=float, default=0.040)
ap.add_argument("--lifetime-ns", type=float, default=1000.0)
ap.add_argument("--grid", type=int, default=96)
ap.add_argument("--tag", default="")
args = ap.parse_args()

p = SegregationParams(x_br=args.x_br, intensity_suns=args.suns, temperature_K=args.temp,
                      vacancy_ratio=args.vacancy, gb_passivation=args.gb_passivation,
                      grain_size_nm=args.grain, omega_eV=args.omega,
                      carrier_lifetime_ns=args.lifetime_ns, grid=args.grid)
sim = SegregationSim(p)
print(f"\nComposition Br {p.x_br}, initial band gap {p.material.bandgap(p.x_br):.3f} eV, effective carriers {sim.n_avg:.2e}/FU")

snaps = [("start", sim.x.copy())]
sim.run(args.light_s, n_snap=60)
t_light_end = sim.t
snaps.append((f"light {args.light_s:.0f}s", sim.x.copy()))
h = sim.history[-1]
print(f"  after {args.light_s:.0f}s light: PL peak {h['pl_peak_eV']:.3f} eV "
      f"(shift {1000*(h['pl_peak_eV']-sim.history[0]['pl_peak_eV']):+.0f} meV), "
      f"I-rich area {h['i_rich_frac']*100:.1f}%, minimum Br {h['x_min']:.2f}")

sim.set_light(0.0)
if args.dark_temp:
    sim.set_temperature(args.dark_temp)
sim.run(args.dark_s, n_snap=60)
snaps.append((f"dark {args.dark_s:.0f}s", sim.x.copy()))
h = sim.history[-1]
print(f"  after {args.dark_s:.0f}s dark: PL peak {h['pl_peak_eV']:.3f} eV, composition std {h['x_std']:.3f}")

t = np.array([q["t"] for q in sim.history])
pl = np.array([q["pl_peak_eV"] for q in sim.history])
sd = np.array([q["x_std"] for q in sim.history])

fig = plt.figure(figsize=(11, 6.5), layout="constrained")
gs = fig.add_gridspec(2, 3)
for k, (name, x) in enumerate(snaps):
    a = fig.add_subplot(gs[0, k])
    im = a.imshow(x, cmap="coolwarm", vmin=0, vmax=min(1, 2 * p.x_br),
                  extent=[0, p.grid * p.dx_nm] * 2)
    if k == 0 and sim.gb.any():
        a.contour(sim.gb, levels=[0.5], colors="k", linewidths=0.3, alpha=0.4,
                  extent=[0, p.grid * p.dx_nm] * 2, origin="upper")
    a.set_title(f"Br fraction — {name}", fontsize=9)
    a.set_xlabel("nm"); a.grid(False)
fig.colorbar(im, ax=fig.axes[:3], shrink=0.8, label="Br fraction (blue = I-rich)")
a = fig.add_subplot(gs[1, :2])
a.plot(t, pl, color=COLORS[0])
a.axvspan(0, t_light_end, color="#f4c542", alpha=0.15, label="light on")
a.set(xlabel="time (s)", ylabel="PL peak (eV)", title="PL red-shift and dark recovery")
a.legend()
a = fig.add_subplot(gs[1, 2])
a.plot(t, sd, color=COLORS[1])
a.axvspan(0, t_light_end, color="#f4c542", alpha=0.15)
a.set(xlabel="time (s)", ylabel="std of Br fraction", title="Segregation degree")
save(fig, f"04_segregation{args.tag}.png")
