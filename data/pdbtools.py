"""Clean the Perovskite Database Project CSV (Jacobsson et al., Nat. Energy 2022, CC BY 4.0) into the same vocabulary as the lab model.

    from pdb import load_clean
    df = load_clean()      # single-layer Pb/Sn halide perovskite cells only, converted to lab recipe fields
"""
import os
import re

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
RAW_ZENODO = os.path.join(HERE, "raw", "Perovskite_database_content_all_data.csv")   # 2022 archive (2009-2020, 42,443 cells)
RAW_NOMAD = os.path.join(HERE, "raw", "nomad", "perovskite_db.csv")                   # latest NOMAD version (downloaded with fetch_perovskite_db.py)
RAW = RAW_NOMAD if os.path.exists(RAW_NOMAD) else RAW_ZENODO


def _nums(s):
    try:
        return [float(x) for x in str(s).replace(" ", "").split(";")]
    except ValueError:
        return None


def _first_num(s):
    m = re.findall(r"[-+]?\d*\.?\d+", str(s))
    return float(m[-1]) if m else np.nan  # several steps: take the last one (usually the main anneal)


HTL_MAP = [("spiro", "spiro_litfsi"), ("ptaa", "ptaa"), ("pedot", "pedot"), ("nio", "nio"), ("p3ht", "p3ht"),
           ("poly-tpd", "polytpd"), ("polytpd", "polytpd"), ("meo-2pacz", "sam"), ("2pacz", "sam"), ("me-4pacz", "sam"), ("none", "none")]
ETL_MAP = [("lif", "lif_c60"), ("c60", "c60"), ("pcbm", "pcbm"), ("sno2", "sno2"), ("tio2", "tio2"), ("zno", "zno")]
ANTISOLVENTS = {"chlorobenzene", "toluene", "diethyl ether", "ethyl acetate", "anisole", "isopropanol", "trifluorotoluene",
                "chloroform", "dichlorobenzene", "xylene", "hexane", "methyl acetate", "ipa", "ethanol", "dichloromethane"}


def _map(seq, table):
    s = str(seq).lower()
    for k, v in table:
        if k in s:
            return v
    return "other"


def _quench(row):
    if str(row["Perovskite_deposition_quenching_induced_crystallisation"]) != "True":
        return "none"
    m = str(row["Perovskite_deposition_quenching_media"]).lower()
    if "vacuum" in m:
        return "vacuum"
    if m.startswith("n2") or "air" in m or "argon" in m or "gas" in m:
        return "gas"
    if any(a in m for a in ANTISOLVENTS):
        return "antisolvent"
    return "antisolvent" if m not in ("unknown", "nan") else "unknown"


def _dep(p):
    p = str(p).lower()
    first = p.split(">>")[0]
    if "co-evaporation" in p or "evaporation" in first:
        return "evap"
    if "inkjet" in p:
        return "inkjet"
    if "slot" in p:
        return "slot"
    if "blad" in p:
        return "blade"
    if "spin" in first:
        return "spin"
    return "other"


def _to_original_names(raw):
    """Map NOMAD export column names (lowercase section_field) to the 2022 archive names"""
    if "Perovskite_band_gap" in raw.columns:
        return raw
    ren = {}
    for c in raw.columns:
        sec, _, rest = c.partition("_")
        name = {"ref": "Ref", "cell": "Cell", "etl": "ETL", "htl": "HTL", "jv": "JV", "perovskite": "Perovskite",
                "stability": "Stability", "backcontact": "Backcontact", "substrate": "Substrate"}.get(sec)
        if name:
            ren[c] = f"{name}_{rest}"
    raw = raw.rename(columns=ren)
    raw["Encapsulation"] = raw.get("encapsulation_Encapsulation", "False")
    return raw


def load_clean(path=RAW):
    raw = _to_original_names(pd.read_csv(path, low_memory=False))
    out = []
    for _, r in raw.iterrows():
        a, ac = str(r["Perovskite_composition_a_ions"]), _nums(r["Perovskite_composition_a_ions_coefficients"])
        b, bc = str(r["Perovskite_composition_b_ions"]), _nums(r["Perovskite_composition_b_ions_coefficients"])
        c, cc = str(r["Perovskite_composition_c_ions"]), _nums(r["Perovskite_composition_c_ions_coefficients"])
        if "|" in a + b + c or ac is None or bc is None or cc is None or not np.all(np.isfinite(ac + bc + cc)):
            continue  # skip multilayer or unclear compositions
        A, B, C = [x.strip() for x in a.split(";")], [x.strip() for x in b.split(";")], [x.strip() for x in c.split(";")]
        if len(A) != len(ac) or len(B) != len(bc) or len(C) != len(cc):
            continue
        if not set(A) <= {"MA", "FA", "Cs"} or not set(B) <= {"Pb", "Sn"} or not set(C) <= {"I", "Br", "Cl"}:
            continue  # skip anything outside the lab model's range (MA/FA/Cs, Pb/Sn, I/Br/Cl)
        sa, sb, sc = sum(ac), sum(bc), sum(cc)
        if sa <= 0 or sb <= 0 or sc <= 0:
            continue
        fa = {k: v / sa for k, v in zip(A, ac)}
        fb = {k: v / sb for k, v in zip(B, bc)}
        fc = {k: v / sc for k, v in zip(C, cc)}
        basis = str(r["Perovskite_band_gap_estimation_basis"])
        measured_eg = basis not in ("Composition", "Literature", "nan", "Unknown") and not basis.startswith("Composition")
        sol = str(r["Perovskite_deposition_solvents"])
        out.append({
            "ma": fa.get("MA", 0), "fa": fa.get("FA", 0), "cs": fa.get("Cs", 0),
            "sn": fb.get("Sn", 0), "br": fc.get("Br", 0), "cl": fc.get("Cl", 0),
            "eg": pd.to_numeric(r["Perovskite_band_gap"], errors="coerce"), "eg_measured": measured_eg, "eg_basis": basis,
            "arch": str(r["Cell_architecture"]),
            "htl": _map(r["HTL_stack_sequence"], HTL_MAP), "etl": _map(r["ETL_stack_sequence"], ETL_MAP),
            "dep": _dep(r["Perovskite_deposition_procedure"]), "quench": _quench(r), "proc": str(r["Perovskite_deposition_procedure"]),
            "dmso": "dmso" in sol.lower(), "solvent": sol,
            "anneal_C": _first_num(r["Perovskite_deposition_thermal_annealing_temperature"]),
            "fab_atm": str(r["Perovskite_deposition_synthesis_atmosphere"]).split(">>")[0].strip(),
            "thickness_nm": pd.to_numeric(r["Perovskite_thickness"], errors="coerce"),
            "pce": pd.to_numeric(r["JV_default_PCE"], errors="coerce"), "voc": pd.to_numeric(r["JV_default_Voc"], errors="coerce"),
            "jsc": pd.to_numeric(r["JV_default_Jsc"], errors="coerce"), "ff": pd.to_numeric(r["JV_default_FF"], errors="coerce"),
            "pce_rev": pd.to_numeric(r["JV_reverse_scan_PCE"], errors="coerce"), "pce_fwd": pd.to_numeric(r["JV_forward_scan_PCE"], errors="coerce"),
            "year": pd.to_numeric(str(r["Ref_publication_date"])[:4], errors="coerce"),
            "encap": str(r["Encapsulation"]) == "True",
            "st_measured": str(r["Stability_measured"]) == "True", "st_protocol": str(r["Stability_protocol"]),
            "st_atm": str(r["Stability_atmosphere"]), "st_temp": str(r["Stability_temperature_range"]),
            "st_rh": pd.to_numeric(r["Stability_relative_humidity_average_value"], errors="coerce"),
            "st_light": pd.to_numeric(r["Stability_light_intensity"], errors="coerce"),
            "st_T80": pd.to_numeric(r["Stability_PCE_T80"], errors="coerce"),
            "st_end": pd.to_numeric(r["Stability_PCE_end_of_experiment"], errors="coerce"),
            "st_time": pd.to_numeric(r["Stability_time_total_exposure"], errors="coerce"),
            "doi": str(r["Ref_DOI_number"]),
        })
    df = pd.DataFrame(out)
    # drop obvious entry errors: PCE 0-30%, Voc 0.2-2 V, band gap 1.1-3.2 eV
    df.loc[(df.pce <= 0) | (df.pce > 30), "pce"] = np.nan
    df.loc[(df.voc < 0.2) | (df.voc > 2.0), "voc"] = np.nan
    df.loc[(df.eg < 1.1) | (df.eg > 3.2), "eg"] = np.nan
    return df


if __name__ == "__main__":
    d = load_clean()
    d.to_parquet(os.path.join(HERE, "pdb_clean.parquet")) if False else d.to_csv(os.path.join(HERE, "pdb_clean.csv"), index=False)
    print(d.shape)
    print(d[["pce", "voc", "eg"]].describe())
    print(d.eg_measured.sum(), "measured bandgaps")
    for c in ["arch", "htl", "etl", "dep", "quench", "fab_atm"]:
        print(d[c].value_counts().head(10).to_dict())
