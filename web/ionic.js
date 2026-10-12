/* Ion-charge drift-diffusion solver (JavaScript port of perolab/ionic.py, same equations and numerics).
   IonMonger (Courtier et al. 2019) 3-layer model: ETL | perovskite | HTL, variables φ, n, p, P (halide vacancies).
   Cell-centred finite volumes + Scharfetter-Gummel, log concentrations, variable BDF2 + Newton (chord), banded LU (partial pivoting).
   In the browser it runs inside a Web Worker so the page does not freeze. Can also be required from Node. */
(function (root) {
  "use strict";
  const Q = 1.6021766209e-19, KB = 8.61733035e-5, EPS0 = 8.854187817e-12;

  const DEFAULTS = {
    T: 298, b: 400e-9, eps_p: 24.1, alpha: 1.3e7, Fph: 1.4e21, Ec: -3.7, Ev: -5.4, Dn: 1.7e-4, Dp: 1.7e-4,
    gc: 8.1e24, gv: 5.8e24, N0: 1.6e25, DIinf: 6.5e-8, EAI: 0.58, DI_override: null, tn: 3e-9, tp: 3e-7, beta: 0,
    dE: 1e24, gcE: 5e25, EcE: -4.0, bE: 100e-9, eps_E: 10, DE: 1e-5,
    dH: 1e24, gvH: 5e25, EvH: -5.1, bH: 200e-9, eps_H: 3, DH: 1e-6,
    vnE: 1e5, vpE: 10, vnH: 0.1, vpH: 1e5, N: 200, NE: 40, NH: 40, stretch: 2.5,
  };
  const VTof = (d) => KB * d.T;
  const DIof = (d) => d.DI_override != null ? d.DI_override : d.DIinf * Math.exp(-d.EAI / (KB * d.T));
  const Vbiof = (d) => (d.EcE - d.EvH) + VTof(d) * Math.log(d.dE * d.dH / (d.gcE * d.gvH));

  function tanhFaces(n, L, s, x0) {
    const f = new Float64Array(n + 1);
    for (let i = 0; i <= n; i++) { const xi = i / n; f[i] = x0 + L * (Math.tanh(s * (2 * xi - 1)) / Math.tanh(s) + 1) / 2; }
    return f;
  }
  function bern(x) {
    if (Math.abs(x) < 1e-6) return 1 - x / 2;
    const c = Math.max(-700, Math.min(700, x));
    return x / Math.expm1(c);
  }

  // ---------------- banded LU (LAPACK gbtrf/gbtrs style) ----------------
  class Band {
    constructor(n, kl, ku) { this.n = n; this.kl = kl; this.ku = ku; this.W = 2 * kl + ku + 1; this.a = new Float64Array(n * this.W); this.piv = new Int32Array(n); }
    clear() { this.a.fill(0); }
    set(i, j, v) { this.a[i * this.W + (j - i + this.kl)] = v; }
    get(i, j) { return this.a[i * this.W + (j - i + this.kl)]; }
    factor() {
      const { n, kl, ku, W, a, piv } = this;
      for (let k = 0; k < n; k++) {
        const iend = Math.min(k + kl, n - 1), jend = Math.min(k + kl + ku, n - 1);
        let p = k, mx = Math.abs(a[k * W + kl]);
        for (let i = k + 1; i <= iend; i++) { const v = Math.abs(a[i * W + (k - i + kl)]); if (v > mx) { mx = v; p = i; } }
        piv[k] = p;
        if (mx === 0) return false;
        if (p !== k) for (let j = k; j <= jend; j++) { const o1 = k * W + (j - k + kl), o2 = p * W + (j - p + kl); const t = a[o1]; a[o1] = a[o2]; a[o2] = t; }
        const akk = a[k * W + kl];
        for (let i = k + 1; i <= iend; i++) {
          const oik = i * W + (k - i + kl), l = a[oik] / akk;
          a[oik] = l;
          if (l !== 0) for (let j = k + 1; j <= jend; j++) a[i * W + (j - i + kl)] -= l * a[k * W + (j - k + kl)];
        }
      }
      return true;
    }
    solve(b) {
      const { n, kl, ku, W, a, piv } = this, x = Float64Array.from(b);
      for (let k = 0; k < n; k++) {
        const p = piv[k]; if (p !== k) { const t = x[k]; x[k] = x[p]; x[p] = t; }
        const iend = Math.min(k + kl, n - 1), xk = x[k];
        if (xk !== 0) for (let i = k + 1; i <= iend; i++) x[i] -= a[i * W + (k - i + kl)] * xk;
      }
      for (let i = n - 1; i >= 0; i--) {
        let s = x[i]; const jend = Math.min(n - 1, i + kl + ku);
        for (let j = i + 1; j <= jend; j++) s -= a[i * W + (j - i + kl)] * x[j];
        x[i] = s / a[i * W + kl];
      }
      return x;
    }
  }

  class IonicSolver {
    constructor(params, light = 1.0) {
      this.d = Object.assign({}, DEFAULTS, params);
      this.light = light;
      this.VT = VTof(this.d); this.DI = DIof(this.d); this.Vbi = Vbiof(this.d);
      this._grid(); this._layout();
      this.V = 0; this.t = 0;
      this.y = this._initialGuess(0);
      this.yPrev = null; this.dtPrev = null; this.lastDt = null; this.nJac = 0;
    }
    _grid() {
      const d = this.d;
      const fE = tanhFaces(d.NE, d.bE, 2.0, -d.bE), fP = tanhFaces(d.N, d.b, d.stretch, 0), fH = tanhFaces(d.NH, d.bH, 2.0, d.b);
      const faces = [...fE, ...Array.from(fP).slice(1), ...Array.from(fH).slice(1)];
      const nc = faces.length - 1; this.nc = nc; this.faces = Float64Array.from(faces);
      this.h = new Float64Array(nc); this.xc = new Float64Array(nc); this.reg = new Int8Array(nc);
      for (let i = 0; i < nc; i++) { this.h[i] = faces[i + 1] - faces[i]; this.xc[i] = (faces[i + 1] + faces[i]) / 2; this.reg[i] = i < d.NE ? 0 : i < d.NE + d.N ? 1 : 2; }
      this.iE = d.NE - 1; this.iP0 = d.NE; this.iP1 = d.NE + d.N - 1; this.iH = d.NE + d.N;
      const eps = this.eps = new Float64Array(nc);
      for (let i = 0; i < nc; i++) eps[i] = (this.reg[i] === 0 ? d.eps_E : this.reg[i] === 1 ? d.eps_p : d.eps_H) * EPS0;
      this.dist = new Float64Array(nc - 1); this.epsF = new Float64Array(nc - 1);
      for (let i = 0; i < nc - 1; i++) {
        this.dist[i] = this.xc[i + 1] - this.xc[i];
        const hl = this.h[i] / 2, hr = this.h[i + 1] / 2;
        this.epsF[i] = (hl + hr) / (hl / eps[i] + hr / eps[i + 1]);
      }
      const VT = this.VT;
      this.Ecr = new Float64Array(nc); this.lgc = new Float64Array(nc); this.Evr = new Float64Array(nc); this.lgv = new Float64Array(nc);
      this.Dnc = new Float64Array(nc); this.Dpc = new Float64Array(nc); this.G1 = new Float64Array(nc);
      for (let i = 0; i < nc; i++) {
        const r = this.reg[i];
        this.Ecr[i] = r === 0 ? d.EcE : d.Ec; this.lgc[i] = Math.log(r === 0 ? d.gcE : d.gc);
        this.Evr[i] = r === 2 ? d.EvH : d.Ev; this.lgv[i] = Math.log(r === 2 ? d.gvH : d.gv);
        this.Dnc[i] = r === 0 ? d.DE : d.Dn; this.Dpc[i] = r === 2 ? d.DH : d.Dp;
        if (r === 1) { const x1 = faces[i], x2 = faces[i + 1]; this.G1[i] = d.Fph * (Math.exp(-d.alpha * x1) - Math.exp(-d.alpha * x2)) / (x2 - x1); }
      }
      this.ni2 = d.gc * d.gv * Math.exp(-(d.Ec - d.Ev) / VT);
      let ws = (this.h[0] / 2) / eps[0] + (this.h[nc - 1] / 2) / eps[nc - 1];
      for (let i = 0; i < nc - 1; i++) ws += this.dist[i] / this.epsF[i];
      this.wsum = ws;
      // face diffusivities (harmonic mean)
      const harm = (D, i) => { const hl = this.h[i] / 2, hr = this.h[i + 1] / 2; return (hl + hr) / (hl / Math.max(D[i], 1e-30) + hr / Math.max(D[i + 1], 1e-30)); };
      this.DnF = new Float64Array(nc - 1); this.DpF = new Float64Array(nc - 1);
      for (let i = 0; i < nc - 1; i++) { this.DnF[i] = harm(this.Dnc, i); this.DpF[i] = harm(this.Dpc, i); }
    }
    _layout() {
      const nc = this.nc, idx = [new Int32Array(nc).fill(-1), new Int32Array(nc).fill(-1), new Int32Array(nc).fill(-1), new Int32Array(nc).fill(-1)];
      const cell = [], kind = [];
      for (let i = 0; i < nc; i++) {
        const r = this.reg[i], ks = [0]; if (r <= 1) ks.push(1); if (r >= 1) ks.push(2); if (r === 1) ks.push(3);
        for (const k of ks) { idx[k][i] = cell.length; cell.push(i); kind.push(k); }
      }
      this.idx = idx; this.nvar = cell.length; this.colCell = Int32Array.from(cell); this.colKind = Int8Array.from(kind);
      const first = new Int32Array(nc), last = new Int32Array(nc);
      for (let c = this.nvar - 1; c >= 0; c--) first[cell[c]] = c;
      for (let c = 0; c < this.nvar; c++) last[cell[c]] = c + 1;
      this.rLo = new Int32Array(this.nvar); this.rHi = new Int32Array(this.nvar);
      let kl = 0, ku = 0;
      for (let c = 0; c < this.nvar; c++) {
        const ci = cell[c]; this.rLo[c] = first[Math.max(ci - 1, 0)]; this.rHi[c] = last[Math.min(ci + 1, nc - 1)];
        kl = Math.max(kl, this.rHi[c] - 1 - c); ku = Math.max(ku, c - this.rLo[c]);
      }
      this.kl = kl; this.ku = ku;
      this.groups = [];
      for (let m = 0; m < 3; m++) for (let k = 0; k < 4; k++) {
        const g = []; for (let c = 0; c < this.nvar; c++) if (cell[c] % 3 === m && kind[c] === k) g.push(c);
        if (g.length) this.groups.push(Int32Array.from(g));
      }
      this.band = new Band(this.nvar, kl, ku);
      // work arrays
      const nc1 = nc + 1;
      this.w = { phi: new Float64Array(nc), n: new Float64Array(nc), p: new Float64Array(nc), P: new Float64Array(nc),
        Fn: new Float64Array(nc1), Fp: new Float64Array(nc1), FP: new Float64Array(nc1), Ef: new Float64Array(nc1) };
    }
    unpack(y, o) {
      const { nc, idx } = this, N0 = this.d.N0, VT = this.VT, cl = (v) => Math.exp(Math.max(-690, Math.min(200, v)));
      o = o || { phi: new Float64Array(nc), n: new Float64Array(nc), p: new Float64Array(nc), P: new Float64Array(nc) };
      for (let i = 0; i < nc; i++) {
        o.phi[i] = y[idx[0][i]] * VT;
        o.n[i] = idx[1][i] >= 0 ? 1e24 * cl(y[idx[1][i]]) : 0;
        o.p[i] = idx[2][i] >= 0 ? 1e24 * cl(y[idx[2][i]]) : 0;
        o.P[i] = idx[3][i] >= 0 ? N0 * cl(y[idx[3][i]]) : 0;
      }
      return o;
    }
    _initialGuess(V) {
      const d = this.d, VT = this.VT, nc = this.nc, y = new Float64Array(this.nvar);
      const phiL = this.Vbi - V, L0 = this.faces[0], L1 = this.faces[nc];
      const phi = new Float64Array(nc);
      for (let i = 0; i < nc; i++) phi[i] = phiL + (0 - phiL) * (this.xc[i] - L0) / (L1 - L0);
      const EF = d.EvH - VT * Math.log(d.dH / d.gvH), h = this.h;
      // equilibrium nonlinear Poisson (tridiagonal, φ only)
      const a = new Float64Array(nc), bb = new Float64Array(nc), c = new Float64Array(nc), F = new Float64Array(nc);
      for (let it = 0; it < 200; it++) {
        for (let i = 0; i < nc; i++) {
          const r = this.reg[i];
          const n = r <= 1 ? Math.exp(this.lgc[i] + Math.max(-600, Math.min(80, (EF - (this.Ecr[i] - phi[i])) / VT))) : 0;
          const p = r >= 1 ? Math.exp(this.lgv[i] + Math.max(-600, Math.min(80, ((this.Evr[i] - phi[i]) - EF) / VT))) : 0;
          const dop = r === 0 ? d.dE : r === 2 ? -d.dH : 0;
          const left = i === 0 ? this.eps[0] / (h[0] / 2) : this.epsF[i - 1] / this.dist[i - 1];
          const right = i === nc - 1 ? this.eps[nc - 1] / (h[nc - 1] / 2) : this.epsF[i] / this.dist[i];
          const phl = i === 0 ? phiL : phi[i - 1], phr = i === nc - 1 ? 0 : phi[i + 1];
          F[i] = right * (phr - phi[i]) - left * (phi[i] - phl) + Q * (p - n + dop) * h[i];
          bb[i] = -(left + right) + Q * ((-p - n) / VT) * h[i];
          a[i] = i > 0 ? left : 0; c[i] = i < nc - 1 ? right : 0;
        }
        // Thomas
        const cp = new Float64Array(nc), dp = new Float64Array(nc);
        cp[0] = c[0] / bb[0]; dp[0] = -F[0] / bb[0];
        for (let i = 1; i < nc; i++) { const m = bb[i] - a[i] * cp[i - 1]; cp[i] = c[i] / m; dp[i] = (-F[i] - a[i] * dp[i - 1]) / m; }
        const dphi = new Float64Array(nc); dphi[nc - 1] = dp[nc - 1];
        for (let i = nc - 2; i >= 0; i--) dphi[i] = dp[i] - cp[i] * dphi[i + 1];
        let mx = 0; for (let i = 0; i < nc; i++) mx = Math.max(mx, Math.abs(dphi[i]));
        const sc = mx > 0.2 ? 0.2 / mx : 1;
        for (let i = 0; i < nc; i++) phi[i] += dphi[i] * sc;
        if (mx < 1e-10) break;
      }
      for (let i = 0; i < nc; i++) {
        y[this.idx[0][i]] = phi[i] / VT;
        const n = Math.exp(this.lgc[i] + (EF - (this.Ecr[i] - phi[i])) / VT), p = Math.exp(this.lgv[i] + ((this.Evr[i] - phi[i]) - EF) / VT);
        if (this.idx[1][i] >= 0) y[this.idx[1][i]] = Math.log(Math.max(n, 1e-250) / 1e24);
        if (this.idx[2][i] >= 0) y[this.idx[2][i]] = Math.log(Math.max(p, 1e-250) / 1e24);
        if (this.idx[3][i] >= 0) y[this.idx[3][i]] = 0;
      }
      return y;
    }
    _fluxes(s, V) {
      const d = this.d, VT = this.VT, nc = this.nc, { phi, n, p, P } = s, { Fn, Fp, FP } = this.w, reg = this.reg;
      Fn.fill(0); Fp.fill(0); FP.fill(0);
      for (let i = 0; i < nc - 1; i++) {
        const ra = reg[i], rb = reg[i + 1], dist = this.dist[i];
        const ph0 = phi[i] / VT, ph1 = phi[i + 1] / VT;
        if (ra <= 1 && rb <= 1) {
          const w0 = ph0 - this.Ecr[i] / VT + this.lgc[i], w1 = ph1 - this.Ecr[i + 1] / VT + this.lgc[i + 1], dw = w1 - w0;
          Fn[i + 1] = this.DnF[i] / dist * (bern(-dw) * n[i] - bern(dw) * n[i + 1]);
        }
        if (ra >= 1 && rb >= 1) {
          const w0 = this.Evr[i] / VT - ph0 + this.lgv[i], w1 = this.Evr[i + 1] / VT - ph1 + this.lgv[i + 1], dw = w1 - w0;
          Fp[i + 1] = this.DpF[i] / dist * (bern(-dw) * p[i] - bern(dw) * p[i + 1]);
        }
        if (ra === 1 && rb === 1) { const dw = -ph1 + ph0; FP[i + 1] = this.DI / dist * (bern(-dw) * P[i] - bern(dw) * P[i + 1]); }
      }
      const wnL = (this.Vbi - V) / VT - d.EcE / VT + Math.log(d.gcE), wn0 = phi[0] / VT - this.Ecr[0] / VT + this.lgc[0];
      let dw = wn0 - wnL;
      Fn[0] = d.DE / (this.h[0] / 2) * (bern(-dw) * d.dE - bern(dw) * n[0]);
      const wpR = d.EvH / VT + Math.log(d.gvH), wpl = this.Evr[nc - 1] / VT - phi[nc - 1] / VT + this.lgv[nc - 1];
      dw = wpR - wpl;
      Fp[nc] = d.DH / (this.h[nc - 1] / 2) * (bern(-dw) * p[nc - 1] - bern(dw) * d.dH);
    }
    _iface(s) {
      const d = this.d, VT = this.VT, { phi, n, p } = s, iE = this.iE, iP0 = this.iP0, iP1 = this.iP1, iH = this.iH;
      const nL = d.gcE * d.gv * Math.exp(((d.Ev - phi[iP0]) - (d.EcE - phi[iE])) / VT);
      const nR = d.gc * d.gvH * Math.exp(((d.EvH - phi[iH]) - (d.Ec - phi[iP1])) / VT);
      const tL = Math.sqrt(nL), tR = Math.sqrt(nR);
      return [(n[iE] * p[iP0] - nL) / ((p[iP0] + tL) / d.vnE + (n[iE] + tL) / d.vpE), (n[iP1] * p[iH] - nR) / ((p[iH] + tR) / d.vnH + (n[iP1] + tR) / d.vpH)];
    }
    residual(y, hist, coefs, dt, V, consts, out) {
      const d = this.d, nc = this.nc, h = this.h, reg = this.reg, idx = this.idx;
      const s = this.unpack(y, this.w);
      this._fluxes(s, V);
      const [RL, RR] = this._iface(s);
      const { phi, n, p, P } = s, { Fn, Fp, FP, Ef } = this.w;
      for (let i = 0; i < nc - 1; i++) Ef[i + 1] = this.epsF[i] * (phi[i + 1] - phi[i]) / this.dist[i];
      Ef[0] = this.eps[0] * (phi[0] - (this.Vbi - V)) / (h[0] / 2);
      Ef[nc] = this.eps[nc - 1] * (0 - phi[nc - 1]) / (h[nc - 1] / 2);
      const scp = Q * d.N0 * 1e-9, ni = Math.sqrt(this.ni2), light = consts ? this.light : 0;
      const H0 = hist.dens[0], H1 = hist.dens[1];
      for (let i = 0; i < nc; i++) {
        const r = reg[i];
        const rho = r === 0 ? d.dE - n[i] : r === 1 ? p[i] - n[i] + P[i] - d.N0 : p[i] - d.dH;
        out[idx[0][i]] = ((Ef[i + 1] - Ef[i]) + Q * rho * h[i]) / scp;
        let Rb = 0;
        if (r === 1) { const np_ = n[i] * p[i]; Rb = d.beta * (np_ - this.ni2) + (np_ - this.ni2) / (d.tn * (p[i] + ni) + d.tp * (n[i] + ni)); }
        const G = this.G1[i] * light;
        if (idx[1][i] >= 0) {
          let src = G - Rb; if (i === this.iE) src -= RL / h[i]; if (i === this.iP1) src -= RR / h[i];
          let dc = coefs[0] * n[i]; if (consts) { dc += coefs[1] * H0.n[i]; if (coefs.length > 2) dc += coefs[2] * H1.n[i]; }
          out[idx[1][i]] = (h[i] * dc + dt * ((Fn[i + 1] - Fn[i]) - src * h[i])) / (h[i] * Math.max(H0.n[i], 1e-250));
        }
        if (idx[2][i] >= 0) {
          let src = G - Rb; if (i === this.iP0) src -= RL / h[i]; if (i === this.iH) src -= RR / h[i];
          let dc = coefs[0] * p[i]; if (consts) { dc += coefs[1] * H0.p[i]; if (coefs.length > 2) dc += coefs[2] * H1.p[i]; }
          out[idx[2][i]] = (h[i] * dc + dt * ((Fp[i + 1] - Fp[i]) - src * h[i])) / (h[i] * Math.max(H0.p[i], 1e-250));
        }
        if (idx[3][i] >= 0) {
          let dc = coefs[0] * P[i]; if (consts) { dc += coefs[1] * H0.P[i]; if (coefs.length > 2) dc += coefs[2] * H1.P[i]; }
          out[idx[3][i]] = (h[i] * dc + dt * (FP[i + 1] - FP[i])) / (h[i] * Math.max(H0.P[i], 1e-250));
        }
      }
      return out;
    }
    _jacobian(y, args) {
      const eps = 1e-6, nv = this.nvar, B = this.band, R0 = new Float64Array(nv), R1 = new Float64Array(nv);
      B.clear();
      this.residual(y, ...args, false, R0);
      const y1 = Float64Array.from(y);
      for (const g of this.groups) {
        for (const c of g) y1[c] += eps;
        this.residual(y1, ...args, false, R1);
        for (const c of g) {
          y1[c] -= eps;
          for (let r = this.rLo[c]; r < this.rHi[c]; r++) B.set(r, c, (R1[r] - R0[r]) / eps);
        }
      }
      this.nJac++;
      return B.factor();
    }
    _newton(y0, args, tol = 1e-8, maxit = 40) {
      const y = Float64Array.from(y0), R = new Float64Array(this.nvar);
      let fresh = false, prev = Infinity, m = Infinity;
      for (let it = 0; it < maxit; it++) {
        this.residual(y, ...args, true, R);
        if (!fresh) { if (!this._jacobian(y, args)) return null; fresh = true; }
        for (let i = 0; i < R.length; i++) R[i] = -R[i];
        const dy = this.band.solve(R);
        m = 0; for (let i = 0; i < dy.length; i++) { const v = Math.abs(dy[i]); if (!Number.isFinite(v)) return null; if (v > m) m = v; }
        const sc = m > 5 ? 5 / m : 1;
        for (let i = 0; i < y.length; i++) y[i] += dy[i] * sc;
        if (m < tol) return y;
        if (m > 0.5 * prev) fresh = false;
        prev = m;
      }
      return m < 1e-3 ? y : null;
    }
    _step(dt, V) {
      let coefs, hy;
      if (this.yPrev && this.dtPrev) { const w = dt / this.dtPrev; coefs = [(1 + 2 * w) / (1 + w), -(1 + w), w * w / (1 + w)]; hy = [this.y, this.yPrev]; }
      else { coefs = [1, -1]; hy = [this.y]; }
      const hist = { dens: hy.map((a) => this.unpack(a)) };
      const y0 = Float64Array.from(this.y);
      if (this.light > 0) {
        for (let i = 0; i < this.nc; i++) if (this.reg[i] === 1) {
          const boost = Math.min(dt, 3e-9) * this.G1[i] * this.light;
          for (const k of [1, 2]) { const j = this.idx[k][i], c = 1e24 * Math.exp(y0[j]); if (c < 1e-3 * boost) y0[j] = Math.log((c + boost) / 1e24); }
        }
      }
      const yn = this._newton(y0, [hist, coefs, dt, V]);
      if (!yn) return false;
      this.yPrev = this.y; this.dtPrev = dt; this.y = yn; this.t += dt; this.V = V;
      return true;
    }
    advance(Vf, tEnd, dt0 = 1e-6, dtMax = null) {
      let dt = dt0;
      while (this.t < tEnd - 1e-15 * Math.max(1, Math.abs(tEnd))) {
        dt = Math.min(dt, tEnd - this.t); if (dtMax) dt = Math.min(dt, dtMax);
        if (!this._step(dt, Vf(this.t + dt))) { dt *= 0.25; this.yPrev = null; if (dt < 1e-14) throw new Error("convergence failed"); continue; }
        dt *= 1.5;
      }
      this.lastDt = dt;
    }
    tauIon() { const LD = Math.sqrt(this.d.eps_p * EPS0 * this.VT / (Q * this.d.N0)); return this.d.b * LD / this.DI; }
    // light-on strategy. Which conditions make Newton fail when light suddenly turns on from dark equilibrium differs by parameter set
    // (thin films, weak light, strong light, extreme temperatures), so several 'light paths' are tried in turn. Each stage is 0.2 µs, so ions are effectively frozen -> result unchanged.
    //   "direct": straight to the target / "up": from 10⁻⁸ sun in 10x steps / "via1": 1 sun first, then √10x steps to the target
    _lightOn() {
      if (this.lit || !(this.light > 0)) { this.lit = true; return; }
      const L = this.light, mode = this.lightPath || "direct";
      const go = (x) => { this.light = x; this.yPrev = null; this.advance(() => this.V, this.t + 2e-7, 1e-10); };
      if (mode === "up") for (let e = -8; e < 0; e++) go(L * 10 ** e);
      if (mode === "via1" && Math.abs(Math.log10(L)) > 0.01) {
        go(1); const n = Math.ceil(Math.abs(Math.log10(L)) * 2);
        for (let k = 1; k < n; k++) go(10 ** (Math.log10(L) * k / n));
      }
      this.light = L; this.yPrev = null; this.lit = true;
    }
    settle(V, t = null) {
      this._lightOn();
      this.yPrev = null;
      if (Math.abs(V - this.V) > 1e-9) { const V0 = this.V, t0 = this.t, tr = 1e-3; this.advance((tt) => V0 + (V - V0) * Math.min((tt - t0) / tr, 1), t0 + tr, 1e-10); }
      const tEnd = this.t + (t != null ? t : 20 * this.tauIon());
      this.V = V; this.advance(() => V, tEnd, 1e-9);
    }
    current(dVdt = 0) {
      const s = this.unpack(this.y, this.w); this._fluxes(s, this.V);
      const { Fn, Fp, FP } = this.w, nc = this.nc;
      let sum = Q * (Fp[0] - Fn[0] + FP[0]) * (this.h[0] / 2) / this.eps[0] + Q * (Fp[nc] - Fn[nc] + FP[nc]) * (this.h[nc - 1] / 2) / this.eps[nc - 1];
      for (let i = 0; i < nc - 1; i++) sum += Q * (Fp[i + 1] - Fn[i + 1] + FP[i + 1]) * this.dist[i] / this.epsF[i];
      return (sum - dVdt) / this.wsum * 0.1;
    }
    scan(V0, V1, rate, dV = 0.01, onPoint = null) {
      const npts = Math.max(2, Math.round(Math.abs(V1 - V0) / dV)), T = Math.abs(V1 - V0) / rate, sg = Math.sign(V1 - V0), t0 = this.t;
      const ramp = (t) => V0 + (V1 - V0) * Math.min(Math.max((t - t0) / T, 0), 1);
      this.V = V0; const Vs = [V0], Js = [this.current(sg * rate)];
      this.yPrev = null;
      let dt = Math.min(this.lastDt || T / npts / 10, T / npts);
      for (let k = 1; k <= npts; k++) {
        this.advance(ramp, t0 + T * k / npts, dt, T / npts); dt = this.lastDt;
        Vs.push(this.V); Js.push(this.current(sg * rate));
        if (onPoint) onPoint(k / npts);
      }
      return [Vs, Js];
    }
    profiles() { const s = this.unpack(this.y); return { x: Array.from(this.xc, (v) => v * 1e9), reg: Array.from(this.reg), phi: Array.from(s.phi), n: Array.from(s.n), p: Array.from(s.p), P: Array.from(s.P) }; }
  }

  function jvMetrics(V, J, pinMWcm2 = 100) {
    const o = V.map((v, i) => [v, J[i]]).sort((a, b) => a[0] - b[0]);
    const Vs = o.map((x) => x[0]), Js = o.map((x) => x[1]);
    const interp = (x, xs, ys) => { for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + (x - xs[i - 1]) / (xs[i] - xs[i - 1]) * (ys[i] - ys[i - 1]); return ys[ys.length - 1]; };
    const jsc = interp(0, Vs, Js);
    let voc = NaN; for (let i = 0; i < Js.length - 1; i++) if (Js[i] >= 0 && Js[i + 1] < 0) { voc = Vs[i] - Js[i] * (Vs[i + 1] - Vs[i]) / (Js[i + 1] - Js[i]); break; }
    let pmax = 0; for (let i = 0; i < Vs.length; i++) pmax = Math.max(pmax, Vs[i] * Js[i]);
    return { jsc, voc, ff: jsc > 0 && voc > 0 ? pmax / (jsc * voc) : NaN, pce: pmax / pinMWcm2 * 100 };
  }
  // try the start-up (light on + ion equilibrium) along several paths. Error if all fail.
  function startSolver(params, light, Vhi) {
    let last = null;
    for (const path of ["direct", "up", "via1", "dark", "dark0"]) {
      try {
        const s = new IonicSolver(params, light);
        if (path.startsWith("dark")) {
          // equilibrate ions in the dark first (dark0: at 0 V, dark: at Vhi), then turn light on from 10⁻⁸ sun
          const L = s.light; s.light = 0; s.lit = true;
          s.settle(path === "dark0" ? 0 : Vhi);
          s.light = L; s.lit = false; s.lightPath = "up";
          if (path === "dark0") s.settle(0, 1e-3);
        } else s.lightPath = path;
        s.settle(Vhi); s.startPath = path; return s;
      } catch (e) { last = e; }
    }
    throw last || new Error("convergence failed");
  }
  function hysteresisRun(params, rate, opts = {}, progress = null) {
    const Vhi = opts.Vhi ?? 1.2, pre = opts.precond ?? 5, light = opts.light ?? 1, dV = opts.dV ?? 0.01, pin = opts.pin ?? 100 * light;
    if (progress) progress(0.02, "Light on · ion equilibrium");
    const s = startSolver(params, light, Vhi);
    if (pre) s.settle(Vhi, pre);
    if (progress) progress(0.25, "Reverse scan");
    const rev = s.scan(Vhi, 0, rate, dV, progress ? (f) => progress(0.25 + 0.37 * f, "Reverse scan") : null);
    const profRev = s.profiles();
    const fwd = s.scan(0, Vhi, rate, dV, progress ? (f) => progress(0.62 + 0.37 * f, "Forward scan") : null);
    const a = jvMetrics(rev[0], rev[1], pin), b = jvMetrics(fwd[0], fwd[1], pin);
    return { rev, fwd, a, b, HI: (a.pce - b.pce) / a.pce, tauIon: s.tauIon(), DI: s.DI, Vbi: s.Vbi, nJac: s.nJac, profile0V: profRev, startPath: s.startPath };
  }
  function steadyJV(params, opts = {}) {
    // 'steady-state' J-V with ions in equilibrium at every voltage (the very-slow-scan limit)
    const light = opts.light ?? 1, Vmax = opts.Vmax ?? 1.3, dV = opts.dV ?? 0.05, pin = opts.pin ?? 100 * light;
    const s = startSolver(params, light, 0);
    const Vs = [], Js = [];
    for (let V = 0; V <= Vmax + 1e-9; V += dV) { s.settle(V, 10 * s.tauIon()); Vs.push(V); Js.push(s.current()); if (opts.progress) opts.progress(V / Vmax); }
    return { V: Vs, J: Js, m: jvMetrics(Vs, Js, pin) };
  }

  const api = { IonicSolver, DEFAULTS, hysteresisRun, startSolver, steadyJV, jvMetrics, VTof, DIof, Vbiof, Band };
  root.PerolabIonic = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : globalThis);
