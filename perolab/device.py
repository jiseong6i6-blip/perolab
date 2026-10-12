"""Device model: single-junction cells and 2-terminal (series) multi-junction cells.

Method (the 'detailed balance + losses' model that tandem-design papers use as standard):
  1. Short-circuit current Jsc = q ∫ φ_sun(E) · A(E) · (1 - R) dE
  2. Radiative saturation current J0,rad = q ∫ A(E) · φ_bb(E, T) dE        (detailed balance)
  3. Non-radiative loss: J0 = J0,rad / ERE
       ERE (external radiative efficiency) = share of recombination that leaves as light. 1 is ideal,
       real perovskites are around 1e-4 to 1e-2. Voc loss = kT·ln(1/ERE)
  4. Diode equation + series resistance Rs and shunt resistance Rsh give the J-V curve
  5. Multi-junction: the same current flows through every cell, so voltages are added at equal J to find the maximum power point

Units: current density mA/cm^2, voltage V, resistance Ω·cm^2, power mW/cm^2
"""
from dataclasses import dataclass, field
from typing import Optional, Sequence

import numpy as np

from .constants import Q, H, C, KB_EV
from .optics import layer_absorptance, step_absorptance
from .spectra import solar_spectrum, total_power


def blackbody_photon_flux(E, T=300.0):
    """Hemispherical black-body photon flux [photons/(m^2 s eV)] (one front face of the cell)."""
    E = np.asarray(E, dtype=float)
    EJ = E * Q
    x = np.clip(E / (KB_EV * T), None, 700)
    return 2 * np.pi * EJ ** 2 / (H ** 3 * C ** 2) / np.expm1(x) * Q


@dataclass
class SubCell:
    """One absorber layer = one sub-cell."""
    eg: float                       # band gap [eV]
    thickness_nm: float = 500.0     # thickness
    ere: float = 1e-3               # external radiative efficiency (non-radiative loss)
    rs: float = 0.5                 # series resistance [Ω cm^2]
    rsh: float = 5e3                # shunt resistance [Ω cm^2]
    ideality: float = 1.0           # ideality factor n
    eu: float = 0.015               # Urbach energy
    alpha0: float = 2.0e5
    ideal: bool = False             # True: step absorption + zero loss (for the SQ limit)
    # segregation: give [(band gap, area fraction), ...] and J0 is summed per domain
    eg_domains: Optional[Sequence] = None
    label: str = ""


@dataclass
class CellResult:
    eg: float
    jsc: float
    voc: float
    ff: float
    pce: float
    v: np.ndarray = field(repr=False)
    j: np.ndarray = field(repr=False)


def _j0(cell: SubCell, E, A, T):
    """Saturation current [mA/cm^2]. Area-weighted sum when segregated domains exist."""
    def j0_for(eg):
        if cell.ideal:
            a = step_absorptance(E, eg)
        else:
            a, _ = layer_absorptance(E, eg, cell.thickness_nm, True, cell.alpha0, cell.eu)
        return Q * np.trapezoid(a * blackbody_photon_flux(E, T), E) * 0.1  # A/m^2 → mA/cm^2

    if cell.eg_domains:
        j0r = sum(frac * j0_for(eg) for eg, frac in cell.eg_domains)
    else:
        j0r = j0_for(cell.eg)
    ere = 1.0 if cell.ideal else cell.ere
    return j0r / ere


def jv_curve(cell: SubCell, jsc: float, j0: float, T=300.0, n_pts=3000):
    """Sweep the junction voltage Vj to get the (V, J) curve."""
    vt = cell.ideality * KB_EV * T
    voc_guess = vt * np.log(max(jsc, 1e-12) / max(j0, 1e-300) + 1)
    vj = np.linspace(-0.2, voc_guess + 0.05, n_pts)
    rs = 0.0 if cell.ideal else cell.rs * 1e-3   # Ω cm^2 → V per (mA/cm^2)
    rsh = np.inf if cell.ideal else cell.rsh * 1e-3
    j = jsc - j0 * np.expm1(vj / vt) - vj / rsh
    v = vj - j * rs
    return v, j


def _metrics(v, j, p_in):
    p = v * j
    i = int(np.argmax(p))
    jsc = float(np.interp(0.0, v, j)) if v[0] <= 0 <= v[-1] else float(j[0])
    order = np.argsort(j)
    voc = float(np.interp(0.0, j[order], v[order]))
    pmax = float(p[i])
    ff = pmax / (jsc * voc) if jsc > 0 and voc > 0 else 0.0
    return jsc, voc, ff, float(pmax / p_in * 100)


def subcell_generation(cells: Sequence[SubCell], E, phi, reflect=0.02, icl_loss=0.02):
    """Jsc and absorptance of each sub-cell as light is absorbed from the top down.

    icl_loss: fraction of light lost in each interconnecting layer (ICL) (parasitic absorption, reflection)
    """
    flux = phi * (1 - reflect)
    out = []
    for k, cell in enumerate(cells):
        last = k == len(cells) - 1
        if cell.ideal:
            A = step_absorptance(E, cell.eg)
            T = 1 - A if not last else np.zeros_like(A)
        else:
            A, T = layer_absorptance(E, cell.eg, cell.thickness_nm, back_reflector=last,
                                     alpha0=cell.alpha0, eu=cell.eu)
        jsc = Q * np.trapezoid(flux * A, E) * 0.1  # mA/cm^2
        out.append((jsc, A))
        flux = flux * T * (1 - (0 if cell.ideal else icl_loss))
    return out


def simulate(cells: Sequence[SubCell], spectrum="AM1.5G", T=300.0, reflect=0.02, icl_loss=0.02):
    """Simulate a single or multi-junction (2-terminal series) cell.

    Returns: dict(total=CellResult, subcells=[CellResult...], limiting=index of the current-limiting cell)
    """
    E, phi = solar_spectrum(spectrum)
    p_in = total_power(E, phi) * 0.1  # W/m^2 → mW/cm^2
    if all(c.ideal for c in cells):
        reflect = 0.0
    gen = subcell_generation(cells, E, phi, reflect, icl_loss)

    curves, subs = [], []
    for cell, (jsc, A) in zip(cells, gen):
        j0 = _j0(cell, E, A, T)
        v, j = jv_curve(cell, jsc, j0, T)
        curves.append((v, j))
        sj, sv, sff, spce = _metrics(v, j, p_in)
        subs.append(CellResult(cell.eg, sj, sv, sff, spce, v, j))

    if len(cells) == 1:
        total = subs[0]
    else:
        j_lim = min(s.jsc for s in subs)
        j_grid = np.linspace(-0.05 * j_lim, j_lim * 0.99999, 4000)
        v_tot = np.zeros_like(j_grid)
        for v, j in curves:
            order = np.argsort(j)
            v_tot += np.interp(j_grid, j[order], v[order])
        jsc_t, voc_t, ff_t, pce_t = _metrics(v_tot[::-1], j_grid[::-1], p_in)
        total = CellResult(float("nan"), jsc_t, voc_t, ff_t, pce_t, v_tot, j_grid)

    limiting = int(np.argmin([s.jsc for s in subs]))
    return {"total": total, "subcells": subs, "limiting": limiting, "p_in": float(p_in)}


def sq_limit(eg, spectrum="AM1.5G", T=300.0):
    """Shockley-Queisser limit efficiency [%]."""
    return simulate([SubCell(eg=eg, ideal=True)], spectrum, T)["total"].pce


def match_thickness(top: SubCell, bottom: SubCell, spectrum="AM1.5G",
                    t_range=(50, 1500), icl_loss=0.02):
    """Match the two currents of a 2-junction cell by adjusting the top-cell thickness (current matching).

    A thicker top cell raises top Jsc and lowers bottom Jsc, so bisection finds the crossing.
    """
    from dataclasses import replace

    def diff(t):
        r = simulate([replace(top, thickness_nm=t), bottom], spectrum, icl_loss=icl_loss)
        return r["subcells"][0].jsc - r["subcells"][1].jsc

    lo, hi = t_range
    if diff(hi) < 0:
        return hi  # even at maximum thickness the top current is short -> the top cell limits
    if diff(lo) > 0:
        return lo
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        if diff(mid) > 0:
            hi = mid
        else:
            lo = mid
    return 0.5 * (lo + hi)


def optimize_thickness(cells: Sequence[SubCell], spectrum="AM1.5G", icl_loss=0.02,
                       bounds=(50.0, 2000.0)):
    """Adjust every cell thickness except the bottom one to maximize total efficiency (automatic current matching)."""
    from dataclasses import replace
    from scipy.optimize import minimize

    cells = list(cells)
    if len(cells) < 2:
        return cells, simulate(cells, spectrum, icl_loss=icl_loss)
    lo, hi = bounds

    def build(logt):
        t = np.clip(np.exp(logt), lo, hi)
        return [replace(c, thickness_nm=float(tt)) for c, tt in zip(cells[:-1], t)] + [cells[-1]]

    def neg(logt):
        return -simulate(build(logt), spectrum, icl_loss=icl_loss)["total"].pce

    x0 = np.log([c.thickness_nm for c in cells[:-1]])
    res = minimize(neg, x0, method="Nelder-Mead", options={"xatol": 1e-3, "fatol": 1e-3, "maxiter": 300})
    best = build(res.x)
    return best, simulate(best, spectrum, icl_loss=icl_loss)
