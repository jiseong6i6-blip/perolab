"""Cell fabrication lab: recipe (composition, solution, coating, crystallization, annealing, fabrication atmosphere, additives, stack) -> film properties -> device performance.

Flow
  1. Composition -> tolerance factor (does the structure form the black perovskite phase) + band gap
  2. Coating, crystallization, DMSO -> grain size, coverage (pinholes)
  3. Annealing temperature and time -> grain growth, incomplete conversion (residual solvent), overheating decomposition (PbI2)
  4. Fabrication atmosphere (O2, H2O) + Sn oxidation + SnF2 -> background doping, defects
  5. Defect density -> carrier lifetime τ -> radiative efficiency of the bare film
  6. Transport-layer interface loss (Stolterfoht 2018 measurement table) -> device ERE -> Voc
  7. Resistances (Rs, Rsh) -> FF;   coverage, phase purity, thickness -> Jsc
  8. Ion parameters (vacancy density, activation energy), segregation parameters and stability specs are passed to the other benches

Sources (<- numbers taken directly)
  * Tolerance factor t = (rA + rX) / (√2 (rB + rX)), effective ionic radii Kieslich et al. Chem. Sci. 2014 / Shannon:
      MA 2.17 Å, FA 2.53 Å, Cs 1.88 Å, Pb 1.19 Å, Sn 1.10 Å, I 2.20 Å, Br 1.96 Å, Cl 1.81 Å
      3-D perovskite stable for 0.8 < t < 1.0 (Li et al. Chem. Mater. 2016). FAPbI3 near the 1.0 edge, CsPbI3 ~0.85 (tends to δ phase at room temperature)
  * Interface loss: PLQY table per transport layer in Stolterfoht et al., Energy Environ. Sci. 2019 (arXiv:1810.01333) <-
      bare film 1.4e-2, PTAA 5.1e-3, PolyTPD 7.3e-3, SnO2 5.9e-3, TiO2 2.1e-3, Spiro 1.4e-3,
      LiF/C60 1.3e-3, P3HT 7.7e-4, PCBM 5.7e-4, C60 3.8e-4, PEDOT:PSS 7.5e-5
  * Sn-Pb: SnF2 0% -> background holes 7.6e16 cm⁻³, bulk defects 6e16, lifetime ~10 ns;
           1% -> 1.5e15 / 2e15; 10% -> <7e14 / 1.5e15, lifetime ~130 ns (PMC12529774, TRMC) <-
  * Crystallization: the qualitative findings that untreated spin coating gives low coverage (dendrites) and antisolvent or gas quenching gives dense films
    are turned into typical grain sizes (antisolvent 200-400 nm, gas 300-800 nm) - estimate, middle of the literature range
  * Overheating decomposition: the thermal decomposition rate of the environment module (MAPbI3 85 °C T80 36 h, Ea 1.5 eV) applied to the annealing temperature and time
"""
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional

import numpy as np

from .materials import FACS_I_BR, PB_SN
from .device import SubCell, simulate
from .environment import StackSpec, _k_thermal

KB = 8.617333e-5

RADII = {"MA": 2.17, "FA": 2.53, "Cs": 1.88, "Pb": 1.19, "Sn": 1.10, "I": 2.20, "Br": 1.96, "Cl": 1.81}

# Transport layers: Stolterfoht PLQY (in contact with perovskite), series-resistance contribution [Ω cm²], parasitic absorption when in front [%]
HTLS = {
    "ptaa":   dict(name="PTAA", plqy=5.1e-3, rs=2.0, parasitic=1.0, polarity="pin", src="measured"),
    "polytpd": dict(name="PolyTPD", plqy=7.3e-3, rs=2.0, parasitic=1.0, polarity="pin", src="measured"),
    "sam":    dict(name="SAM (MeO-2PACz)", plqy=1.0e-2, rs=0.8, parasitic=0.2, polarity="pin", src="estimate (recent SAMs lose less than PTAA)"),
    "nio":    dict(name="NiOx", plqy=2.5e-3, rs=1.5, parasitic=2.0, polarity="pin", src="estimate"),
    "pedot":  dict(name="PEDOT:PSS", plqy=7.5e-5, rs=1.2, parasitic=3.0, polarity="pin", src="measured"),
    "spiro_litfsi": dict(name="Spiro-OMeTAD (Li-TFSI+tBP)", plqy=1.4e-3, rs=1.5, parasitic=4.0, polarity="nip", src="measured"),
    "spiro_li": dict(name="Spiro-OMeTAD (Li-TFSI only)", plqy=1.4e-3, rs=2.5, parasitic=4.0, polarity="nip", src="measured (PLQY), resistance estimated"),
    "p3ht":   dict(name="P3HT", plqy=7.7e-4, rs=2.0, parasitic=4.0, polarity="nip", src="measured"),
}
ETLS = {
    "c60":     dict(name="C60", plqy=3.8e-4, rs=1.0, parasitic=3.0, polarity="pin", src="measured"),
    "lif_c60": dict(name="LiF/C60", plqy=1.3e-3, rs=1.2, parasitic=3.0, polarity="pin", src="measured"),
    "pcbm":    dict(name="PCBM", plqy=5.7e-4, rs=1.5, parasitic=2.0, polarity="pin", src="measured"),
    "sno2":    dict(name="SnO2", plqy=5.9e-3, rs=1.2, parasitic=0.5, polarity="nip", src="measured"),
    "tio2":    dict(name="TiO2", plqy=2.1e-3, rs=1.8, parasitic=1.0, polarity="nip", src="measured"),
}
NEAT_PLQY = 1.4e-2
ELECTRODES = {"ag": dict(name="Ag", rs=0.2), "au": dict(name="Au", rs=0.3), "cu": dict(name="Cu", rs=0.25),
              "carbon": dict(name="Carbon", rs=3.0)}
PASSIVATIONS = {
    "none":  dict(name="None", bulk=1.0, iface=1.0, gb=0.0, iodide=False, two_d=False, vac=1.0),
    "pea_i": dict(name="PEAI surface treatment", bulk=0.8, iface=0.35, gb=0.5, iodide=True, two_d=True, vac=0.8),
    "two_d": dict(name="2D capping layer (PEA2PbI4 etc.)", bulk=0.8, iface=0.3, gb=0.6, iodide=False, two_d=True, vac=0.8),
    "scn":   dict(name="SCN additive (fills vacancies)", bulk=0.5, iface=0.8, gb=0.3, iodide=True, two_d=False, vac=0.2),
    "bufa":  dict(name="Butylamine -> BuFA (grain boundaries)", bulk=0.6, iface=0.8, gb=0.8, iodide=False, two_d=False, vac=0.6),
    "mai":   dict(name="MAI iodide-salt treatment", bulk=0.7, iface=0.6, gb=0.4, iodide=True, two_d=False, vac=0.5),
}
QUENCH = {
    # base grain size [nm], coverage, surface roughness index
    "none":        dict(name="No quench", grain=120.0, coverage=0.88),  # 0.78->0.88: fitted to Perovskite Database (one-step spin, same year and composition, efficiency ratio 0.83)
    "antisolvent": dict(name="Antisolvent (chlorobenzene)", grain=280.0, coverage=0.97),
    "gas":         dict(name="Nitrogen gas (gas quench)", grain=450.0, coverage=0.985),
    "vacuum":      dict(name="Vacuum quench", grain=380.0, coverage=0.98),
}
DEPOSITION = {
    "spin":   dict(name="Spin coating", factor=1.0, cov=0.0, uniform=1.0),
    "blade":  dict(name="Blade coating", factor=1.15, cov=-0.01, uniform=0.97),
    "slot":   dict(name="Slot-die", factor=1.1, cov=-0.005, uniform=0.98),
    "inkjet": dict(name="Inkjet printing", factor=1.05, cov=-0.015, uniform=0.96),
}
FAB_ATM = {
    "n2": dict(name="N2 glovebox", o2_ppm=1.0, rh=0.0),
    "ar": dict(name="Ar glovebox", o2_ppm=1.0, rh=0.0),
    "dry_air": dict(name="Dry air (RH<5%)", o2_ppm=2.1e5, rh=3.0),
    "air": dict(name="Ambient air (set RH)", o2_ppm=2.1e5, rh=None),
}


@dataclass
class Recipe:
    # composition (A-site sum = 1)
    fa: float = 0.80
    ma: float = 0.00
    cs: float = 0.20
    br: float = 0.17          # Br fraction on the X site
    cl: float = 0.00          # small Cl addition
    sn: float = 0.00          # Sn fraction on the B site
    snf2_pct: float = 0.0     # SnF2 mol% (relative to Sn)
    # solution and coating
    dmso: float = 0.2         # DMSO fraction of the solvent (rest DMF)
    deposition: str = "spin"
    quench: str = "antisolvent"
    thickness_nm: float = 550.0
    # annealing
    anneal_C: float = 100.0
    anneal_min: float = 30.0
    # fabrication atmosphere
    fab_atm: str = "n2"
    fab_rh: float = 30.0      # used when fab_atm="air"
    glovebox_ppm: float = 1.0
    # stack
    htl: str = "sam"
    etl: str = "lif_c60"
    electrode: str = "ag"
    barrier: bool = True       # ALD SnO2 / ITO barrier in front of the metal
    passivation: str = "pea_i"


@dataclass
class CellReport:
    recipe: Recipe
    tolerance: float
    octahedral: float
    phase_ok: float           # fraction of black 3-D phase (0-1)
    eg: float
    grain_nm: float
    coverage: float
    conversion: float         # precursor -> perovskite conversion
    decomposed: float         # fraction decomposed by overheating
    trap_cm3: float
    tau_ns: float
    p_doping_cm3: float
    ere_bulk: float
    ere: float
    rs: float
    rsh: float
    jsc: float = 0.0
    voc: float = 0.0
    ff: float = 0.0
    pce: float = 0.0
    voc_rad: float = 0.0
    warnings: List[str] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)
    ion_N0_cm3: float = 1.6e19
    ion_Ea_eV: float = 0.55
    seg_params: Dict = field(default_factory=dict)
    stack: Optional[StackSpec] = None


def tolerance_factor(r: Recipe):
    a = r.fa * RADII["FA"] + r.ma * RADII["MA"] + r.cs * RADII["Cs"]
    b = (1 - r.sn) * RADII["Pb"] + r.sn * RADII["Sn"]
    x = (1 - r.br - r.cl) * RADII["I"] + r.br * RADII["Br"] + r.cl * RADII["Cl"]
    t = (a + x) / (np.sqrt(2) * (b + x))
    mu = b / x
    return float(t), float(mu)


def bandgap(r: Recipe):
    """Composition -> band gap. Pb compositions follow the I/Br bowing curve; adding Sn gives anomalous bowing and keeps part of the Br effect (approximate).
    A site: MA is about +0.03 eV vs FA, Cs about +0.1 eV per Cs vs FA (small range) (the FA-Cs base formula already includes Cs 0.2)."""
    eg_pb = FACS_I_BR.bandgap(r.br)
    eg_a = 0.03 * r.ma + 0.10 * (r.cs - 0.2)
    eg_cl = 0.3 * r.cl
    if r.sn <= 0:
        return float(eg_pb + eg_a + eg_cl)
    eg_sn = PB_SN.bandgap(r.sn)
    return float(eg_sn + (eg_pb - 1.55) * (1 - 0.4 * r.sn) + eg_a * (1 - r.sn) + eg_cl)


def build_cell(r: Recipe, spectrum="AM1.5G") -> CellReport:
    warn, notes = [], []
    # --- 1. structure
    t, mu = tolerance_factor(r)
    phase_ok = 1.0
    if t > 1.0:
        phase_ok -= min(0.6, (t - 1.0) * 8)
        warn.append(f"Tolerance factor {t:.3f} > 1.0: the yellow hexagonal (δ) phase mixes in easily. A little Cs or MA stabilizes it.")
    if t < 0.82:
        phase_ok -= min(0.7, (0.82 - t) * 10)
        warn.append(f"Tolerance factor {t:.3f} < 0.82: too much Cs; tends to turn into a non-perovskite phase at room temperature.")
    if mu < 0.41:
        phase_ok -= 0.3
        warn.append(f"Octahedral factor {mu:.2f} < 0.41: the metal-halide octahedron is unstable.")
    if r.cs > 0.5 and r.br < 0.5:
        phase_ok -= 0.4
        warn.append("Mostly inorganic (Cs) iodide: tends to turn into yellow δ-CsPbI3 at room temperature.")
    elif r.cs > 0.3 and r.br < 0.3:
        phase_ok -= 0.15
        warn.append("Above 30% Cs, iodide compositions tend to phase-separate Cs.")
    if r.fa > 0.95 and r.cs < 0.03 and r.ma < 0.03:
        notes.append("Pure FAPbI3 slowly turns into the δ phase at room temperature (in practice stabilized with a little Cs, MA or MACl).")
    phase_ok = float(np.clip(phase_ok, 0.1, 1.0))
    eg = bandgap(r)
    # --- 2. crystallization
    q, dep = QUENCH[r.quench], DEPOSITION[r.deposition]
    grain = q["grain"] * dep["factor"] * (1 + 0.8 * r.dmso)          # the DMSO intermediate slows and enlarges grain growth
    coverage = q["coverage"] + dep["cov"]
    if r.dmso > 0.5:
        coverage -= (r.dmso - 0.5) * 0.15
        warn.append("Too much DMSO slows drying and can make the film uneven.")
    if r.deposition in ("inkjet", "blade", "slot") and r.quench == "antisolvent":
        notes.append("Large-area printing (inkjet, blade, slot-die) cannot spread antisolvent evenly, so gas or vacuum quenching is usual.")
        coverage -= 0.02
    if r.deposition == "inkjet" and r.quench == "none":
        coverage -= 0.05
        warn.append("Inkjet + no quench: the coffee-ring effect pushes material to droplet edges and easily leaves pinholes.")
    # --- 3. annealing
    TK = r.anneal_C + 273.15
    tau_conv = 1.0 * np.exp(0.8 / KB * (1 / TK - 1 / 373.15))         # 1-minute time constant at 100 °C
    conversion = float(1 - np.exp(-r.anneal_min / tau_conv))
    if conversion < 0.95:
        warn.append(f"Under-annealed: {conversion*100:.0f}% precursor conversion (leftover solvent and intermediates become defects).")
    growth = 1 + 0.15 * np.sqrt(r.anneal_min / 30) * np.exp(0.6 / KB * (1 / 373.15 - 1 / TK))
    grain *= float(np.clip(growth, 1, 2.5))
    # overheating decomposition: apply the thermal decomposition rate to the annealing conditions (N2 assumed, time in h)
    st_tmp = StackSpec(ma_frac=r.ma)
    k = _k_thermal(st_tmp, TK)
    decomposed = float(1 - np.exp(-k * r.anneal_min / 60))
    if decomposed > 0.03:
        warn.append(f"Overheated: about {decomposed*100:.0f}% decomposed to PbI2 (more sensitive with more MA).")
    elif 0.003 < decomposed <= 0.03:
        notes.append("A slight PbI2 excess can passivate grain boundaries and actually help.")
    # --- 4. fabrication atmosphere & Sn
    fa = FAB_ATM[r.fab_atm]
    o2_ppm = r.glovebox_ppm if r.fab_atm in ("n2", "ar") else fa["o2_ppm"]
    rh = r.fab_rh if fa["rh"] is None else fa["rh"]
    atm_factor = 1.0
    if rh > 0:
        if r.ma > 0.3 and 15 <= rh <= 35:
            grain *= 1.15
            notes.append("MA compositions are reported to grow slightly larger grains in mild humidity (RH 15-35%).")
        atm_factor *= 1 + max(rh - 30, 0) / 15
        if rh > 50:
            coverage -= 0.04
            warn.append(f"Fabrication humidity {rh:.0f}%: more hydrates and pinholes.")
    p_dop = 0.0
    if r.sn > 0:
        sn4 = 0.015 * (1 + o2_ppm / 2.0)                               # Sn⁴⁺ % (fresh precursor 0.015%)
        if r.fab_atm in ("air", "dry_air"):
            sn4 = 5.0
            warn.append("Sn-containing cells made in air: Sn²⁺ oxidizes immediately and the cell barely works.")
        if o2_ppm > 10 and r.fab_atm in ("n2", "ar"):
            warn.append(f"Glovebox oxygen {o2_ppm:.0f} ppm: more Sn oxidation (usually kept <1 ppm).")
        scav = 1 + 50 * r.snf2_pct ** 1.3                              # 0%→1, 1%→51, 10%→~1000
        p_dop = 7.6e16 * (sn4 / 0.015) / scav * r.sn / 0.5
        if r.snf2_pct < 0.5:
            warn.append("Sn without SnF2: many background holes (p-type doping), voltage and lifetime drop sharply. Usually 5-10% relative to Sn.")
        if r.snf2_pct > 15:
            notes.append("Too much SnF2 can leave SnOx / SnF2 clusters on the surface.")
    # --- 5. defects -> lifetime
    pas = PASSIVATIONS[r.passivation]
    N_t = 1e14 * (1 + 300 / grain)                                     # grain-boundary contribution
    N_t *= atm_factor * (1 + 3 * (1 - conversion)) * (1 + 5 * max(decomposed - 0.02, 0))
    N_t *= (1 + 2 * (1 - phase_ok)) * pas["bulk"]
    sigma_v = 1e-8                                                     # σ v_th [cm³/s] = 1e-15 cm² × 1e7 cm/s
    rate_nr = sigma_v * N_t
    if r.sn > 0:
        # Sn-related defects: σv = 3e-9 cm³/s fitted to TRMC data (SnF2 0% -> 6e16 cm⁻³, lifetime ~10 ns)
        # measured: SnF2 0% -> 6e16, 1% -> 2e15, 10% -> 1.5e15 cm⁻³
        N_sn = (1.5e15 + 5.85e16 / (1 + 60 * r.snf2_pct ** 1.5)) * r.sn / 0.5 * (1 + o2_ppm / 10)
        N_t += N_sn
        rate_nr += 3e-9 * N_sn
    if r.br > 0.3:
        f_wbg = 1 + 2 * (r.br - 0.3)                                   # wide-gap films have more defects (larger voltage loss)
        N_t *= f_wbg
        rate_nr *= f_wbg
    tau = 1 / rate_nr
    if p_dop > 0:
        tau = 1 / (1 / tau + 6e-11 * p_dop)                            # radiative and non-radiative recombination with background holes
    tau_ns = tau * 1e9
    # film radiative efficiency: Stolterfoht bare-film PLQY (1.4e-2) at 1 µs lifetime
    k_nr_rel = (1e-6 / tau)
    ere_bulk = 1 / (1 + (1 / NEAT_PLQY - 1) * k_nr_rel)
    # --- 6. interfaces
    htl, etl = HTLS[r.htl], ETLS[r.etl]
    if htl["polarity"] != etl["polarity"]:
        notes.append(f"{htl['name']} and {etl['name']} are usually used in different architectures (n-i-p / p-i-n).")
    d_h = (1 / htl["plqy"] - 1 / NEAT_PLQY)
    d_e = (1 / etl["plqy"] - 1 / NEAT_PLQY) * pas["iface"]
    inv_ere = 1 / ere_bulk + d_h + d_e
    ere = 1 / inv_ere
    # extra voltage loss for wide gaps (> 1.75 eV): in the Perovskite Database (2018-2020, top 1%) the Eg-Voc difference
    # grows from 0.44 V at 1.6 eV to 0.59 V at 1.9 eV (segregation, transport-layer energy mismatch). Half that slope, 0.3 V/eV, is used to allow for recent records
    if eg > 1.75:
        ere *= float(np.exp(-0.3 * (eg - 1.75) / 0.025852))
    # --- 7. resistances
    rs = htl["rs"] + etl["rs"] + ELECTRODES[r.electrode]["rs"] + 1.0  # ITO etc. +1
    coverage = float(np.clip(coverage, 0.5, 0.995))
    rsh = float(max(30.0, 1e4 * np.exp(-(1 - coverage) / 0.04)))  # floor 30 Ω·cm²: even a pinhole has a thin transport layer in between, so the metals never touch directly
    if coverage < 0.95:
        warn.append(f"Coverage {coverage*100:.0f}%: pinholes let the electrodes touch and leak (shunt).")
    if r.thickness_nm < 300:
        rsh *= r.thickness_nm / 300
    parasitic = (htl["parasitic"] if htl["polarity"] == "pin" else etl["parasitic"]) / 100   # layer the light passes first
    # --- device calculation
    cell = SubCell(eg=eg, thickness_nm=r.thickness_nm * conversion * (1 - decomposed), ere=ere, rs=rs, rsh=rsh,
                   eu=0.015 + 0.01 * (1 - phase_ok) + 0.005 * max(r.br - 0.3, 0))
    res = simulate([cell], spectrum, reflect=0.02 + parasitic)
    tot = res["total"]
    jsc = tot.jsc * coverage * (0.7 + 0.3 * phase_ok)
    scale = jsc / tot.jsc if tot.jsc > 0 else 0
    pce = tot.pce * scale
    from .device import sq_limit
    voc_rad = float(simulate([SubCell(eg=eg, thickness_nm=r.thickness_nm, ere=1.0, rs=0, rsh=1e12)], spectrum)["total"].voc)
    # --- 8. ion, segregation and stability specs
    vac = pas["vac"] * (1 + 4 * max(decomposed - 0.01, 0)) * (1 + 0.5 * (r.anneal_C > 130))
    ion_N0 = 1.6e19 * vac
    # ion migration activation energy: MAPbI3 computed 0.58 eV (IonMonger default), measured 0.41-0.58 eV (Soton JAP 2020)
    ion_Ea = 0.58 * r.ma + 0.50 * r.fa + 0.55 * r.cs + 0.03 * (pas["gb"] > 0.4)
    omega = 0.040 * (1 + 0.5 * max(r.cs - 0.15, 0) / 0.15) * (0.8 if r.cl > 0 else 1.0)
    seg = dict(x_br=r.br, grain_size_nm=float(grain), vacancy_ratio=float(vac), gb_passivation=pas["gb"],
               omega_eV=float(omega), carrier_lifetime_ns=float(min(tau_ns, 3000)))
    stack = StackSpec(ma_frac=r.ma, grain_nm=float(grain), iodide_passivation=pas["iodide"], surface_2d=pas["two_d"],
                      htl=r.htl if r.htl in ("spiro_litfsi", "spiro_li", "ptaa", "sam", "nio", "pedot") else "ptaa",
                      electrode=r.electrode, barrier=r.barrier, capped=True, x_br=r.br, sn_frac=r.sn)
    if r.br > 0.2:
        notes.append(f"Br {r.br*100:.0f}%: halide segregation may occur under light -> check in the segregation bench.")
    if r.electrode == "ag" and not r.barrier:
        warn.append("Ag electrode without a barrier: reacts with iodine and degrades quickly when hot (ITO or ALD SnO2 barrier recommended).")
    if r.htl == "spiro_litfsi":
        notes.append("Spiro with Li-TFSI + tBP degrades quickly near 85 °C.")
    return CellReport(recipe=r, tolerance=t, octahedral=mu, phase_ok=phase_ok, eg=eg, grain_nm=float(grain),
                      coverage=coverage, conversion=conversion, decomposed=decomposed, trap_cm3=float(N_t),
                      tau_ns=float(tau_ns), p_doping_cm3=float(p_dop), ere_bulk=float(ere_bulk), ere=float(ere),
                      rs=float(rs), rsh=float(rsh), jsc=float(jsc), voc=float(tot.voc), ff=float(tot.ff),
                      pce=float(pce), voc_rad=voc_rad, warnings=warn, notes=notes, ion_N0_cm3=float(ion_N0),
                      ion_Ea_eV=float(ion_Ea), seg_params=seg, stack=stack)


PRESET_RECIPES = {
    "Record p-i-n (FA-Cs, SAM/LiF-C60)": Recipe(),
    "Stolterfoht 2019 reproduction (triple cation, PTAA/C60)": Recipe(fa=0.79, ma=0.16, cs=0.05, br=0.17, htl="ptaa", etl="c60",
                                                       passivation="none", quench="antisolvent", dmso=0.2),
    "Classic MAPbI3 (n-i-p, Spiro)": Recipe(fa=0.0, ma=1.0, cs=0.0, br=0.0, htl="spiro_litfsi", etl="tio2",
                                       electrode="au", barrier=False, passivation="none", dmso=0.2),
    "Tandem top 1.77 eV (Br 40%)": Recipe(fa=0.8, cs=0.2, br=0.40, htl="sam", etl="lif_c60", passivation="pea_i"),
    "Tandem bottom Pb-Sn 1.25 eV": Recipe(fa=0.7, ma=0.3, cs=0.0, br=0.0, sn=0.5, snf2_pct=10, htl="sam", etl="lif_c60",
                                    passivation="pea_i", thickness_nm=1000),
    "Large-area inkjet (gas quench)": Recipe(deposition="inkjet", quench="gas", dmso=0.3),
}
