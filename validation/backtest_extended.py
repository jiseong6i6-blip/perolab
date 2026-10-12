"""Extended backtest: fabrication model, environmental degradation model, ion drift-diffusion (hysteresis).

    python validation/backtest_extended.py        (the hysteresis part reads the result of validation/hysteresis_sweep.py)

Each check is labelled one of two ways.
  calibrated - constants were set to this number, so passing is expected (checks the model is wired correctly)
  predicted  - a real test: does a model set by other numbers 'hit' this value
Results are saved to outputs/backtest_extended.md and outputs/backtest_extended.json.
"""
import json
import os
import sys
from dataclasses import replace

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from perolab.fabrication import Recipe, build_cell, tolerance_factor, PRESET_RECIPES  # noqa: E402
from perolab.environment import StackSpec, Conditions, simulate_aging, space_conditions, radiation_retention  # noqa: E402
from perolab.ionic import IonicDevice, IonicSolver  # noqa: E402

rows = []


def check(area, kind, name, value, lo, hi, ref, unit=""):
    ok = bool(lo <= value <= hi)
    rows.append(dict(area=area, kind=kind, name=name, value=float(value), lo=lo, hi=hi, ref=ref, unit=unit, ok=ok))
    print(f"[{'PASS' if ok else 'FAIL'}] {area:4s} {kind:10s} {name:46s} {value:10.4g}{unit}  ({lo}~{hi})  ← {ref}")


# ------------------------------------------------------------------ fabrication
print("\n=== Fabrication ===")
t, _ = tolerance_factor(Recipe(fa=0, ma=1, cs=0, br=0))
check("Fab", "predicted", "Tolerance factor MAPbI3", t, 0.90, 0.92, "literature 0.91")
t, _ = tolerance_factor(Recipe(fa=1, ma=0, cs=0, br=0))
check("Fab", "predicted", "Tolerance factor FAPbI3", t, 0.97, 1.01, "literature ~0.99 (δ-phase edge)")
t, _ = tolerance_factor(Recipe(fa=0, ma=0, cs=1, br=0))
check("Fab", "predicted", "Tolerance factor CsPbI3", t, 0.80, 0.87, "literature 0.81-0.85 (δ phase at room temperature)")
r = PRESET_RECIPES["Stolterfoht 2019 reproduction (triple cation, PTAA/C60)"]
c = build_cell(r)
check("Fab", "predicted", "Triple-cation PTAA/C60 p-i-n Voc", c.voc, 1.10, 1.18, "Stolterfoht EES 2019: 1.14 V", " V")
c2 = build_cell(replace(r, etl="lif_c60"))
check("Fab", "predicted", "Same cell with LiF/C60: Voc", c2.voc, 1.13, 1.21, "same paper: 1.17 V", " V")
check("Fab", "predicted", "Voc gain from LiF interlayer", (c2.voc - c.voc) * 1000, 10, 50, "same paper: about +30 mV", " mV")
base = PRESET_RECIPES["Tandem bottom Pb-Sn 1.25 eV"]
for snf2, lo, hi, ref in [(0, 3, 30, "TRMC ~10 ns"), (10, 50, 400, "TRMC ~130 ns")]:
    v = build_cell(replace(base, snf2_pct=snf2, passivation="none")).tau_ns
    check("Fab", "calibrated", f"Pb-Sn lifetime SnF2 {snf2}%", v, lo, hi, ref, " ns")
v = build_cell(replace(PRESET_RECIPES["Classic MAPbI3 (n-i-p, Spiro)"], anneal_C=150, anneal_min=30)).decomposed
check("Fab", "predicted", "MAPbI3 150 °C 30 min decomposed fraction", v, 0.5, 1.0, "Eperon: MA films discolour within ~30 min at 150 °C")
v = build_cell(replace(Recipe(), anneal_C=150, anneal_min=30)).decomposed
check("Fab", "predicted", "FA-Cs 150 °C 30 min decomposed fraction", v, 0.0, 0.05, "FAPbI3-based films withstand 150 °C")
v = build_cell(Recipe()).pce
check("Fab", "predicted", "Record p-i-n 1.63 eV efficiency", v, 21, 26.5, "certified record ~26-27% (small cells)", "%")

# ------------------------------------------------------------------ environment
print("\n=== Environmental degradation (individual-paper mode) ===")
mapi = StackSpec(ma_frac=1.0, grain_nm=150, htl="spiro_li", electrode="au")
r_ = simulate_aging(mapi, Conditions(calibration="papers", atmosphere="dry_air", temp_C=27, suns=1, hours=4))
check("Env", "calibrated", "MAPbI3 dry air + light 4 h retention", r_["retention"][-1], 0.12, 0.3, "Aristidou 2017: 80% loss")
r_ = simulate_aging(replace(mapi, iodide_passivation=True), Conditions(calibration="papers", atmosphere="dry_air", temp_C=27, suns=1, hours=2.5))
check("Env", "predicted", "MAI-treated cell 2.5 h retention", r_["retention"][-1], 0.8, 0.95, "same paper: 10% loss")
film = replace(mapi, capped=False, htl="ptaa")
r_ = simulate_aging(film, Conditions(calibration="papers", atmosphere="vacuum", temp_C=55, suns=1, hours=0.5))
check("Env", "calibrated", "Bare MAPbI3 vacuum + light 30 min", r_["retention"][-1], 0.5, 0.7, "Ruess 2020: 40% iodine loss")
r_ = simulate_aging(film, Conditions(calibration="papers", atmosphere="n2_glovebox", temp_C=55, suns=1, hours=5))
check("Env", "predicted", "Bare MAPbI3 N2 + light 300 min", r_["retention"][-1], 0.93, 1.0, "same paper: no change")
dark85 = Conditions(calibration="papers", atmosphere="n2_glovebox", temp_C=85, suns=0, hours=200)
check("Env", "calibrated", "MAPbI3 N2 dark 85 °C T80", simulate_aging(mapi, dark85)["t80_h"], 25, 50,
      "Abdelmageed: decomposition starts after a day", " h")
r_ = simulate_aging(mapi, replace(dark85, temp_C=75, hours=72))
check("Env", "predicted", "MAPbI3 N2 dark 75 °C 3-day retention", r_["retention"][-1], 0.85, 1.0, "same study: no change at 75 °C")
r_ = simulate_aging(mapi, replace(dark85, temp_C=95, hours=48))
check("Env", "predicted", "MAPbI3 N2 dark 95 °C 2-day retention", r_["retention"][-1], 0.0, 0.5, "same study: full decomposition at 95 °C")
facs = StackSpec(ma_frac=0.0, grain_nm=400, htl="sam", electrode="ag", barrier=True)
dh = Conditions(calibration="papers", atmosphere="air", rh_pct=85, temp_C=85, suns=0, encapsulation="glass_glass_pib", hours=1000)
check("Env", "predicted", "FA-Cs glass-encapsulated 85/85 1000 h", simulate_aging(facs, dh)["retention"][-1], 0.95, 1.0,
      "cells passing IEC 61215 (Shi 2020, Microquanta)")
check("Env", "predicted", "Same cell unencapsulated T80", simulate_aging(facs, replace(dh, encapsulation="none"))["t80_h"], 0, 100,
      "unencapsulated cells do not survive damp heat", " h")
check("Env", "predicted", "No Ag barrier, 85/85 1000 h", simulate_aging(replace(facs, barrier=False), dh)["retention"][-1],
      0.7, 0.94, "Cheacharoen 2018: yellowing near the metal")
spiro = StackSpec(ma_frac=0.0, grain_nm=400, htl="spiro_litfsi", electrode="au")
check("Env", "calibrated", "Spiro (Li-TFSI+tBP) 85 °C T80", simulate_aging(spiro, dark85)["t80_h"], 80, 200,
      "Song et al.: sharp drop within 200 h", " h")
check("Env", "calibrated", "Radiation 1e14 p/cm² retention", float(radiation_retention(1e14)), 0.86, 0.92, "10 MeV test: 89%")
check("Env", "predicted", "Radiation 1e13 p/cm² retention", float(radiation_retention(1e13)), 0.96, 1.0, "same test: 98%")
sspd = StackSpec(ma_frac=0.0, grain_nm=400, surface_2d=True, htl="ptaa", electrode="au")
r_ = simulate_aging(sspd, replace(space_conditions("leo", hours=100 * 24, encapsulation="glass_glass_pib"), calibration="papers"))
check("Env", "predicted", "LEO satellite data (SSPD-1) ~100-day retention", r_["retention"][-1], 0.7, 0.9,
      "Caltech SSPD-1: about 80% - cover-glass yellowing and pre-launch exposure not in model")

# ------------------------------------------------------------------ ions / hysteresis
print("\n=== Ion drift-diffusion ===")
d = IonicDevice()
s = IonicSolver(d)
s.settle(0.0, t=1e-3)
jth = 1.602e-19 * d.Fph * (1 - np.exp(-d.alpha * d.b)) * 0.1
check("Ion", "predicted", "Short-circuit current = q·Φ·(1-e^-αb)", s.current() / jth, 0.98, 1.01, f"analytic {jth:.2f} mA/cm²")
path = os.path.join(ROOT, "outputs", "hysteresis_sweep.json")
if os.path.exists(path):
    sw = json.load(open(path))
    runs = sw["runs"]
    if "298" in runs:
        r298 = runs["298"]
        rates = np.array([x["rate"] for x in r298]); his = np.array([x["HI"] for x in r298])
        peak = rates[int(np.argmax(his))]
        check("Ion", "predicted", "Scan rate of maximum hysteresis (298 K)", peak * 1000, 30, 1000,
              "Soton JAP 2020: 'hundreds of mV/s', simulation ~320 mV/s", " mV/s")
        check("Ion", "predicted", "Very slow scan (3 mV/s) HI", his[0], 0, 0.05, "ions keep up, almost no hysteresis")
        if len(his) == len(rates) and rates[-1] >= 10:
            check("Ion", "predicted", "Very fast scan HI", his[-1], -0.02, 0.05, "ions cannot move, hysteresis disappears")
        if "273" in runs and len(runs["273"]) == len(rates):
            his273 = np.array([x["HI"] for x in runs["273"]])
            peak273 = rates[int(np.argmax(his273))]
            check("Ion", "predicted", "Peak-rate shift on cooling (273/298)", peak273 / peak, 0.0, 0.99,
                  "same paper: cooling moves it towards ~100 mV/s")
        if "298_N0x0.1" in runs and len(runs["298_N0x0.1"]) == len(rates):
            hk = np.array([x["HI"] for x in runs["298_N0x0.1"]])
            check("Ion", "predicted", "1/10 ions -> peak-rate shift (ratio)", rates[int(np.argmax(hk))] / peak, 0.0, 0.99,
                  "ion time constant τ ∝ b·L_D/D, L_D ∝ N0^-1/2 -> fewer ions shift it slower")
        if "298_N0x10" in runs and len(runs["298_N0x10"]) == len(rates):
            hk = np.array([x["HI"] for x in runs["298_N0x10"]])
            check("Ion", "predicted", "10x ions -> peak-rate shift (ratio)", rates[int(np.argmax(hk))] / peak, 1.01, 100,
                  "for the same reason more ions shift it faster")
else:
    print("  (no hysteresis_sweep.json -> run python validation/hysteresis_sweep.py first)")

n_ok = sum(r["ok"] for r in rows)
n_pred = sum(1 for r in rows if r["kind"] == "predicted")
n_pred_ok = sum(1 for r in rows if r["kind"] == "predicted" and r["ok"])
print(f"\nResult: {n_ok}/{len(rows)} passed (predicted checks {n_pred_ok}/{n_pred})")
out = os.path.join(ROOT, "outputs")
json.dump(rows, open(os.path.join(out, "backtest_extended.json"), "w"), ensure_ascii=False, indent=1)
with open(os.path.join(out, "backtest_extended.md"), "w") as f:
    f.write(f"# Extended backtest: {n_ok}/{len(rows)} passed (predicted {n_pred_ok}/{n_pred})\n\n")
    f.write("| Area | Kind | Check | Model | Allowed | Reference | Result |\n|---|---|---|---|---|---|---|\n")
    for r in rows:
        f.write(f"| {r['area']} | {r['kind']} | {r['name']} | {r['value']:.4g}{r['unit']} | {r['lo']}~{r['hi']} | {r['ref']} | {'✅' if r['ok'] else '❌'} |\n")
print("  -> saved: outputs/backtest_extended.md")
