"""Build the measured-cell distribution table -> web/realcells.json (the 'similar real cells' panel of the fabrication bench)"""
import json, os
import numpy as np, pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__))
d = pd.read_csv(os.path.join(HERE, "pdb_clean.csv"))
d = d[d.arch.isin(["nip", "pin"]) & d.pce.notna()]

def acat(r):
    ma, fa, cs = r.ma, r.fa, r.cs
    if ma >= 0.9: return "MA"
    if fa >= 0.9: return "FA"
    if cs >= 0.9: return "Cs"
    if cs < 0.03: return "FAMA"
    if ma < 0.03: return "CsFA"
    if fa < 0.03: return "CsMA"
    return "CsFAMA"
def brbin(x): return 0 if x < 0.02 else 1 if x <= 0.1 else 2 if x <= 0.25 else 3 if x <= 0.45 else 4 if x <= 0.7 else 5
def snbin(x): return 0 if x < 0.02 else 1 if x <= 0.4 else 2 if x <= 0.7 else 3
def anbin(t): return "na" if not np.isfinite(t) else "lt90" if t < 90 else "90-130" if t <= 130 else "gt130"
d["acat"] = d.apply(acat, axis=1)
d["brb"] = d.br.map(brbin); d["snb"] = d.sn.map(snbin); d["anb"] = d.anneal_C.map(anbin)
d["htl2"] = d.htl.replace({"none": "other"}); d["etl2"] = d.etl.replace({"zno": "other"})
KEYS = ["arch", "acat", "brb", "snb", "htl2", "etl2", "quench", "dep", "anb"]
# group statistics, dropping one field at a time from the end (backoff). The browser uses the most specific level with n≥15
levels = []
for k in range(len(KEYS), 2, -1):
    keys = KEYS[:k]
    g = d.groupby(keys)
    rows = {}
    for key, s in g:
        if len(s) < 8: continue
        p = s.pce.quantile([0.1, 0.5, 0.9]).round(2).tolist()
        v = s.voc.dropna()
        rows["|".join(map(str, key if isinstance(key, tuple) else (key,)))] = [len(s), *p, round(float(s.pce.max()), 2),
            round(float(v.median()), 3) if len(v) else None, int(s.year.max()) if s.year.notna().any() else None]
    levels.append({"keys": keys, "rows": rows})
    print(k, keys[-1], len(rows))
meta = {"source": "Perovskite Database Project (Jacobsson et al., Nature Energy 2022), CC BY 4.0 - latest NOMAD version",
        "n_total": int(len(d)), "years": [int(d.year.min()), int(d.year.max())], "fields": ["n", "p10", "p50", "p90", "max", "voc50", "lastYear"]}
json.dump({"meta": meta, "levels": levels}, open(os.path.join(HERE, "..", "web", "realcells.json"), "w"), separators=(",", ":"))
print(os.path.getsize(os.path.join(HERE, "..", "web", "realcells.json")) / 1024, "KB")
# per-factor effects (medians) - for comparison with model trends
for c in ["htl", "etl", "quench", "dep", "acat", "anb"]:
    print(c, d.groupby(c).pce.agg(["count", "median"]).query("count>50").round(1).to_dict("index"))
