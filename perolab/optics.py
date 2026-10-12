"""Absorption model.

Direct-gap semiconductor: above the gap alpha ∝ sqrt(E - Eg),
below the gap an Urbach tail (weak sub-gap absorption caused by disorder
in the crystal) of the form exp((E-Eg)/Eu). The two are joined at E = Eg + Eu/2
so that both value and slope are continuous.

alpha0: sqrt prefactor [1/cm/eV^0.5]. Default 2e5 -> about 6e4 /cm at Eg+0.1 eV
        (matches measured MAPbI3 and FA-Cs films)
Eu: Urbach energy [eV]. Good perovskites are about 13-16 meV.
"""
import numpy as np


def absorption_coefficient(E, eg, alpha0=2.0e5, eu=0.015):
    E = np.asarray(E, dtype=float)
    e_join = eg + eu / 2
    above = alpha0 * np.sqrt(np.clip(E - eg, 0, None))
    tail = alpha0 * np.sqrt(eu / 2) * np.exp(np.clip((E - e_join) / eu, -700, 0))
    return np.where(E >= e_join, above, tail)  # [1/cm]


def layer_absorptance(E, eg, thickness_nm, back_reflector=True, alpha0=2.0e5, eu=0.015):
    """Absorptance A(E) and transmittance T(E) of one absorber layer.

    back_reflector=True : metal back contact, light passes twice (single cell / tandem bottom cell)
    back_reflector=False: light continues to the layer below (tandem top / middle cell)
    """
    a = absorption_coefficient(E, eg, alpha0, eu)
    d_cm = thickness_nm * 1e-7
    passes = 2.0 if back_reflector else 1.0
    A = 1.0 - np.exp(-passes * a * d_cm)
    T = np.zeros_like(A) if back_reflector else np.exp(-a * d_cm)
    return A, T


def step_absorptance(E, eg):
    """Ideal Shockley-Queisser (SQ) absorption: 100% above the gap, 0% below."""
    return (np.asarray(E) >= eg).astype(float)
