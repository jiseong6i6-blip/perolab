"""Solar spectra (AM1.5G terrestrial, AM0 space).

Uses the ASTM G-173 reference spectra shipped with pvlib.
Units returned: energy E [eV] (ascending), photon flux phi [photons / (m^2 s eV)]
"""
from functools import lru_cache

import numpy as np

from .constants import H, C, Q


@lru_cache(maxsize=4)
def _raw(kind: str):
    from pvlib.spectrum import get_reference_spectra

    s = get_reference_spectra()
    col = {"AM1.5G": "global", "AM0": "extraterrestrial"}[kind]
    wl_nm = s.index.values.astype(float)
    irr = s[col].values.astype(float)  # W / (m^2 nm)
    return wl_nm, irr


def solar_spectrum(kind: str = "AM1.5G", e_min: float = 0.31, e_max: float = 4.4, n: int = 4000):
    """Photon-flux spectrum on a uniform energy grid.

    kind: "AM1.5G" (terrestrial standard, about 1000 W/m^2) or "AM0" (outside the atmosphere, about 1366 W/m^2)
    """
    wl_nm, irr = _raw(kind)
    wl_m = wl_nm * 1e-9
    e_photon_J = H * C / wl_m
    phi_per_nm = irr / e_photon_J                     # photons/(m^2 s nm)
    E = (H * C / Q) / wl_m                            # eV
    # d(lambda)/dE = lambda^2 / (hc/q)  [nm/eV]
    dlam_dE = (wl_nm ** 2) / (H * C / Q * 1e9)
    phi_per_eV = phi_per_nm * dlam_dE
    order = np.argsort(E)
    E, phi_per_eV = E[order], phi_per_eV[order]
    grid = np.linspace(e_min, e_max, n)
    phi = np.interp(grid, E, phi_per_eV, left=0.0, right=0.0)
    return grid, phi


def total_power(E, phi):
    """Incident power [W/m^2]."""
    return np.trapezoid(phi * E * Q, E)
