"""Backtest: compare model results with papers and records.

    python validation/backtest.py

Just as a trading backtest 'checks a strategy on past data', this checks whether the model reproduces
known theoretical and experimental values. If a check fails, do not trust results in that area.
Results are also saved to outputs/backtest_report.md.
"""
import os
import sys
import time

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from perolab import (SubCell, simulate, sq_limit, MA_I_BR, SegregationParams,  # noqa: E402
                     SegregationSim, segregation_impact)
from perolab.materials import noh_2013  # noqa: E402
from perolab.spectra import solar_spectrum, total_power  # noqa: E402

rows = []


def check(area, name, value, lo, hi, ref, unit=""):
    ok = lo <= value <= hi
    rows.append((area, name, value, lo, hi, ref, unit, ok))
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {area:11s} {name:46s} {value:9.3f}{unit}  (range {lo}~{hi})  ← {ref}")


t0 = time.time()
print("\n=== 1. Spectra ===")
E, phi = solar_spectrum("AM1.5G")
check("Light", "AM1.5G total power", total_power(E, phi), 990, 1010, "ASTM G-173: 1000 W/m²", " W/m²")
E, phi = solar_spectrum("AM0")
check("Light", "AM0 total power", total_power(E, phi), 1330, 1370,
      "G-173 extraterrestrial 1348 / ASTM E-490 1366 W/m²", " W/m²")

print("\n=== 2. Materials: composition -> band gap ===")
xs = np.linspace(0, 1, 101)
err = float(np.max(np.abs(MA_I_BR.bandgap(xs) - noh_2013(xs))))
check("Material", "MAPb(I,Br)3 vs Noh 2013 max error", err, 0, 0.005, "Noh et al. Nano Lett. 2013", " eV")
from perolab import PB_SN, FACS_I_BR  # noqa: E402
check("Material", "Pb0.5Sn0.5 band gap", PB_SN.bandgap(0.5), 1.22, 1.28,
      "standard all-perovskite bottom cell ~1.25 eV", " eV")
check("Material", "FA-Cs Br 40% band gap", FACS_I_BR.bandgap(0.4), 1.72, 1.80,
      "I:Br=60:40 → ~1.75 eV (Fraunhofer 2025)", " eV")

print("\n=== 3. Device: theoretical limits (detailed balance) ===")
check("Device", "SQ limit @1.34 eV", sq_limit(1.34), 33.4, 34.0, "Rühle 2016: 33.7%", "%")
egs = np.arange(1.25, 1.45, 0.005)
v = [sq_limit(e) for e in egs]
check("Device", "SQ optimum band gap", float(egs[int(np.argmax(v))]), 1.32, 1.36, "1.34 eV", " eV")
best = max((simulate([SubCell(eg=t, ideal=True), SubCell(eg=b, ideal=True)])["total"].pce, t, b)
           for t in np.arange(1.55, 1.75, 0.02) for b in np.arange(0.90, 1.05, 0.02))
check("Device", "2T 2-junction max efficiency (free gaps)", best[0], 45.0, 46.5,
      "detailed-balance literature ~45.7% (≈1.63/0.96 eV)", "%")
b125 = max(simulate([SubCell(eg=t, ideal=True), SubCell(eg=1.25, ideal=True)])["total"].pce
           for t in np.arange(1.7, 2.0, 0.01))
check("Device", "All-perovskite 2J limit (bottom 1.25 eV)", b125, 41.5, 44.5, "literature ~43-44%", "%")

print("\n=== 4. Device: realistic cells vs actual records ===")
r = simulate([SubCell(eg=1.55, thickness_nm=600, ere=1e-3)])["total"]
check("Device", "Single 1.55 eV (ERE 1e-3) efficiency", r.pce, 24.5, 28.0, "certified record ~26-27%", "%")
check("Device", "Single 1.55 eV Voc", r.voc, 1.05, 1.22, "record cells 1.15-1.20 V", " V")
r = simulate([SubCell(eg=1.77, thickness_nm=300, ere=1e-4),
              SubCell(eg=1.25, thickness_nm=1100, ere=1e-3)])["total"]
check("Device", "All-perovskite 2J efficiency (no segregation)", r.pce, 28.0, 34.0,
      "record 30.3% (CAS) - extra losses not in model", "%")

print("\n=== 5. Halide segregation ===")
final = {}
for xb in [0.10, 0.20, 0.40, 0.60]:
    s = SegregationSim(SegregationParams(x_br=xb, grid=64))
    s.run(300, n_snap=20)
    final[xb] = s
shift = {xb: 1000 * (s.history[0]["pl_peak_eV"] - s.history[-1]["pl_peak_eV"]) for xb, s in final.items()}
check("Segregation", "Br 10%: PL shift (should not occur)", shift[0.10], -10, 10, "Hoke 2015: stable for x<0.2", " meV")
check("Segregation", "Br 40%: PL shift (should occur)", shift[0.40], 50, 250,
      "experiments ~80-200 meV red shift", " meV")
check("Segregation", "Br 60%: PL shift (should occur)", shift[0.60], 50, 300, "Hoke 2015: 1.88->~1.68 eV", " meV")
check("Segregation", "Br 40%: I-rich domain composition", final[0.40].history[-1]["x_min"], 0.05, 0.25,
      "I-rich phase near x≈0.2", "")
s = final[0.40]
imp = segregation_impact(s, SubCell(eg=1.77, thickness_nm=300, ere=1e-4))
check("Segregation", "1.77 eV cell Voc loss", -imp["dvoc_mV"], 30, 200, "reported tens to 150 mV", " mV")
s.set_light(0)
s.run(1800, n_snap=5)
check("Segregation", "segregation left after 30 min dark (std)", s.history[-1]["x_std"], 0, 0.01,
      "experiment: reversible recovery in the dark", "")
c = SegregationSim(SegregationParams(x_br=0.40, grid=64))
c.run(300, n_snap=5)
c.set_light(0); c.set_temperature(173)
c.run(1800, n_snap=5)
check("Segregation", "segregation after 30 min dark at -100°C (std)", c.history[-1]["x_std"], 0.08, 1,
      "ions frozen at low temperature, recovery stops", "")
lo_i = SegregationSim(SegregationParams(x_br=0.40, grid=64, intensity_suns=0.1))
lo_i.run(300, n_snap=5)
d_lo = 1000 * (lo_i.history[0]["pl_peak_eV"] - lo_i.history[-1]["pl_peak_eV"])
check("Segregation", "PL shift at 0.1 sun smaller than at 1 sun", float(d_lo < shift[0.40]), 1, 1,
      "intensity dependence (threshold intensity exists)", "")

n_ok = sum(r[-1] for r in rows)
print(f"\nResult: {n_ok}/{len(rows)} passed  ({time.time()-t0:.0f} s)")

out = os.path.join(ROOT, "outputs")
os.makedirs(out, exist_ok=True)
with open(os.path.join(out, "backtest_report.md"), "w") as f:
    f.write(f"# Backtest result: {n_ok}/{len(rows)} passed\n\n")
    f.write("| Area | Check | Model | Allowed range | Reference (paper, record) | Result |\n|---|---|---|---|---|---|\n")
    for area, name, val, lo, hi, ref, unit, ok in rows:
        f.write(f"| {area} | {name} | {val:.3f}{unit} | {lo}~{hi} | {ref} | {'✅' if ok else '❌'} |\n")
print("  -> saved: outputs/backtest_report.md")
sys.exit(0 if n_ok == len(rows) else 1)
