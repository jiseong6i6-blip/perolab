"""Hysteresis index (HI) vs scan rate at two temperatures. Saves outputs/hysteresis_sweep.json (used by the backtest and the web lab).

    python validation/hysteresis_sweep.py
"""
import json, os, sys, time
from dataclasses import replace
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import numpy as np
from perolab.ionic import IonicDevice, hysteresis_scan, hysteresis_index

rates = [0.003, 0.01, 0.03, 0.1, 0.3, 1.0, 3.0, 10.0, 30.0]
out = {"rates": rates, "runs": {}}
os.makedirs(os.path.join(ROOT, "outputs"), exist_ok=True)
CASES = {"298": dict(T=298.0), "273": dict(T=273.0),
         "298_N0x0.1": dict(T=298.0, N0=1.6e24), "298_N0x10": dict(T=298.0, N0=1.6e26)}
for key, kw in CASES.items():
    d = replace(IonicDevice(), **kw)
    T = kw["T"]
    rows = []
    for r in rates:
        t0 = time.time()
        rev, fwd = hysteresis_scan(d, r)
        hi, a, b = hysteresis_index(rev, fwd)
        rows.append({"rate": r, "HI": hi, "rev": a, "fwd": b,
                     "curve_rev": [list(map(float, rev[0])), list(map(float, rev[1]))],
                     "curve_fwd": [list(map(float, fwd[0])), list(map(float, fwd[1]))]})
        print(f"{key} rate {r:7.3f} V/s HI {hi:+.3f} ({time.time()-t0:.0f}s)", flush=True)
    out["runs"][key] = rows
    with open(os.path.join(ROOT, "outputs", "hysteresis_sweep.json"), "w") as f:
        json.dump(out, f)
with open(os.path.join(ROOT, "outputs", "hysteresis_sweep.json"), "w") as f:
    json.dump(out, f)
print("saved outputs/hysteresis_sweep.json")
