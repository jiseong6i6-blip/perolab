"""Phase-field simulator for halide segregation.

Physical model (Cahn-Hilliard equation + photo-carrier funnelling term)
------------------------------------------------------
Composition field x(r,t) = Br fraction at each point. It is conserved (atoms do not disappear), so
    ∂x/∂t = ∇·( M ∇μ )
The chemical potential (μ, the energy cost of adding one more Br at that site) is the sum of three terms:

  1) Free energy of mixing (regular-solution model)
       f = kT[x ln x + (1-x) ln(1-x)] + Ω x(1-x)
     Competition between entropy (tendency to mix) and Ω (how much the halides dislike mixing).
     If Ω < 2kT the mixed state is stable in the dark -> dark recovery happens.
  2) Gradient energy  -κ∇²x   (cost of an I/Br interface; keeps domains from becoming too fine)
  3) Carrier term  n(r)·dEg/dx
     Photo-generated electrons and holes collect where the gap is lower (I-rich) - the funnelling effect.
     Carriers move much faster than ions, so they are assumed to be in equilibrium at every instant,
     distributed with Fermi-Dirac-like occupation (at most n_max per site).
     Where carriers collect, the energy drops if Br leaves -> feedback -> segregation.
     (Same idea as the thermodynamic model of Draguta et al., Nat. Commun. 2017)

Mobility M = D_ion·x(1-x)/kT
  D_ion = D_ref · (vacancy concentration/reference) · exp(-Ea/k · (1/T - 1/300K))
  At grain boundaries D_ion is gb_factor times faster (ion highways).
  Passivation is modelled as fewer vacancies at grain boundaries.

Numerics: periodic 2-D grid, pseudo-spectral (FFT) with linearly stabilised semi-implicit time stepping.

Research strategy <-> parameter
  * Fill vacancies with SCN / additives      -> vacancy_ratio down
  * Grain-boundary passivation, larger grains -> gb_passivation up, grain_size_nm up
  * Strain relief, composition ordering      -> omega down (mixing becomes easier)
  * Extract charge quickly (MPP operation)   -> carrier_lifetime_ns down (lower steady-state carrier density)
  * Lower bromide fraction                   -> x_br down
  * Temperature, light intensity             -> temperature_K, intensity_suns
"""
from dataclasses import dataclass, field, asdict
from typing import List, Optional

import numpy as np

from .constants import KB_EV, Q
from .materials import BowingModel, FACS_I_BR


@dataclass
class SegregationParams:
    x_br: float = 0.40                  # mean Br fraction
    intensity_suns: float = 1.0         # light intensity (1 = 1 sun on the ground, AM0 is about 1.36)
    temperature_K: float = 300.0
    omega_eV: float = 0.040             # mixing interaction Ω (computed values for perovskites are tens of meV)
    kappa_eVnm2: float = 0.64           # gradient-energy coefficient
    d_ref_cm2s: float = 1e-13           # halide diffusivity at 300 K (literature 1e-14 to 1e-10, time-scale calibration)
    ea_eV: float = 0.40                 # activation energy of ion migration
    vacancy_ratio: float = 1.0          # vacancy concentration (multiple of reference)
    grain_size_nm: float = 150.0        # mean grain size (0 = no grain boundaries)
    gb_factor: float = 10.0             # grain-boundary diffusion speed-up
    gb_passivation: float = 0.0         # 0-1, how much grain-boundary vacancies are blocked
    carrier_lifetime_ns: float = 1000.0 # carrier lifetime (longer = more steady-state carriers)
    thickness_nm: float = 500.0         # film thickness (for the generation rate)
    jsc_1sun_mAcm2: float = 18.0        # photocurrent of this layer at 1 sun (for the generation rate)
    n_max: float = 0.05                 # maximum carrier occupation per formula unit
    funnel_gain: float = 1.25e4         # 3-D funnelling correction (see carrier_fraction below)
    grid: int = 96
    dx_nm: float = 4.0
    noise: float = 0.005                # initial composition noise
    seed: int = 0
    material: BowingModel = field(default=FACS_I_BR)


FU_DENSITY_M3 = 4.0e27  # density of perovskite formula units (a ≈ 0.63 nm)


def carrier_fraction(p: SegregationParams) -> float:
    """Effective carriers per formula unit used for funnelling.

    n = G·τ/ρ is the film-wide average (about 1e-6 at 1 sun). In reality carriers generated in 3-D within
    a diffusion length (~1 µm) collect into I-rich nuclei a few nm across, and the 'per-site average'
    of a 2-D grid underestimates that concentration. funnel_gain is the correction factor,
    calibrated to reproduce Hoke et al. (Chem. Sci. 2015): segregation at 1 sun for Br ≳ 0.2 within minutes.
    It is the only 'fitted' parameter in this model.
    """
    if p.intensity_suns <= 0:
        return 0.0
    j = p.jsc_1sun_mAcm2 * 10 * p.intensity_suns       # A/m^2
    g = j / (Q * p.thickness_nm * 1e-9)                  # generation rate [1/(m^3 s)]
    n = g * p.carrier_lifetime_ns * 1e-9                 # [1/m^3]
    return n / FU_DENSITY_M3 * p.funnel_gain


def _voronoi_gb(n, dx, grain_nm, rng):
    """Voronoi grain map -> grain-boundary mask."""
    if grain_nm <= 0:
        return np.zeros((n, n), bool)
    L = n * dx
    n_seeds = max(1, int(round((L / grain_nm) ** 2)))
    seeds = rng.uniform(0, L, size=(n_seeds, 2))
    xs = (np.arange(n) + 0.5) * dx
    X, Y = np.meshgrid(xs, xs, indexing="ij")
    best = np.full((n, n), np.inf)
    second = np.full((n, n), np.inf)
    for sx, sy in seeds:
        ddx = np.abs(X - sx); ddx = np.minimum(ddx, L - ddx)
        ddy = np.abs(Y - sy); ddy = np.minimum(ddy, L - ddy)
        d = np.hypot(ddx, ddy)
        second = np.where(d < best, best, np.minimum(second, d))
        best = np.minimum(best, d)
    return (second - best) < 1.5 * dx


class SegregationSim:
    def __init__(self, p: SegregationParams):
        self.p = p
        rng = np.random.default_rng(p.seed)
        n = p.grid
        self.rng = rng
        self.x = np.clip(p.x_br + p.noise * rng.standard_normal((n, n)), 1e-4, 1 - 1e-4)
        self.x += p.x_br - self.x.mean()
        self.gb = _voronoi_gb(n, p.dx_nm, p.grain_size_nm, rng)
        k = 2 * np.pi * np.fft.fftfreq(n, d=p.dx_nm)
        self.kx, self.ky = np.meshgrid(k, k, indexing="ij")
        self.k2 = self.kx ** 2 + self.ky ** 2
        self.t = 0.0
        self.history: List[dict] = []
        self._set_conditions()

    # --- change conditions (light/temperature): used for dark-recovery runs etc. ---
    def set_light(self, intensity_suns: float):
        self.p.intensity_suns = intensity_suns
        self._set_conditions()

    def set_temperature(self, T: float):
        self.p.temperature_K = T
        self._set_conditions()

    def _set_conditions(self):
        p = self.p
        self.kT = KB_EV * p.temperature_K
        arr = np.exp(-p.ea_eV / KB_EV * (1 / p.temperature_K - 1 / 300.0))
        d_bulk = p.d_ref_cm2s * 1e14 * p.vacancy_ratio * arr   # nm^2/s
        gb_mult = 1 + (p.gb_factor - 1) * (1 - p.gb_passivation)
        self.D = np.where(self.gb, d_bulk * gb_mult, d_bulk)
        self.n_avg = carrier_fraction(p)

    # --- physical quantities ---
    def bandgap(self, x=None):
        return self.p.material.bandgap(self.x if x is None else x)

    def dEg_dx(self, x):
        m = self.p.material
        return (m.eg_b - m.eg_a) - m.bowing * (1 - 2 * x)

    def carriers(self, eg):
        """Carrier distribution n(r): Fermi-like occupation, μ_c adjusted so the mean is n_avg."""
        if self.n_avg <= 0:
            return np.zeros_like(eg)
        nmax, kT, target = self.p.n_max, self.kT, min(self.n_avg, 0.999 * self.p.n_max)
        # non-degenerate (few carriers): compute directly with a Boltzmann distribution
        w = np.exp(-(eg - eg.min()) / kT)
        n = target * w / w.mean()
        if n.max() < 0.3 * nmax:
            return n
        # degenerate: Fermi-like occupation, chemical potential found by bisection
        lo, hi = eg.min() - 1.0, eg.max() + 1.0
        for _ in range(40):
            mu = 0.5 * (lo + hi)
            n = nmax / (1 + np.exp(np.clip((eg - mu) / kT, -60, 60)))
            if n.mean() > target:
                hi = mu
            else:
                lo = mu
        return n

    def _grad(self, f_hat):
        return (np.real(np.fft.ifft2(1j * self.kx * f_hat)),
                np.real(np.fft.ifft2(1j * self.ky * f_hat)))

    def chem_potential(self):
        p, x = self.p, self.x
        eg = self.bandgap()
        n = self.carriers(eg)
        mu = (self.kT * np.log(x / (1 - x)) + p.omega_eV * (1 - 2 * x)
              + n * self.dEg_dx(x))
        lap = np.real(np.fft.ifft2(-self.k2 * np.fft.fft2(x)))
        return mu - p.kappa_eVnm2 * lap, n, eg

    def step(self, dt):
        p = self.p
        mu, n, eg = self.chem_potential()
        M = self.D * self.x * (1 - self.x) / self.kT
        gx, gy = self._grad(np.fft.fft2(mu))
        flux_div = (np.real(np.fft.ifft2(1j * self.kx * np.fft.fft2(M * gx)))
                    + np.real(np.fft.ifft2(1j * self.ky * np.fft.fft2(M * gy))))
        M0 = M.max()
        S = 2 * self.kT + abs(p.omega_eV)
        denom = 1 + dt * M0 * self.k2 * (S + p.kappa_eVnm2 * self.k2)
        dx_hat = np.fft.fft2(dt * flux_div) / denom
        delta = np.real(np.fft.ifft2(dx_hat))
        self.x = np.clip(self.x + delta, 1e-5, 1 - 1e-5)
        self.t += dt
        self.last_change = float(np.abs(delta).max())
        return n, eg

    def observables(self, n=None, eg=None):
        eg = self.bandgap() if eg is None else eg
        n = self.carriers(eg) if n is None else n
        # PL peak: weak probe light (low injection) -> carriers gather at low gap with a Boltzmann distribution
        # (in the dark this is the PL that would be seen 'if measured at that moment')
        w = np.exp(-(eg - eg.min()) / self.kT)
        w /= w.sum()
        return {
            "t": self.t,
            "x_std": float(self.x.std()),
            "x_min": float(self.x.min()),
            "eg_mean": float(eg.mean()),
            "eg_min": float(eg.min()),
            # PL (photoluminescence) peak ≈ band gap where carriers sit
            "pl_peak_eV": float((w * eg).sum()),
            "i_rich_frac": float((self.x < self.p.x_br - 0.1).mean()),
        }

    def run(self, duration_s, n_snap=60, dt_max=5.0, callback=None):
        """Advance for duration_s and record observables in history."""
        t_end = self.t + duration_s
        snap_times = np.linspace(self.t, t_end, n_snap + 1)[1:]
        si = 0
        if not self.history:
            self.history.append(self.observables())
        # adaptive time step:
        #  while things are changing, accuracy-limited dt = 0.3·dx²/D_max (t½ error converged within ~10%),
        #  near a steady state dt grows so long runs (dozens of orbits) stay fast
        dt_acc = 0.3 * self.p.dx_nm ** 2 / self.D.max()
        dt = min(dt_acc, dt_max)
        while self.t < t_end - 1e-9:
            h = min(dt, t_end - self.t)
            if si < len(snap_times):
                h = min(h, max(snap_times[si] - self.t, 1e-6))
            n, eg = self.step(h)
            # under light the 'incubation' stage (nuclei just forming) is sensitive to dt, so do not grow it.
            # grow dt only when already segregated or in the dark (pure diffusion).
            settled = self.n_avg == 0 or self.x.std() > 0.05
            if settled and self.last_change < 1e-3:  # small composition change per step -> grow
                dt = min(dt * 1.25, dt_max)
            elif self.last_change > 3e-3:          # changing fast -> back to the accuracy limit
                dt = min(dt_acc, dt_max)
            while si < len(snap_times) and self.t >= snap_times[si] - 1e-9:
                obs = self.observables(n, eg)
                self.history.append(obs)
                if callback:
                    callback(self, obs)
                si += 1
        return self.history

    def bandgap_domains(self, bins=40):
        """For the device model: [(band gap, area fraction), ...]"""
        eg = self.bandgap().ravel()
        h, edges = np.histogram(eg, bins=bins)
        centers = 0.5 * (edges[1:] + edges[:-1])
        frac = h / h.sum()
        return [(float(c), float(f)) for c, f in zip(centers, frac) if f > 0]
