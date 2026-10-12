"""Build the web lab: put spectrum data, the physics core and the app code into app.html to make a single index.html.

    python web/build.py
Result: web/index.html (opens directly in a browser, no server needed)
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def read(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return f.read()


def backtest_rows():
    path = os.path.join(ROOT, "outputs", "backtest_report.md")
    rows = []
    if not os.path.exists(path):
        return rows
    for line in open(path, encoding="utf-8"):
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) == 6 and cells[0] not in ("Area", "---"):
            area, name, value, rng, ref, ok = cells
            rows.append({"area": area, "name": name, "value": value, "range": rng, "ref": ref, "ok": "✅" in ok})
    return rows


def sig(v, n=4):
    return float(f"{v:.{n}g}")


def hysteresis_data():
    """Shrink the Python drift-diffusion result (outputs/hysteresis_sweep.json) for the web."""
    path = os.path.join(ROOT, "outputs", "hysteresis_sweep.json")
    if not os.path.exists(path):
        return None
    d = json.load(open(path))
    for key, rows in d["runs"].items():
        for r in rows:
            for c in ("curve_rev", "curve_fwd"):
                r[c] = [[sig(x, 3) for x in r[c][0]], [sig(x, 4) for x in r[c][1]]]
            for c in ("rev", "fwd"):
                r[c] = {k: sig(v, 5) for k, v in r[c].items()}
            r["HI"] = sig(r["HI"], 4)
    return d


def backtest3():
    path = os.path.join(ROOT, "outputs", "backtest_physics.json")
    return json.load(open(path)) if os.path.exists(path) else []


def backtest4():
    path = os.path.join(ROOT, "outputs", "backtest_data.json")
    return json.load(open(path)) if os.path.exists(path) else []


def backtest2():
    path = os.path.join(ROOT, "outputs", "backtest_extended.json")
    return json.load(open(path)) if os.path.exists(path) else []


html = read("app.html")
data = ("window.SPECTRA=" + read("spectra.json") + ";\nwindow.BACKTEST=" + json.dumps(backtest_rows(), ensure_ascii=False)
        + ";\nwindow.BACKTEST2=" + json.dumps(backtest2(), ensure_ascii=False)
        + ";\nwindow.BACKTEST3=" + json.dumps(backtest3(), ensure_ascii=False)
        + ";\nwindow.BACKTEST4=" + json.dumps(backtest4(), ensure_ascii=False)
        + ";\nwindow.REALCELLS=" + (read("realcells.json") if os.path.exists(os.path.join(HERE, "realcells.json")) else "null")
        + ";\nwindow.IONIC_SRC=" + json.dumps(read("ionic.js"), ensure_ascii=False)
        + ";\nwindow.HYST=" + json.dumps(hysteresis_data(), ensure_ascii=False, separators=(",", ":")) + ";")
html = (html.replace("/*SPECTRA*/", data).replace("/*CORE*/", read("perolab_core.js") + "\n" + read("perolab_phys.js") + "\n" + read("ionic.js"))
        .replace("/*LAB*/", read("perolab_lab.js")).replace("/*APP*/", read("app.js")))
out = os.path.join(HERE, "index.html")
with open(out, "w", encoding="utf-8") as f:
    f.write(html)
print(f"built {out} ({len(html)/1024:.0f} KB)")
