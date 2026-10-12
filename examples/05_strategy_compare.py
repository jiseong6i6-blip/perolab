"""Experiment 5: strategies against segregation -> tandem efficiency loss.

Strategies used in recent papers are expressed as parameters and compared under the same conditions (1 sun, 10 min).
After each strategy the top cell (1.77 eV) is put in a 2-junction tandem (bottom 1.25 eV) to compute the Voc and efficiency loss.

Two things are looked at separately:
  * speed t½ : time for segregation to go halfway -> vacancy and grain-boundary strategies mainly change this
  * end point: final loss under continued light -> set by Ω, carrier density and Br fraction

    python examples/05_strategy_compare.py --minutes 10
"""
import argparse
from dataclasses import replace

import numpy as np

from _common import plt, save, COLORS
from perolab import SegregationParams, SegregationSim, SubCell, segregation_impact

ap = argparse.ArgumentParser()
ap.add_argument("--minutes", type=float, default=10)
ap.add_argument("--suns", type=float, default=1.0)
ap.add_argument("--grid", type=int, default=64)
args = ap.parse_args()

base = SegregationParams(x_br=0.40, intensity_suns=args.suns, grid=args.grid)
strategies = {
    "baseline": {},
    "fill vacancies (SCN-type)": {"vacancy_ratio": 0.2},
    "passivate grain boundaries": {"gb_passivation": 0.9, "vacancy_ratio": 0.6},
    "bigger grains (600 nm)": {"grain_size_nm": 600},
    "relax strain (lower Ω)": {"omega_eV": 0.020},
    "fast extraction (MPP)": {"carrier_lifetime_ns": 300},
    "less Br + Cl (x=0.30)": {"x_br": 0.30},
    "combined": {"vacancy_ratio": 0.2, "gb_passivation": 0.9, "carrier_lifetime_ns": 300},
}

top = SubCell(eg=1.77, thickness_nm=300, ere=1e-4)
bottom = SubCell(eg=1.25, thickness_nm=1100, ere=1e-3)

def t_half(sim):
    """Time for the PL shift to reach half its final value (segregation 'speed')."""
    t = np.array([h["t"] for h in sim.history])
    pl = np.array([h["pl_peak_eV"] for h in sim.history])
    shift = pl[0] - pl
    if shift[-1] < 0.005:
        return float("nan")
    return float(np.interp(0.5 * shift[-1], shift, t))


print(f"\n{'Strategy':30s} {'t½ (speed)':>9s} {'PL shift':>8s} {'ΔVoc':>8s} {'Tandem PCE':>14s}")
results = []
for name, mod in strategies.items():
    p = replace(base, **mod)
    sim = SegregationSim(p)
    sim.run(args.minutes * 60, n_snap=300)
    h0, h1 = sim.history[0], sim.history[-1]
    imp = segregation_impact(sim, top, stack=[top, bottom], index=0)
    shift = 1000 * (h1["pl_peak_eV"] - h0["pl_peak_eV"])
    th = t_half(sim)
    if np.isnan(th):
        th = args.minutes * 60  # segregation does not even start within the time
    results.append((name, shift, imp["dvoc_mV"], imp["pce_before"], imp["pce_after"], th))
    mark = ">" if th >= args.minutes * 60 else " "
    print(f"{name:30s} {mark}{th:7.1f}s {shift:+7.0f}meV {imp['dvoc_mV']:+7.0f}mV "
          f"{imp['pce_before']:5.2f}→{imp['pce_after']:5.2f}%")

fig, ax = plt.subplots(1, 2, figsize=(12, 4.5), sharey=True)
names = [r[0] for r in results]
dv = [r[2] for r in results]
th = [r[5] for r in results]
ax[0].barh(names[::-1], th[::-1], color=COLORS[0])
ax[0].set(xlabel="t½ — time to half segregation (s)  [higher = slower]",
          title="Speed (kinetics)", xscale="log")
ax[1].barh(names[::-1], dv[::-1], color=[COLORS[1] if v < -80 else COLORS[2] for v in dv[::-1]])
ax[1].set(xlabel=f"Tandem Voc change after {args.minutes:.0f} min (mV)",
          title=f"Voltage loss ({args.suns} sun)")
ax[1].axvline(0, color="k", lw=0.8)
save(fig, "05_strategies.png")
