"""Environment and degradation model: air / nitrogen / argon / vacuum (space), encapsulation, light, temperature, humidity, radiation, thermal cycling.

Each degradation pathway is a first-order rate k [1/h]; efficiency retention = Π exp(-∫k dt).
Rate constants are set from the paper values below (<- marks a calibration anchor, the rest are predictions that follow).

  [Oxygen + light]  Aristidou et al., Nat. Commun. 8, 15218 (2017)
             <- MAPbI3 device, dry air + 1 sun: 80% efficiency loss in 4 hours
             <- iodide salt (MAI) treatment: 10% loss in 2.5 h (control 50%)
             · each doubling of grain size cuts oxygen ingress to about 1/4 (authors' estimate)
             Ea: 0.48 eV in dry air, 0.08 eV at 60% RH (AIChE 2021; moisture accelerates photo-oxidation)
  [Thermal]  Abdelmageed et al. 2016 (cited in review arXiv:2509.13700)
             <- MAPbI3, N2, dark: decomposition starts after about a day at 85 °C -> T80 ≈ 36 h, Ea 1.5 eV
             · almost no change for days at 75 °C, full decomposition at 95 °C (confirmed as predictions)
             FA-Cs: survives far longer than MA at 150 °C (Eperon), Ea ≈ 0.7 eV (Tan et al.)
             <- glass-glass encapsulated FA-Cs cells pass 85 °C/85% for 1000-3000 h (Shi 2020, Microquanta)
  [Volatilization / iodine escape]  Ruess et al., RSC Adv. 2020 (d0ra03572f)
             <- bare MAPbI3, ultra-high vacuum + light 30 min: 40% iodine loss
             · no change for 300 min in N2 or air (1 atm); covered by a transport layer it is >10x slower even in vacuum
  [Moisture]  Peck model k ∝ RH^n exp(-Ea/kT), n=2, Ea≈0.6 eV (standard PV reliability practice)
             <- MAPbI3, 25 °C, 50% RH, dark, unencapsulated: T80 ≈ 3 days (middle of the reported range, estimate)
  [Encapsulant permeation]  Kempe et al., NREL (fy11osti/47706): Ca-test ingress constant K (85 °C/85%)
             PIB edge seal 0.018-0.024 cm/√h, EVA 0.38 cm/√h -> ingress depth = K√t
  [HTL additives]  Song et al. (cited in review): spiro + Li-TFSI + tBP, 85 °C N2 -> sharp drop within 200 h
  [Metal electrode]  Cheacharoen et al., Sustainable Energy Fuels 2018: PbI2 yellowing near Ag -> solved with an ITO barrier and 2 mm spacing
  [Tin oxidation] Sn²⁺ quickly becomes Sn⁴⁺ in air -> estimate T80 ≈ 10 h for an unencapsulated Pb-Sn film (based on qualitative reports)
  [Radiation]  10 MeV protons, Cs0.1FA0.9PbI3/Spiro (APVI 2023): 1e12 -> 99%, 1e13 -> 98%, 1e14 -> 89%
             1e14 p/cm² ≈ 5.5 years in LEO ≈ 100 years in GEO (same source)
  [Thermal cycling]  based on devices passing IEC TC200 (-40↔85 °C); per-cycle damage extrapolated with Coffin-Manson (ΔT²) - estimate
  [In-orbit data]  SSPD-1 satellite (Caltech, LEO, 2023): glass/epoxy-encapsulated quasi-2D cells kept about 80% efficiency
             over a 44-day window up to ~100 days after launch, cell temperature -25 to 35 °C - independent check (not used for calibration)

Caution: real devices differ by several times between materials and processes. Use this model to compare conditions
and to see which pathway dominates; trust absolute lifetimes only to an order of magnitude.
"""
from dataclasses import dataclass, field, replace
from typing import Dict, List, Optional

import numpy as np
from scipy.special import erfc

KB = 8.617333e-5


def arr(Ea, T_K, T_ref_K):
    return np.exp(-Ea / KB * (1.0 / T_K - 1.0 / T_ref_K))


# ---------------------------------------------------------------------------- atmosphere
ATMOSPHERES = {
    # name: (O2 mole fraction, water = RH% or ppm converted to RH, pressure atm, label)
    "air":      dict(o2=0.21, rh=None, p_atm=1.0, label="Ambient air"),
    "dry_air":  dict(o2=0.21, rh=0.5, p_atm=1.0, label="Dry air"),
    "n2_glovebox": dict(o2=1e-6, rh=0.003, p_atm=1.0, label="N2 glovebox (O2, H2O ~1 ppm)"),
    "ar_glovebox": dict(o2=1e-6, rh=0.003, p_atm=1.0, label="Ar glovebox (O2, H2O ~1 ppm)"),
    "vacuum":   dict(o2=0.0, rh=0.0, p_atm=1e-12, label="Vacuum (space, UHV)"),
}
# How much volatile products (iodine, organic cations) linger at the surface and react back (back-reaction in Ruess 2020).
# >10x slower in 1 atm gas. Argon is heavier, so volatiles diffuse a little slower -> weak evidence, only a 10% difference.
VOLATILE_SUPPRESS = {"air": 0.01, "dry_air": 0.01, "n2_glovebox": 0.01, "ar_glovebox": 0.009, "vacuum": 1.0}

# ---------------------------------------------------------------------------- encapsulation
ENCAPSULATIONS = {
    # K85: edge ingress constant at 85 °C [cm/√h], width: default path length [cm]
    # face: permeation through front/back faces (1 = unchanged, 0 = blocked), cap: confinement of volatiles (pressure kept)
    "none":          dict(K85=None, width=0.0, face=1.0, cap=1.0, label="No encapsulation"),
    "polymer":       dict(K85=0.38, width=0.05, face=1.0, cap=0.3, label="Polymer cover only (EVA-type, 0.5 mm)"),
    "glass_glass_pib": dict(K85=0.021, width=1.0, face=0.0, cap=0.01, label="Glass-glass + 1 cm PIB edge seal"),
    "thin_film_ald": dict(K85=None, width=0.0, face=0.01, cap=0.05, label="Thin-film encapsulation (ALD Al2O3, light for space)"),
}
EA_PERMEATION = 0.5  # polymer permeation activation energy [eV] (K ∝ √D ∝ exp(-Ea/2kT))


def ingress_fraction(enc, hours, T_C, width_cm=None):
    """Fraction (0-1) of the outside gas (water, oxygen) concentration that has reached the inside of the package."""
    e = ENCAPSULATIONS[enc]
    if e["K85"] is None:
        return np.full_like(np.asarray(hours, float), e["face"], dtype=float)
    w = e["width"] if width_cm is None else width_cm
    K = e["K85"] * np.sqrt(arr(EA_PERMEATION, T_C + 273.15, 358.15))
    t = np.maximum(np.asarray(hours, float), 1e-12)
    edge = erfc(w / (K * np.sqrt(t)))
    return np.clip(np.maximum(edge, e["face"]), 0, 1)


# ---------------------------------------------------------------------------- cell properties (passed from the fabrication model)
@dataclass
class StackSpec:
    ma_frac: float = 0.0          # MA fraction on the A site (rest FA/Cs)
    grain_nm: float = 300.0
    iodide_passivation: bool = False   # MAI / iodide-salt surface treatment, SCN etc. filling vacancies
    surface_2d: bool = False           # 2-D capping layer such as PEAI (helps block moisture and oxygen)
    htl: str = "ptaa"                  # spiro_litfsi, spiro_li, ptaa, sam, nio, pedot
    electrode: str = "ag"              # ag, au, cu, carbon
    barrier: bool = False              # ITO / ALD SnO2 barrier in front of the metal
    capped: bool = True                # covered by transport layers and electrode (True unless a bare film)
    x_br: float = 0.17
    sn_frac: float = 0.0


# ---------------------------------------------------------------------------- conditions
@dataclass
class Conditions:
    atmosphere: str = "air"
    rh_pct: float = 50.0           # relative humidity in air
    temp_C: float = 25.0
    suns: float = 1.0
    encapsulation: str = "none"
    edge_width_cm: Optional[float] = None
    hours: float = 1000.0
    radiation_flux: float = 0.0    # 10 MeV proton equivalent [p/cm²/h]
    thermal_cycles_per_h: float = 0.0
    cycle_dT: float = 0.0
    label: str = ""
    intrinsic_scale: float = 1.0   # intrinsic degradation factor: 1 = average 2014-2020 paper cell, 0.1 ≈ recent best cells
    calibration: str = "database"  # "database": calibrated to ~1,550 measured T80 values / "papers": individual paper experiments (bare films, specific cells)


ORBITS = {
    # LEO: SSPD-1 satellite (2023) measured cell temperature -25 to 35 °C, ~16 eclipses per day
    "leo": dict(radiation_flux=1.8e13 / 8766, thermal_cycles_per_h=16 / 24, cycle_dT=60.0, temp_C=5.0, suns=1.36),
    "geo": dict(radiation_flux=1.0e12 / 8766, thermal_cycles_per_h=1 / 24 * 90 / 365, cycle_dT=200.0, temp_C=60.0, suns=1.36),
}


def space_conditions(orbit="leo", hours=8766.0, encapsulation="thin_film_ald"):
    o = ORBITS[orbit]
    return Conditions(atmosphere="vacuum", rh_pct=0.0, encapsulation=encapsulation, hours=hours,
                      label=f"Space {orbit.upper()}", **o)


# ---------------------------------------------------------------------------- rate constants
REF_T = 298.15


def _k_photooxidation(s: StackSpec, o2_in, rh_in, suns, T):
    """Oxygen + light -> superoxide -> decomposition. <- MAPbI3 dry air 1 sun: 80% loss in 4 h (k = ln5/4 h)."""
    if suns <= 0 or o2_in <= 0:
        return 0.0
    k_ref = np.log(5) / 4.0                       # 1/h, MAPbI3, 150 nm grains, dry air, 300 K
    Ea = 0.48 - 0.40 * min(rh_in / 60.0, 1.0)     # moisture lowers the activation energy
    humid = 1.0 + 2.0 * min(rh_in / 60.0, 1.0)    # faster in humid air (AIChE 2021, qualitative)
    f_grain = np.clip((s.grain_nm / 150.0) ** -2, 0.02, 4.0)   # 1/4 per doubling
    f_pass = 0.15 if s.iodide_passivation else 1.0             # MAI treatment: k 0.277 -> 0.042
    f_comp = s.ma_frac + 0.1 * (1 - s.ma_frac)                 # FA/Cs lack MA's deprotonation pathway (estimate 1/10)
    f_2d = 0.5 if s.surface_2d else 1.0
    return k_ref * (o2_in / 0.21) * suns * humid * f_grain * f_pass * f_comp * f_2d * arr(Ea, T, 300.0)


def _k_moisture(s: StackSpec, rh_in, T):
    """Moisture (dark). <- MAPbI3 25 °C 50% RH T80 ≈ 72 h."""
    if rh_in <= 0:
        return 0.0
    k_ref = -np.log(0.8) / 72.0
    f_comp = s.ma_frac + 0.08 * (1 - s.ma_frac)
    f_2d = 0.3 if s.surface_2d else 1.0
    return k_ref * (rh_in / 50.0) ** 2 * f_comp * f_2d * arr(0.6, T, REF_T)


def _k_thermal(s: StackSpec, T):
    """Intrinsic thermal decomposition (MA volatilization). <- MAPbI3 85 °C T80 36 h (Ea 1.5 eV), FA-Cs 85 °C T80 ≈ 8000 h."""
    k_ma = -np.log(0.8) / 36.0 * arr(1.5, T, 358.15)
    k_facs = -np.log(0.8) / 8000.0 * arr(0.7, T, 358.15)
    return s.ma_frac * k_ma + (1 - s.ma_frac) * k_facs


def _k_volatile(s: StackSpec, atm, cap_enc, suns, T):
    """Light-driven iodine / organic volatilization. <- bare MAPbI3 in vacuum, 1 sun, 55 °C: 40% iodine loss in 30 min."""
    if suns <= 0:
        return 0.0
    k_ref = -np.log(0.6) / 0.5
    f_comp = s.ma_frac + 0.1 * (1 - s.ma_frac)
    f_cap = 0.05 if s.capped else 1.0
    return k_ref * suns * f_comp * VOLATILE_SUPPRESS[atm] * f_cap * cap_enc * arr(0.5, T, 328.15)


HTL_THERMAL = {  # T80 at 85 °C [h], Ea
    "spiro_litfsi": (150.0, 1.0),   # Li-TFSI + tBP: sharp drop within 200 h
    "spiro_li": (3000.0, 0.8),
    "ptaa": (20000.0, 0.7), "sam": (20000.0, 0.7), "nio": (40000.0, 0.7), "pedot": (5000.0, 0.7),
}
HTL_RADIATION = {"spiro_litfsi": 3.0, "spiro_li": 3.0, "ptaa": 1.0, "sam": 1.0, "nio": 0.8, "pedot": 1.5}


def _k_htl(s: StackSpec, T):
    t80, Ea = HTL_THERMAL.get(s.htl, (20000.0, 0.7))
    return -np.log(0.8) / t80 * arr(Ea, T, 358.15)


def _k_metal(s: StackSpec, T, suns):
    """Metal electrode - iodide reaction and diffusion. Ag without a barrier: 85 °C T80 ≈ 2000 h (estimate)."""
    base = {"ag": 2000.0, "cu": 8000.0, "au": 6000.0, "carbon": 1e6}.get(s.electrode, 5000.0)
    k = -np.log(0.8) / base * arr(0.9, T, 358.15) * (1 + 0.5 * suns)
    return k * (0.05 if s.barrier else 1.0)


def radiation_retention(fluence, htl="ptaa"):
    """Cumulative 10 MeV proton-equivalent dose -> retention. <- Weibull fitted to 1e13: 98%, 1e14: 89%."""
    f = np.asarray(fluence, float) * HTL_RADIATION.get(htl, 1.0)
    return np.exp(-(f / 1.69e15) ** 0.761)


def cycling_damage_per_cycle(dT, flexible=False):
    """Damage per thermal cycle (Coffin-Manson ΔT²). <- assumes ~1% loss after TC200 (ΔT=125)."""
    return 5e-5 * (dT / 125.0) ** 2 * (2.0 if flexible else 1.0)


# ---------------------------------------------------------------------------- simulation
MECHS = ["Oxygen + light oxidation", "Moisture", "Thermal decomposition", "Volatilization (iodine escape)", "HTL degradation", "Metal electrode", "Radiation", "Thermal cycling", "Tin oxidation", "Intrinsic (ions/interfaces)"]

# ---- Finished-cell calibration (film covered by transport layers and electrode): fitted to the medians of 11 condition groups
# (air/N2 x light/dark x room/high temperature x encapsulation) from ~1,550 measured T80 values in the Perovskite Database. Using the rates
# from bare-film experiments (Aristidou, Ruess, ...) directly on finished cells gives ~20x too short lifetimes in air + light and almost no degradation in N2; this fixes that.
# Cross-validation (fit on half, test on the rest): group-median error x11 -> x1.5. See data/stab_fit.py.
DEVICE_CAL = dict(ox=0.020, moist=0.298, thermal=0.453)
K_INT, K_INT_LIGHT, EA_INT = 6.68e-4, 2.38, 0.05   # dark 25 °C T80 ≈ 334 h, 3.4x faster at 1 sun


def _k_tin(s: StackSpec, o2_in, T):
    """Sn²⁺ -> Sn⁴⁺ oxidation (proceeds without light). Represents reports that unencapsulated Pb-Sn (50%) films lose performance
    within hours to a day in air: estimate T80 ≈ 10 h (25 °C, air, 50% Sn). Proportional to the Sn fraction."""
    if s.sn_frac <= 0 or o2_in <= 0:
        return 0.0
    return -np.log(0.8) / 10.0 * (s.sn_frac / 0.5) * (o2_in / 0.21) * arr(0.4, T, REF_T)


def simulate_aging(stack: StackSpec, cond: Conditions, n=400):
    """Efficiency retention over time and the contribution of each pathway. Returns dict(t_h, retention, by_mech{name: cumulative damage}, t80_h)."""
    atm = ATMOSPHERES[cond.atmosphere]
    T = cond.temp_C + 273.15
    t = np.concatenate([[0.0], np.geomspace(1e-3, max(cond.hours, 1e-2), n)])
    enc = ENCAPSULATIONS[cond.encapsulation]
    f_in = ingress_fraction(cond.encapsulation, t, cond.temp_C, cond.edge_width_cm)
    rh_out = cond.rh_pct if atm["rh"] is None else atm["rh"]
    o2_out = atm["o2"]
    rh_in = rh_out * f_in
    o2_in = o2_out * f_in
    dmg = {m: np.zeros_like(t) for m in MECHS}
    dt = np.diff(t)
    rates = {m: np.zeros(len(t)) for m in MECHS}
    for i, ti in enumerate(t):
        rates["Oxygen + light oxidation"][i] = _k_photooxidation(stack, o2_in[i], rh_in[i], cond.suns, T)
        rates["Moisture"][i] = _k_moisture(stack, rh_in[i], T)
        rates["Tin oxidation"][i] = _k_tin(stack, o2_in[i], T)
    rates["Thermal decomposition"][:] = _k_thermal(stack, T)
    if stack.capped and cond.calibration == "database":  # finished-cell calibration (from measured T80)
        rates["Oxygen + light oxidation"] *= DEVICE_CAL["ox"]
        rates["Moisture"] *= DEVICE_CAL["moist"]
        rates["Thermal decomposition"] *= DEVICE_CAL["thermal"]
        rates["Intrinsic (ions/interfaces)"][:] = K_INT * cond.intrinsic_scale * (1 + K_INT_LIGHT * cond.suns) * np.exp(-EA_INT / 8.617333e-5 * (1 / T - 1 / 298.15))
    rates["Volatilization (iodine escape)"][:] = _k_volatile(stack, cond.atmosphere, enc["cap"], cond.suns, T)
    rates["HTL degradation"][:] = _k_htl(stack, T)
    rates["Metal electrode"][:] = _k_metal(stack, T, cond.suns)
    for m in ["Oxygen + light oxidation", "Moisture", "Thermal decomposition", "Volatilization (iodine escape)", "HTL degradation", "Metal electrode", "Tin oxidation", "Intrinsic (ions/interfaces)"]:
        r = rates[m]
        dmg[m][1:] = np.cumsum(0.5 * (r[1:] + r[:-1]) * dt)
    if cond.radiation_flux > 0:
        dmg["Radiation"] = -np.log(radiation_retention(cond.radiation_flux * t, stack.htl))
    if cond.thermal_cycles_per_h > 0:
        flexible = cond.encapsulation in ("thin_film_ald", "polymer")
        dmg["Thermal cycling"] = cond.thermal_cycles_per_h * t * cycling_damage_per_cycle(cond.cycle_dT, flexible)
    total = sum(dmg.values())
    ret = np.exp(-total)
    t80 = float(np.interp(-np.log(0.8), total, t)) if total[-1] >= -np.log(0.8) else float("inf")
    final = {m: float(v[-1]) for m, v in dmg.items()}
    tot = sum(final.values()) or 1.0
    share = {m: v / tot for m, v in final.items()}
    return {"t_h": t, "retention": ret, "by_mech": dmg, "share": share, "t80_h": t80,
            "ingress": f_in, "rh_in": rh_in, "o2_in": o2_in}
