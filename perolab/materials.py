"""Composition -> band-gap model.

In an ABX3 perovskite
  - X site: iodide (I) / bromide (Br) fraction x  -> wider gap (top cells)
  - B site: lead (Pb) / tin (Sn) fraction y       -> narrower gap (bottom cells, 'anomalous bowing')

Band gap = linear interpolation + bowing term.
  Eg(x) = Eg_A (1-x) + Eg_B x - b x (1-x)
b>0 bends the curve down, b<0 bends it up.

Default sources (approximate, user-adjustable):
  * MAPb(I1-xBrx)3 : Noh et al., Nano Lett. 13, 1764 (2013)
      Eg = 1.57 + 0.39x + 0.33x^2  ->  Eg_A=1.57, Eg_B=2.29, b=+0.33 (expanding gives 0.72x - b x + b x^2)
  * FA0.8Cs0.2Pb(I1-xBrx)3 : same bowing shape, end points shifted to FA-Cs values (~1.55 / ~2.30 eV)
  * (FA,MA)Pb1-ySnyI3 : Pb end 1.55 eV, Sn end 1.30 eV, bowing b=0.70
      -> ~1.25 eV at y=0.5 (matches the standard all-perovskite bottom cell)
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class BowingModel:
    name: str
    eg_a: float   # band gap at composition 0 [eV]
    eg_b: float   # band gap at composition 1 [eV]
    bowing: float # bowing parameter b [eV]
    var: str      # name of the composition variable

    def bandgap(self, frac):
        f = frac
        return self.eg_a * (1 - f) + self.eg_b * f - self.bowing * f * (1 - f)

    def fraction_for(self, eg_target, tol=1e-6):
        """Composition needed to reach a target band gap (bisection)."""
        lo, hi = 0.0, 1.0
        f_lo, f_hi = self.bandgap(lo) - eg_target, self.bandgap(hi) - eg_target
        if f_lo * f_hi > 0:
            # non-monotonic case (Pb-Sn): search only up to the minimum
            import numpy as np
            xs = np.linspace(0, 1, 2001)
            egs = self.bandgap(xs)
            i = int(np.argmin(abs(egs - eg_target)))
            return float(xs[i])
        for _ in range(100):
            mid = 0.5 * (lo + hi)
            fm = self.bandgap(mid) - eg_target
            if f_lo * fm <= 0:
                hi = mid
            else:
                lo, f_lo = mid, fm
            if hi - lo < tol:
                break
        return 0.5 * (lo + hi)


MA_I_BR = BowingModel("MAPb(I1-xBrx)3", 1.57, 2.29, 0.33, "Br fraction x")
FACS_I_BR = BowingModel("FA0.8Cs0.2Pb(I1-xBrx)3", 1.55, 2.30, 0.33, "Br fraction x")
PB_SN = BowingModel("(FA,MA)Pb1-ySnyI3", 1.55, 1.30, 0.70, "Sn fraction y")

MODELS = {"ma_ibr": MA_I_BR, "facs_ibr": FACS_I_BR, "pbsn": PB_SN}


def noh_2013(x):
    """Original paper formula for the backtest (MAPb(I1-xBrx)3)."""
    return 1.57 + 0.39 * x + 0.33 * x ** 2
