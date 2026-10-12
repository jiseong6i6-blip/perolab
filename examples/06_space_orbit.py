"""Experiment 6: segregation in orbit - does the cell recover during eclipse?

Orbit scenarios (simplified):
  * LEO     : about 60 min sun / 35 min eclipse, eclipse temperature -100°C (173 K), sunlit +60°C
  * LEO-warm: same orbit but room temperature in eclipse (for comparison, the 'recovers' case)
  * SSO     : dawn-dusk orbit, almost no eclipse (continuous sun)
Sun intensity about 1.36 sun (AM0).

    python examples/06_space_orbit.py --orbits 4
"""
import argparse

import numpy as np

from _common import plt, save, COLORS
from perolab import SegregationParams, SegregationSim

ap = argparse.ArgumentParser()
ap.add_argument("--orbits", type=int, default=4)
ap.add_argument("--x-br", type=float, default=0.40)
ap.add_argument("--grid", type=int, default=64)
args = ap.parse_args()

AM0_SUNS = 1.36
scenarios = {
    "LEO (dark -100°C)": dict(sun_min=60, dark_min=35, t_sun=333, t_dark=173),
    "LEO (dark kept 25°C)": dict(sun_min=60, dark_min=35, t_sun=333, t_dark=298),
    "dawn-dusk SSO (no eclipse)": dict(sun_min=95, dark_min=0, t_sun=333, t_dark=333),
}

fig, ax = plt.subplots(figsize=(9, 4.5))
print()
for (name, sc), c in zip(scenarios.items(), COLORS):
    sim = SegregationSim(SegregationParams(x_br=args.x_br, intensity_suns=AM0_SUNS,
                                           temperature_K=sc["t_sun"], grid=args.grid))
    for _ in range(args.orbits):
        sim.set_light(AM0_SUNS); sim.set_temperature(sc["t_sun"])
        sim.run(sc["sun_min"] * 60, n_snap=20)
        if sc["dark_min"]:
            sim.set_light(0); sim.set_temperature(sc["t_dark"])
            sim.run(sc["dark_min"] * 60, n_snap=10)
    t = np.array([h["t"] for h in sim.history]) / 60
    pl = np.array([h["pl_peak_eV"] for h in sim.history])
    ax.plot(t, pl, color=c, label=name)
    print(f"  {name:28s}: final PL peak {pl[-1]:.3f} eV (initial {pl[0]:.3f}), "
          f"lowest {pl.min():.3f}")
ax.set(xlabel="time (min)", ylabel="PL peak (eV)  — lower = more segregated",
       title=f"Orbit cycles, Br {args.x_br}, AM0 {AM0_SUNS} sun")
ax.legend()
save(fig, "06_space_orbit.png")
