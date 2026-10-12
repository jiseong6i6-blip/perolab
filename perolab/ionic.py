"""Ion-charge drift-diffusion solver (ion migration in the electric field, J-V hysteresis).

The equations follow the 3-layer model of IonMonger (Courtier, Richardson, Foster et al., J. Comput. Electron. 2019,
"IonMonger: a free and fast planar perovskite solar cell simulator with coupled ion
vacancy and charge carrier dynamics") exactly.
IonMonger is MATLAB (AGPL) code, so no code was copied; the paper's equations were solved anew in Python.
Default parameters are IonMonger's public defaults (parameters_template.m).

  ETL (electron transport layer) : electrons n, potential φ
  Perovskite                     : electrons n, holes p, halide vacancies (cationic) P, potential φ
  HTL (hole transport layer)     : holes p, potential φ

  ∂n/∂t = -∂F_n/∂x + G - R,  F_n = -D_n(∂n/∂x - n ∂w_n/∂x)
  ∂p/∂t = -∂F_p/∂x + G - R
  ∂P/∂t = -∂F_P/∂x            (vacancies cannot leave the layer)
  ∇·(ε∇φ) = -q(p - n + P - N0 + doping)

  w_n = φ/V_T - E_c/V_T + ln g_c   (the 'energy landscape' felt by electrons, including band offsets)
  w_p = E_v/V_T - φ/V_T + ln g_v
  w_P = -φ/V_T

Numerics
  * Cell-centred finite volumes, dense tanh grid at both ends of each layer (to resolve the ~1.5 nm ion Debye length)
  * Scharfetter-Gummel flux discretization (stable even where drift dominates)
  * Concentrations solved as log variables so they stay positive (n spans 1e-40 to 1e25 m⁻³)
  * Variable-step BDF2 in time, Newton's method each step. Jacobian by column-grouped finite differences using the band structure
  * Terminal current = total current including displacement current, as a spatially weighted average

Units: SI (m, s, V, m⁻³). Output current in mA/cm².
"""
from dataclasses import dataclass, replace
from typing import Optional

import numpy as np
import scipy.sparse as sp
from scipy.sparse.linalg import splu

Q = 1.6021766209e-19
KB = 8.61733035e-5      # eV/K
EPS0 = 8.854187817e-12


@dataclass
class IonicDevice:
    """Defaults = IonMonger parameters_template.m (n-i-p, MAPbI3-type)."""
    T: float = 298.0
    # perovskite
    b: float = 400e-9
    eps_p: float = 24.1
    alpha: float = 1.3e7          # absorption coefficient [1/m]
    Fph: float = 1.4e21           # 1 sun photon flux [1/m²s] -> 22.4 mA/cm²
    Ec: float = -3.7
    Ev: float = -5.4
    Dn: float = 1.7e-4
    Dp: float = 1.7e-4
    gc: float = 8.1e24
    gv: float = 5.8e24
    N0: float = 1.6e25            # mobile vacancy density [m⁻³] (= 1.6e19 cm⁻³)
    DIinf: float = 6.5e-8
    EAI: float = 0.58             # vacancy migration activation energy [eV]
    DI_override: Optional[float] = None
    tn: float = 3e-9              # SRH pseudo-lifetime
    tp: float = 3e-7
    beta: float = 0.0             # radiative recombination coefficient [m³/s]
    # ETL
    dE: float = 1e24
    gcE: float = 5e25
    EcE: float = -4.0
    bE: float = 100e-9
    eps_E: float = 10.0
    DE: float = 1e-5
    # HTL
    dH: float = 1e24
    gvH: float = 5e25
    EvH: float = -5.1
    bH: float = 200e-9
    eps_H: float = 3.0
    DH: float = 1e-6
    # interface recombination velocities [m/s]
    vnE: float = 1e5
    vpE: float = 10.0
    vnH: float = 0.1
    vpH: float = 1e5
    # grid
    N: int = 200
    NE: int = 40
    NH: int = 40
    stretch: float = 2.5

    @property
    def DI(self):
        if self.DI_override is not None:
            return self.DI_override
        return self.DIinf * np.exp(-self.EAI / (KB * self.T))

    @property
    def VT(self):
        return KB * self.T

    @property
    def Vbi(self):
        return (self.EcE - self.EvH) + self.VT * np.log(self.dE * self.dH / (self.gcE * self.gvH))


def _tanh_cells(n, L, s, x0):
    xi = np.linspace(0, 1, n + 1)
    faces = x0 + L * (np.tanh(s * (2 * xi - 1)) / np.tanh(s) + 1) / 2
    return faces


def _bern(x):
    x = np.asarray(x, dtype=float)
    out = np.empty_like(x)
    small = np.abs(x) < 1e-6
    xs = x[~small]
    out[~small] = xs / np.expm1(np.clip(xs, -700, 700))
    out[small] = 1 - x[small] / 2
    return out


class IonicSolver:
    """Example:
        s = IonicSolver(IonicDevice())
        s.precondition(V=1.2, t=5)                 # hold 5 s at 1.2 V (same procedure as the IonMonger example)
        rev = s.scan(1.2, 0.0, rate=0.1)           # 100 mV/s reverse scan
        fwd = s.scan(0.0, 1.2, rate=0.1)           # forward
    """

    def __init__(self, dev: IonicDevice, light: float = 1.0):
        self.d = dev
        self.light = light
        self._build_grid()
        self._build_layout()
        self.V = 0.0
        self.t = 0.0
        self.y = self._initial_guess(0.0)
        self.y_prev = None
        self.dt_prev = None

    # ------------------------------------------------------------------ grid
    def _build_grid(self):
        d = self.d
        fE = _tanh_cells(d.NE, d.bE, 2.0, -d.bE)
        fP = _tanh_cells(d.N, d.b, d.stretch, 0.0)
        fH = _tanh_cells(d.NH, d.bH, 2.0, d.b)
        faces = np.concatenate([fE, fP[1:], fH[1:]])
        self.faces = faces
        self.xc = 0.5 * (faces[1:] + faces[:-1])
        self.h = np.diff(faces)
        nc = len(self.h)
        self.nc = nc
        reg = np.zeros(nc, int)               # 0=ETL 1=PVK 2=HTL
        reg[d.NE:d.NE + d.N] = 1
        reg[d.NE + d.N:] = 2
        self.reg = reg
        self.iE_last = d.NE - 1               # last ETL cell
        self.iP_first = d.NE
        self.iP_last = d.NE + d.N - 1
        self.iH_first = d.NE + d.N
        eps = np.where(reg == 0, d.eps_E, np.where(reg == 1, d.eps_p, d.eps_H)) * EPS0
        self.eps = eps
        # distance between cells and face permittivity (harmonic mean)
        self.dist = np.diff(self.xc)
        hl, hr = self.h[:-1] / 2, self.h[1:] / 2
        self.eps_face = (hl + hr) / (hl / eps[:-1] + hr / eps[1:])
        # material constants
        VT = d.VT
        self.Ec_ref = np.where(reg == 0, d.EcE, d.Ec)
        self.lng_c = np.log(np.where(reg == 0, d.gcE, d.gc))
        self.Ev_ref = np.where(reg == 2, d.EvH, d.Ev)
        self.lng_v = np.log(np.where(reg == 2, d.gvH, d.gv))
        self.Dn_cell = np.where(reg == 0, d.DE, d.Dn)
        self.Dp_cell = np.where(reg == 2, d.DH, d.Dp)
        # photogeneration (light enters from the ETL side, cell average)
        G = np.zeros(nc)
        pv = reg == 1
        x1, x2 = faces[:-1][pv], faces[1:][pv]
        G[pv] = d.Fph * (np.exp(-d.alpha * x1) - np.exp(-d.alpha * x2)) / (x2 - x1)
        self.G1 = G
        self.ni2 = d.gc * d.gv * np.exp(-(d.Ec - d.Ev) / VT)
        # current weights
        self.wsum = (self.h[0] / 2) / eps[0] + np.sum(self.dist / self.eps_face) + (self.h[-1] / 2) / eps[-1]

    def _build_layout(self):
        """Variables per cell: φ (always), n (ETL+PVK), p (PVK+HTL), P (PVK). Interleaved in cell order (banded matrix)."""
        cols = []  # (cell, kind) kind 0=φ 1=n 2=p 3=P
        idx = {k: np.full(self.nc, -1) for k in range(4)}
        for i in range(self.nc):
            r = self.reg[i]
            kinds = [0] + ([1] if r in (0, 1) else []) + ([2] if r in (1, 2) else []) + ([3] if r == 1 else [])
            for k in kinds:
                idx[k][i] = len(cols)
                cols.append((i, k))
        self.cols = cols
        self.idx = idx
        self.nvar = len(cols)
        self.has = {k: idx[k] >= 0 for k in range(4)}
        self._dy_cap = np.where(np.array([k for _, k in cols]) == 0, 3.0, 5.0)
        cell = np.array([c for c, _ in cols])
        kind = np.array([k for _, k in cols])
        self.col_cell, self.col_kind = cell, kind
        # column groups: same (cell % 3, kind) means their regions of influence do not overlap
        self.groups = [np.where((cell % 3 == m) & (kind == k))[0] for m in range(3) for k in range(4)]
        self.groups = [g for g in self.groups if len(g)]
        # rows = same layout as columns (equations of cell i)
        self.row_cell = cell
        # Jacobian sparsity: column c only affects the equations of neighbouring cells (±1)
        first = np.searchsorted(cell, np.arange(self.nc), side="left")
        last = np.searchsorted(cell, np.arange(self.nc), side="right")
        pr, pc = [], []
        for c in range(len(cols)):
            ci = cell[c]
            lo, hi = first[max(ci - 1, 0)], last[min(ci + 1, self.nc - 1)]
            pr.append(np.arange(lo, hi)); pc.append(np.full(hi - lo, c))
        self.pat_rows = np.concatenate(pr); self.pat_cols = np.concatenate(pc)
        colgroup = np.empty(len(cols), int)
        for gi, g in enumerate(self.groups):
            colgroup[g] = gi
        self.pat_group = colgroup[self.pat_cols]
        self.pat_sel = [np.where(self.pat_group == gi)[0] for gi in range(len(self.groups))]

    # ------------------------------------------------------------------ state conversion
    NREF = 1e24

    def unpack(self, y):
        nc = self.nc
        phi = np.zeros(nc); n = np.zeros(nc); p = np.zeros(nc); P = np.zeros(nc)
        phi[:] = y[self.idx[0]] * self.d.VT
        m = self.has[1]; n[m] = self.NREF * np.exp(np.clip(y[self.idx[1][m]], -690, 200))
        m = self.has[2]; p[m] = self.NREF * np.exp(np.clip(y[self.idx[2][m]], -690, 200))
        m = self.has[3]; P[m] = self.d.N0 * np.exp(np.clip(y[self.idx[3][m]], -690, 200))
        return phi, n, p, P

    def _initial_guess(self, V):
        d = self.d
        phiL, phiR = d.Vbi - V, 0.0
        x = self.xc
        L0, L1 = self.faces[0], self.faces[-1]
        phi = phiL + (phiR - phiL) * (x - L0) / (L1 - L0)
        # equilibrium Fermi level = right contact reference
        EF = d.EvH - d.VT * np.log(d.dH / d.gvH)
        y = np.zeros(self.nvar)
        y[self.idx[0]] = phi / d.VT
        Ec = self.Ec_ref - phi
        Ev = self.Ev_ref - phi
        n = np.exp(self.lng_c + (EF - Ec) / d.VT)
        p = np.exp(self.lng_v + (Ev - EF) / d.VT)
        m = self.has[1]; y[self.idx[1][m]] = np.log(np.maximum(n[m], 1e-250) / self.NREF)
        m = self.has[2]; y[self.idx[2][m]] = np.log(np.maximum(p[m], 1e-250) / self.NREF)
        m = self.has[3]; y[self.idx[3][m]] = 0.0
        return self._equilibrium_poisson(y, V)

    def _equilibrium_poisson(self, y, V):
        """Solve the dark, equilibrium (flat Fermi level) nonlinear Poisson equation for φ alone to get a good initial guess.
        Ions are uniform (N0) at this stage and rearrange themselves during time stepping."""
        d, VT = self.d, self.d.VT
        EF = d.EvH - VT * np.log(d.dH / d.gvH)
        phi = y[self.idx[0]] * VT
        r = self.reg
        h = self.h
        phiL = d.Vbi - V
        for it in range(200):
            Ec = self.Ec_ref - phi; Ev = self.Ev_ref - phi
            n = np.where(self.has[1], np.exp(self.lng_c + np.clip((EF - Ec) / VT, -600, 80)), 0.0)
            p = np.where(self.has[2], np.exp(self.lng_v + np.clip((Ev - EF) / VT, -600, 80)), 0.0)
            dop = np.where(r == 0, d.dE, np.where(r == 2, -d.dH, 0.0))
            rho = p - n + dop
            drho = (-p - n) / VT        # d rho / d phi  (n ∝ e^{φ}, p ∝ e^{-φ})
            Ef = np.zeros(self.nc + 1)
            Ef[1:-1] = self.eps_face * (phi[1:] - phi[:-1]) / self.dist
            Ef[0] = self.eps[0] * (phi[0] - phiL) / (h[0] / 2)
            Ef[-1] = self.eps[-1] * (0 - phi[-1]) / (h[-1] / 2)
            F = (Ef[1:] - Ef[:-1]) + Q * rho * h
            cL = np.concatenate([[self.eps[0] / (h[0] / 2)], self.eps_face / self.dist])
            cR = np.concatenate([self.eps_face / self.dist, [self.eps[-1] / (h[-1] / 2)]])
            main = -(cL + cR) + Q * drho * h
            J = sp.diags([main, cR[:-1], cL[1:]], [0, 1, -1], format="csc")
            dphi = splu(J).solve(-F)
            m = np.max(np.abs(dphi))
            if m > 0.2:
                dphi *= 0.2 / m
            phi = phi + dphi
            if m < 1e-10:
                break
        Ec = self.Ec_ref - phi; Ev = self.Ev_ref - phi
        y = y.copy()
        y[self.idx[0]] = phi / VT
        n = np.exp(self.lng_c + (EF - Ec) / VT); p = np.exp(self.lng_v + (Ev - EF) / VT)
        m = self.has[1]; y[self.idx[1][m]] = np.log(np.maximum(n[m], 1e-250) / self.NREF)
        m = self.has[2]; y[self.idx[2][m]] = np.log(np.maximum(p[m], 1e-250) / self.NREF)
        return y

    # ------------------------------------------------------------------ physics
    def _fluxes(self, phi, n, p, P, V):
        """Face fluxes [1/m²s] (+x direction). Length nc+1 including boundary faces."""
        d, VT = self.d, self.d.VT
        ph = phi / VT
        nc = self.nc
        wn = ph - self.Ec_ref / VT + self.lng_c
        wp = self.Ev_ref / VT - ph + self.lng_v
        wP = -ph
        Fn = np.zeros(nc + 1); Fp = np.zeros(nc + 1); FP = np.zeros(nc + 1)
        dist = self.dist
        # interior faces
        def sg(c, w, Dc, mask_face):
            dw = w[1:] - w[:-1]
            hl, hr = self.h[:-1] / 2, self.h[1:] / 2
            Df = np.where(mask_face, (hl + hr) / (hl / np.maximum(Dc[:-1], 1e-30) + hr / np.maximum(Dc[1:], 1e-30)), 0.0)
            return np.where(mask_face, Df / dist * (_bern(-dw) * c[:-1] - _bern(dw) * c[1:]), 0.0)
        hn, hp, hP = self.has[1], self.has[2], self.has[3]
        Fn[1:-1] = sg(n, wn, self.Dn_cell, hn[:-1] & hn[1:])
        Fp[1:-1] = sg(p, wp, self.Dp_cell, hp[:-1] & hp[1:])
        FP[1:-1] = sg(P, wP, np.full(nc, d.DI), hP[:-1] & hP[1:])
        # left contact (ETL, electrons = dE)
        phiL = (d.Vbi - V) / VT
        wnL = phiL - d.EcE / VT + np.log(d.gcE)
        dw = wn[0] - wnL
        Fn[0] = d.DE / (self.h[0] / 2) * (_bern(np.array([-dw]))[0] * d.dE - _bern(np.array([dw]))[0] * n[0])
        # right contact (HTL, holes = dH, φ=0)
        wpR = d.EvH / VT + np.log(d.gvH)
        dw = wpR - wp[-1]
        Fp[-1] = d.DH / (self.h[-1] / 2) * (_bern(np.array([-dw]))[0] * p[-1] - _bern(np.array([dw]))[0] * d.dH)
        return Fn, Fp, FP

    def _interface_rec(self, phi, n, p):
        """Interface recombination [1/m²s]: left (ETL electrons + PVK holes), right (PVK electrons + HTL holes)."""
        d, VT = self.d, self.d.VT
        iE, iP0, iP1, iH = self.iE_last, self.iP_first, self.iP_last, self.iH_first
        # equilibrium product (same φ reference)
        nieqL = d.gcE * d.gv * np.exp(((d.Ev - phi[iP0]) - (d.EcE - phi[iE])) / VT)
        nieqR = d.gc * d.gvH * np.exp(((d.EvH - phi[iH]) - (d.Ec - phi[iP1])) / VT)
        tL, tR = np.sqrt(nieqL), np.sqrt(nieqR)
        RL = (n[iE] * p[iP0] - nieqL) / ((p[iP0] + tL) / d.vnE + (n[iE] + tL) / d.vpE)
        RR = (n[iP1] * p[iH] - nieqR) / ((p[iH] + tR) / d.vnH + (n[iP1] + tR) / d.vpH)
        return RL, RR

    def _rates(self, n, p):
        d = self.d
        R = np.zeros(self.nc)
        pv = self.reg == 1
        ni = np.sqrt(self.ni2)
        np_ = n[pv] * p[pv]
        R[pv] = d.beta * (np_ - self.ni2) + (np_ - self.ni2) / (d.tn * (p[pv] + ni) + d.tp * (n[pv] + ni))
        return R

    def _hist_cache(self, y_hist):
        # y_hist is a bundle of (arrays, precomputed concentrations). Keyed by object id it would mix up on memory reuse, so it is passed explicitly.
        return y_hist[1]

    def residual(self, y, y_hist, coefs, dt, V, consts=True):
        """BDF residual. coefs = (a0, a1, a2): a0*c_new + a1*c_old + a2*c_older = dt*f."""
        d = self.d
        phi, n, p, P = self.unpack(y)
        Fn, Fp, FP = self._fluxes(phi, n, p, P, V)
        RL, RR = self._interface_rec(phi, n, p)
        Rb = self._rates(n, p)
        G = self.G1 * self.light if consts else np.zeros(self.nc)
        h = self.h
        out = np.zeros(self.nvar)
        # Poisson
        rho = np.zeros(self.nc)
        r = self.reg
        rho[r == 0] = d.dE - n[r == 0]
        rho[r == 1] = p[r == 1] - n[r == 1] + P[r == 1] - d.N0
        rho[r == 2] = p[r == 2] - d.dH
        E_face = np.zeros(self.nc + 1)    # 'displacement flux' of the form ε dφ/dx
        E_face[1:-1] = self.eps_face * (phi[1:] - phi[:-1]) / self.dist
        E_face[0] = self.eps[0] * (phi[0] - (d.Vbi - V)) / (h[0] / 2)
        E_face[-1] = self.eps[-1] * (0.0 - phi[-1]) / (h[-1] / 2)
        pois = (E_face[1:] - E_face[:-1]) + Q * rho * h
        scale_p = Q * d.N0 * 1e-9
        out[self.idx[0]] = pois / scale_p
        # continuity equations
        hist_dens = self._hist_cache(y_hist)
        def cont(kind, c, F, src, cscale):
            m = self.has[kind]
            c_hist = [hd[kind] for hd in hist_dens]
            dc = coefs[0] * c[m]
            if consts:   # for the Jacobian, drop large y-independent constants to keep finite differences accurate
                dc = dc + sum(a * ch[m] for a, ch in zip(coefs[1:], c_hist))
            div = (F[1:] - F[:-1])[m]
            res = h[m] * dc + dt * (div - src[m] * h[m])
            # row scaling for log variables: divide by the previous concentration -> even tiny concentrations stay numerically alive
            ref = np.maximum(c_hist[0][m], 1e-250)
            out[self.idx[kind][m]] = res / (h[m] * ref)
        srcn = G - Rb
        srcn = srcn.copy()
        srcn[self.iE_last] -= RL / h[self.iE_last]
        srcn[self.iP_last] -= RR / h[self.iP_last]
        srcp = G - Rb
        srcp = srcp.copy()
        srcp[self.iP_first] -= RL / h[self.iP_first]
        srcp[self.iH_first] -= RR / h[self.iH_first]
        cont(1, n, Fn, srcn, self.NREF)
        cont(2, p, Fp, srcp, self.NREF)
        cont(3, P, FP, np.zeros(self.nc), d.N0)
        return out

    def _jacobian(self, y, R0, args):
        eps = 1e-6
        vals = np.empty(len(self.pat_rows))
        Rv = self.residual(y, *args, consts=False)
        for gi, g in enumerate(self.groups):
            y1 = y.copy(); y1[g] += eps
            dR = (self.residual(y1, *args, consts=False) - Rv) / eps
            sel = self.pat_sel[gi]
            vals[sel] = dR[self.pat_rows[sel]]
        return sp.csc_matrix((vals, (self.pat_rows, self.pat_cols)), shape=(self.nvar, self.nvar))

    def _newton(self, y0, args, tol=1e-8, maxit=40):
        """Newton's method (accelerated as a chord method reusing the Jacobian a few times; recomputed when convergence slows)."""
        y = y0.copy()
        lu = None
        prev = np.inf
        m = np.inf
        for it in range(maxit):
            R = self.residual(y, *args)
            if lu is None:
                J = self._jacobian(y, R, args)
                try:
                    lu = splu(J)
                except RuntimeError:
                    return None, it
                self.n_jac = getattr(self, "n_jac", 0) + 1
            dy = lu.solve(-R)
            if not np.all(np.isfinite(dy)):
                return None, it
            m = np.max(np.abs(dy))
            if m > 5:
                dy *= 5 / m
            y += dy
            if m < tol:
                return y, it
            if m > 0.5 * prev:      # slow convergence -> update the Jacobian
                lu = None
            prev = m
        return (y if m < 1e-3 else None), maxit

    # ------------------------------------------------------------------ time stepping
    def _step(self, dt, V):
        """One step. BDF2 (if a previous step exists) or backward Euler."""
        if self.y_prev is not None and self.dt_prev is not None:
            w = dt / self.dt_prev
            coefs = ((1 + 2 * w) / (1 + w), -(1 + w), w * w / (1 + w))
            hy = [self.y, self.y_prev]
        else:
            coefs = (1.0, -1.0)
            hy = [self.y]
        hist = (hy, [self.unpack(a) for a in hy])
        args = (hist, coefs, dt, V)
        # predictor: add the light-generated charge in advance (minority carriers can jump dozens of orders of magnitude when light turns on)
        y0 = self.y.copy()
        if self.light > 0:
            G = self.G1 * self.light
            for kind in (1, 2):
                m = self.has[kind] & (self.reg == 1)
                c = self.NREF * np.exp(y0[self.idx[kind][m]])
                boost = min(dt, 3e-9) * G[m]
                far = c < 1e-3 * boost          # only where >1000x below steady state (light just turned on)
                c = np.where(far, c + boost, c)
                y0[self.idx[kind][m]] = np.log(c / self.NREF)
        y_new, it = self._newton(y0, args)
        if y_new is None:
            return False
        self.y_prev, self.dt_prev = self.y, dt
        self.y = y_new
        self.t += dt
        self.V = V
        return True

    def advance(self, V_func, t_end, dt0=1e-6, dt_max=None, record=None):
        """Advance to t_end. V_func(t) is the applied voltage. On failure retry with smaller dt, on success grow it."""
        dt = dt0
        while self.t < t_end - 1e-15 * max(1.0, abs(t_end)):
            dt = min(dt, t_end - self.t)
            if dt_max:
                dt = min(dt, dt_max)
            ok = self._step(dt, V_func(self.t + dt))
            if not ok:
                dt *= 0.25
                self.y_prev = None
                if dt < 1e-14:
                    raise RuntimeError("convergence failed")
                continue
            if record is not None:
                record(self)
            dt *= 1.5
        self._last_dt = dt
        return self

    def settle(self, V, t=None):
        """Advance at voltage V to steady state (including ions). Default: several ion time constants."""
        d = self.d
        LD = np.sqrt(d.eps_p * EPS0 * d.VT / (Q * d.N0))
        tau_ion = d.b * LD / d.DI
        self.y_prev = None
        if abs(V - self.V) > 1e-9:
            # a sudden voltage step defeats Newton -> ramp linearly over 1 ms (ions can barely move in that time)
            V0, t0, tr = self.V, self.t, 1e-3
            self.advance(lambda _t: V0 + (V - V0) * min((_t - t0) / tr, 1.0), t0 + tr, dt0=1e-10)
        t_end = self.t + (t if t is not None else 20 * tau_ion)
        self.V = V
        return self.advance(lambda _t: V, t_end, dt0=1e-9)

    def precondition(self, V, t):
        return self.settle(V, t)

    def current(self, dVdt=0.0):
        """Terminal current [mA/cm²] (generating direction +). Total current = conduction + displacement, spatially weighted average."""
        d = self.d
        phi, n, p, P = self.unpack(self.y)
        Fn, Fp, FP = self._fluxes(phi, n, p, P, self.V)
        jc = Q * (Fp - Fn + FP)                          # conduction current in +x
        # weight by face distance / permittivity (including boundary faces)
        w = np.concatenate([[(self.h[0] / 2) / self.eps[0]], self.dist / self.eps_face, [(self.h[-1] / 2) / self.eps[-1]]])
        # J_x = jc + ε∂E/∂t is position-independent -> divide by ε and integrate: J Σw = Σ jc w + d/dt(φ_L-φ_R) = Σ jc w - dV/dt
        J = (np.sum(jc * w) - dVdt) / self.wsum
        # electrons to the left (ETL), holes to the right (HTL) -> jc > 0 = generating direction
        return J * 0.1

    def scan(self, V0, V1, rate, dV=0.01):
        """Scan V0 -> V1 at rate [V/s]. Returns (V array, J array in mA/cm²).
        The voltage changes continuously in time; the internal step adapts to convergence."""
        n_pts = max(2, int(round(abs(V1 - V0) / dV)))
        T = abs(V1 - V0) / rate
        sgn = np.sign(V1 - V0)
        t0 = self.t
        ramp = lambda t: V0 + (V1 - V0) * min(max((t - t0) / T, 0.0), 1.0)
        self.V = V0
        Vs, Js = [V0], [self.current(sgn * rate)]
        self.y_prev = None
        dt = getattr(self, "_last_dt", None) or T / n_pts / 10
        dt = min(dt, T / n_pts)
        for k in range(1, n_pts + 1):
            self.advance(ramp, t0 + T * k / n_pts, dt0=dt, dt_max=T / n_pts)
            dt = self._last_dt
            Vs.append(self.V)
            Js.append(self.current(sgn * rate))
        return np.array(Vs), np.array(Js)

    def profiles(self):
        phi, n, p, P = self.unpack(self.y)
        return {"x_nm": self.xc * 1e9, "phi": phi, "n": n, "p": p, "P": P, "reg": self.reg}


def jv_metrics(V, J, Fph=1.4e21):
    """Jsc, Voc, FF and maximum power from a J-V curve (incident power AM1.5G 1000 W/m² = 100 mW/cm²)."""
    V = np.asarray(V); J = np.asarray(J)
    o = np.argsort(V)
    V, J = V[o], J[o]
    jsc = float(np.interp(0.0, V, J))
    s = np.where(np.diff(np.sign(J)) != 0)[0]
    voc = float(V[s[0]] - J[s[0]] * (V[s[0] + 1] - V[s[0]]) / (J[s[0] + 1] - J[s[0]])) if len(s) else float("nan")
    P = V * J
    pmax = float(np.max(P))
    ff = pmax / (jsc * voc) if jsc > 0 and voc > 0 else float("nan")
    return {"jsc": jsc, "voc": voc, "ff": ff, "pce": pmax}  # pce: mW/cm² = % (at 100 mW/cm²)


def hysteresis_index(rev, fwd):
    """HI = (PCE_rev - PCE_fwd) / PCE_rev  (the common definition)."""
    a, b = jv_metrics(*rev), jv_metrics(*fwd)
    return (a["pce"] - b["pce"]) / a["pce"], a, b


def hysteresis_scan(dev: IonicDevice, rate, V_hi=1.2, precond_t=5.0, light=1.0, dV=0.01):
    """IonMonger example procedure: precond_t seconds at V_hi -> reverse V_hi->0 -> forward 0->V_hi."""
    s = IonicSolver(dev, light=light)
    s.settle(V_hi)                 # equilibrate including ions
    if precond_t:
        s.precondition(V_hi, precond_t)
    rev = s.scan(V_hi, 0.0, rate, dV)
    fwd = s.scan(0.0, V_hi, rate, dV)
    return rev, fwd
