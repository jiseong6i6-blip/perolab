/* perolab core - JavaScript port of the Python perolab package.
   materials · optics · device (detailed balance + losses) · segregation (phase field) · coupling
   Needs the SPECTRA global (injected at build time): {e_min, e_max, n, "AM1.5G": [...], "AM0": [...]} (values ×1e18 photons/(m² s eV)) */
(function (root) {
  "use strict";
  const Q = 1.602176634e-19, H = 6.62607015e-34, C = 2.99792458e8, KB_EV = 1.380649e-23 / Q;

  // ---------- materials ----------
  function bowing(egA, egB, b) {
    const f = (x) => egA * (1 - x) + egB * x - b * x * (1 - x);
    f.egA = egA; f.egB = egB; f.b = b;
    f.deriv = (x) => (egB - egA) - b * (1 - 2 * x);
    f.inverse = (target) => { // bisection on a monotonic range, otherwise nearest point
      let best = 0, bd = 1e9;
      for (let i = 0; i <= 2000; i++) { const x = i / 2000, d = Math.abs(f(x) - target); if (d < bd) { bd = d; best = x; } }
      return best;
    };
    return f;
  }
  const MAT = {
    MA_I_BR: bowing(1.57, 2.29, 0.33),   // Noh 2013
    FACS_I_BR: bowing(1.55, 2.30, 0.33), // FA0.8Cs0.2Pb(I1-xBrx)3
    PB_SN: bowing(1.55, 1.30, 0.70),     // (FA,MA)Pb1-ySnyI3
  };

  // ---------- spectra ----------
  const SPEC = {};
  function spectrum(kind) {
    if (SPEC[kind]) return SPEC[kind];
    const S = root.SPECTRA, n = S.n, E = new Float64Array(n), phi = new Float64Array(n);
    for (let i = 0; i < n; i++) { E[i] = S.e_min + (S.e_max - S.e_min) * i / (n - 1); phi[i] = S[kind][i] * 1e18; }
    let p = 0; for (let i = 1; i < n; i++) p += 0.5 * (phi[i] * E[i] + phi[i - 1] * E[i - 1]) * Q * (E[i] - E[i - 1]);
    return (SPEC[kind] = { E, phi, power: p });
  }
  function trapz(y, E) { let s = 0; for (let i = 1; i < E.length; i++) s += 0.5 * (y[i] + y[i - 1]) * (E[i] - E[i - 1]); return s; }

  // ---------- optics ----------
  function alpha(E, eg, a0, eu) {
    const join = eg + eu / 2;
    if (E >= join) return a0 * Math.sqrt(Math.max(E - eg, 0));
    return a0 * Math.sqrt(eu / 2) * Math.exp(Math.max((E - join) / eu, -700));
  }
  function absorptance(E, cell, backReflector) {
    const n = E.length, A = new Float64Array(n), T = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (cell.ideal) { A[i] = E[i] >= cell.eg ? 1 : 0; T[i] = backReflector ? 0 : 1 - A[i]; continue; }
      const a = alpha(E[i], cell.eg, cell.alpha0, cell.eu), d = cell.thickness_nm * 1e-7;
      A[i] = 1 - Math.exp(-(backReflector ? 2 : 1) * a * d);
      T[i] = backReflector ? 0 : Math.exp(-a * d);
    }
    return { A, T };
  }
  function bb(E, T) { const EJ = E * Q, x = Math.min(E / (KB_EV * T), 700); return 2 * Math.PI * EJ * EJ / (H ** 3 * C * C) / Math.expm1(x) * Q; }

  // ---------- device ----------
  const CELL_DEFAULTS = { thickness_nm: 500, ere: 1e-3, rs: 0.5, rsh: 5e3, ideality: 1, eu: 0.015, alpha0: 2e5, ideal: false, domains: null, dEgdT: 0 };
  const cell = (o) => Object.assign({}, CELL_DEFAULTS, o);

  function j0For(c, E, T, eg) {
    const n = E.length, y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let a;
      if (c.ideal) a = E[i] >= eg ? 1 : 0;
      else { const al = alpha(E[i], eg, c.alpha0, c.eu); a = 1 - Math.exp(-2 * al * c.thickness_nm * 1e-7); }
      y[i] = a * bb(E[i], T);
    }
    return Q * trapz(y, E) * 0.1;
  }
  function j0(c, E, T) {
    const r = c.domains ? c.domains.reduce((s, [eg, f]) => s + f * j0For(c, E, T, eg), 0) : j0For(c, E, T, c.eg);
    return r / (c.ideal ? 1 : c.ere);
  }
  function jvCurve(c, jsc, J0, T, npts) {
    const vt = c.ideality * KB_EV * T, voc = vt * Math.log(Math.max(jsc, 1e-12) / Math.max(J0, 1e-300) + 1);
    const rs = c.ideal ? 0 : c.rs * 1e-3, rsh = c.ideal ? Infinity : c.rsh * 1e-3;
    const v = new Float64Array(npts), j = new Float64Array(npts);
    for (let k = 0; k < npts; k++) {
      const vj = -0.2 + (voc + 0.05 + 0.2) * k / (npts - 1);
      j[k] = jsc - J0 * Math.expm1(vj / vt) - vj / rsh;
      v[k] = vj - j[k] * rs;
    }
    return { v, j };
  }
  function interp(x, xs, ys) { // xs ascending
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    let lo = 0, hi = xs.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] > x) hi = m; else lo = m; }
    const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
    return ys[lo] + t * (ys[hi] - ys[lo]);
  }
  function metrics(v, j, pin) { // assumes v ascending
    let pmax = -Infinity;
    for (let k = 0; k < v.length; k++) { const p = v[k] * j[k]; if (p > pmax) pmax = p; }
    const jsc = interp(0, v, j);
    // voc: j=0 on pairs sorted by ascending j
    const idx = Array.from(j.keys()).sort((a, b) => j[a] - j[b]);
    const js = Float64Array.from(idx, (i) => j[i]), vs = Float64Array.from(idx, (i) => v[i]);
    const voc = interp(0, js, vs);
    return { jsc, voc, ff: jsc > 0 && voc > 0 ? pmax / (jsc * voc) : 0, pce: pmax / pin * 100 };
  }

  function simulate(cells, specKind = "AM1.5G", opts = {}) {
    const T = opts.T || 300, icl = opts.icl ?? 0.02, npts = opts.npts || 1500, I = opts.intensity ?? 1;
    // temperature: shift each cell's band gap by dEg/dT (perovskite +0.2 to 0.35 meV/K, silicon −0.27 meV/K). Reference 300 K.
    if (T !== 300) cells = cells.map((c) => c.dEgdT ? Object.assign({}, c, { eg: c.eg + c.dEgdT * (T - 300) }) : c);
    const sp = spectrum(specKind), E = sp.E, phi = I === 1 ? sp.phi : Float64Array.from(sp.phi, (p) => p * I), pin = sp.power * 0.1 * I;
    const allIdeal = cells.every((c) => c.ideal), refl = allIdeal ? 0 : (opts.reflect ?? 0.02);
    let flux = Float64Array.from(phi, (p) => p * (1 - refl));
    const subs = [], curves = [];
    cells.forEach((c, k) => {
      const last = k === cells.length - 1, { A, T: Tr } = absorptance(E, c, last);
      const y = Float64Array.from(flux, (f, i) => f * A[i]);
      const jsc = Q * trapz(y, E) * 0.1;
      const J0 = j0(c, E, T), cv = jvCurve(c, jsc, J0, T, npts);
      curves.push(cv);
      subs.push(Object.assign({ eg: c.eg, absorbed: A, absFlux: y, thickness_nm: c.thickness_nm }, metrics(cv.v, cv.j, pin)));
      const loss = c.ideal ? 0 : icl;
      flux = Float64Array.from(flux, (f, i) => f * Tr[i] * (1 - loss));
    });
    let total;
    if (cells.length === 1) total = Object.assign({ v: curves[0].v, j: curves[0].j }, subs[0]);
    else {
      const jl = Math.min(...subs.map((s) => s.jsc)), n = 2500;
      const jg = new Float64Array(n), vt = new Float64Array(n);
      for (let k = 0; k < n; k++) jg[k] = -0.05 * jl + (jl * 0.99999 + 0.05 * jl) * k / (n - 1);
      curves.forEach(({ v, j }) => {
        const idx = Array.from(j.keys()).sort((a, b) => j[a] - j[b]);
        const js = Float64Array.from(idx, (i) => j[i]), vs = Float64Array.from(idx, (i) => v[i]);
        for (let k = 0; k < n; k++) vt[k] += interp(jg[k], js, vs);
      });
      const v = vt.slice().reverse(), j = jg.slice().reverse();
      total = Object.assign({ v, j }, metrics(v, j, pin));
    }
    let lim = 0; subs.forEach((s, k) => { if (s.jsc < subs[lim].jsc) lim = k; });
    return { total, subcells: subs, limiting: lim, pin, E };
  }
  const sqLimit = (eg, spec = "AM1.5G") => simulate([cell({ eg, ideal: true })], spec).total.pce;

  function nelderMead(f, x0, iters = 200) {
    const n = x0.length; let pts = [x0.slice()];
    for (let i = 0; i < n; i++) { const p = x0.slice(); p[i] += 0.25; pts.push(p); }
    let vals = pts.map(f);
    for (let it = 0; it < iters; it++) {
      const ord = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
      pts = ord.map((i) => pts[i]); vals = ord.map((i) => vals[i]);
      if (Math.abs(vals[n] - vals[0]) < 1e-4) break;
      const cen = new Array(n).fill(0);
      for (let i = 0; i < n; i++) for (let d = 0; d < n; d++) cen[d] += pts[i][d] / n;
      const lerp = (t) => cen.map((c, d) => c + t * (pts[n][d] - c));
      const xr = lerp(-1), fr = f(xr);
      if (fr < vals[0]) { const xe = lerp(-2), fe = f(xe); if (fe < fr) { pts[n] = xe; vals[n] = fe; } else { pts[n] = xr; vals[n] = fr; } }
      else if (fr < vals[n - 1]) { pts[n] = xr; vals[n] = fr; }
      else {
        const xc = lerp(0.5), fc = f(xc);
        if (fc < vals[n]) { pts[n] = xc; vals[n] = fc; }
        else for (let i = 1; i <= n; i++) { pts[i] = pts[i].map((x, d) => pts[0][d] + 0.5 * (x - pts[0][d])); vals[i] = f(pts[i]); }
      }
    }
    return pts[0];
  }
  /** Adjust thicknesses (except the bottom cell) to maximize efficiency (current matching) */
  function optimizeThickness(cells, spec = "AM1.5G", opts = {}) {
    if (cells.length < 2) return { cells, result: simulate(cells, spec, opts) };
    const o = Object.assign({ npts: 600 }, opts);
    const build = (lt) => cells.map((c, k) => k < cells.length - 1 ? Object.assign({}, c, { thickness_nm: Math.min(2000, Math.max(50, Math.exp(lt[k]))) }) : c);
    const best = nelderMead((lt) => -simulate(build(lt), spec, o).total.pce, cells.slice(0, -1).map((c) => Math.log(c.thickness_nm)), 120);
    const bc = build(best);
    return { cells: bc, result: simulate(bc, spec, opts) };
  }

  // ---------- FFT (radix-2, in-place) ----------
  function fft1(re, im, inv) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = 2 * Math.PI / len * (inv ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
    if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
  function makeFFT2(N) {
    const rr = new Float64Array(N), ri = new Float64Array(N);
    return function fft2(re, im, inv) {
      for (let r = 0; r < N; r++) {
        const o = r * N;
        for (let c = 0; c < N; c++) { rr[c] = re[o + c]; ri[c] = im[o + c]; }
        fft1(rr, ri, inv);
        for (let c = 0; c < N; c++) { re[o + c] = rr[c]; im[o + c] = ri[c]; }
      }
      for (let c = 0; c < N; c++) {
        for (let r = 0; r < N; r++) { rr[r] = re[r * N + c]; ri[r] = im[r * N + c]; }
        fft1(rr, ri, inv);
        for (let r = 0; r < N; r++) { re[r * N + c] = rr[r]; im[r * N + c] = ri[r]; }
      }
    };
  }

  // ---------- segregation (Cahn-Hilliard + carrier funnelling) ----------
  const SEG_DEFAULTS = {
    x_br: 0.40, intensity_suns: 1.0, temperature_K: 300, omega_eV: 0.040, kappa_eVnm2: 0.64,
    d_ref_cm2s: 1e-13, ea_eV: 0.40, vacancy_ratio: 1.0, grain_size_nm: 150, gb_factor: 10,
    gb_passivation: 0.0, carrier_lifetime_ns: 1000, thickness_nm: 500, jsc_1sun_mAcm2: 18,
    n_max: 0.05, funnel_gain: 1.25e4, grid: 64, dx_nm: 4.0, noise: 0.005, seed: 1,
  };
  function mulberry(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  class SegregationSim {
    constructor(params) {
      const p = this.p = Object.assign({}, SEG_DEFAULTS, params);
      const N = p.grid, NN = N * N, rnd = mulberry(p.seed);
      const gauss = () => { const u = Math.max(rnd(), 1e-12), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
      this.mat = MAT.FACS_I_BR; this.N = N;
      this.x = new Float64Array(NN);
      let m = 0;
      for (let i = 0; i < NN; i++) { this.x[i] = Math.min(1 - 1e-4, Math.max(1e-4, p.x_br + p.noise * gauss())); m += this.x[i]; }
      m /= NN; for (let i = 0; i < NN; i++) this.x[i] += p.x_br - m;
      this.gb = this._voronoi(rnd);
      this.k2 = new Float64Array(NN); this.kx = new Float64Array(NN); this.ky = new Float64Array(NN);
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const fr = r < N / 2 ? r : r - N, fc = c < N / 2 ? c : c - N;
        const kx = 2 * Math.PI * fr / (N * p.dx_nm), ky = 2 * Math.PI * fc / (N * p.dx_nm);
        this.kx[r * N + c] = kx; this.ky[r * N + c] = ky; this.k2[r * N + c] = kx * kx + ky * ky;
      }
      this.fft2 = makeFFT2(N);
      this.buf = Array.from({ length: 8 }, () => new Float64Array(NN));
      this.buf2 = Array.from({ length: 3 }, () => new Float64Array(NN));
      this.t = 0; this.history = []; this.dt = null; this.lastChange = 0;
      this.setConditions();
      this.history.push(this.observables());
    }
    _voronoi(rnd) {
      const p = this.p, N = p.grid, L = N * p.dx_nm, gb = new Uint8Array(N * N);
      if (p.grain_size_nm <= 0) return gb;
      const ns = Math.max(1, Math.round((L / p.grain_size_nm) ** 2)), seeds = [];
      for (let i = 0; i < ns; i++) seeds.push([rnd() * L, rnd() * L]);
      if (ns < 2) return gb;
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const X = (r + 0.5) * p.dx_nm, Y = (c + 0.5) * p.dx_nm; let b1 = Infinity, b2 = Infinity;
        for (const [sx, sy] of seeds) {
          let dx = Math.abs(X - sx); dx = Math.min(dx, L - dx); let dy = Math.abs(Y - sy); dy = Math.min(dy, L - dy);
          const d = Math.hypot(dx, dy); if (d < b1) { b2 = b1; b1 = d; } else if (d < b2) b2 = d;
        }
        gb[r * N + c] = b2 - b1 < 1.5 * p.dx_nm ? 1 : 0;
      }
      return gb;
    }
    setLight(s) { this.p.intensity_suns = s; this.setConditions(); }
    setTemperature(T) { this.p.temperature_K = T; this.setConditions(); }
    setParam(k, v) { this.p[k] = v; this.setConditions(); }
    carrierFraction() {
      const p = this.p; if (p.intensity_suns <= 0) return 0;
      const g = p.jsc_1sun_mAcm2 * 10 * p.intensity_suns / (Q * p.thickness_nm * 1e-9);
      return g * p.carrier_lifetime_ns * 1e-9 / 4e27 * p.funnel_gain;
    }
    setConditions() {
      const p = this.p; this.kT = KB_EV * p.temperature_K;
      const arr = Math.exp(-p.ea_eV / KB_EV * (1 / p.temperature_K - 1 / 300));
      const db = p.d_ref_cm2s * 1e14 * p.vacancy_ratio * arr, mult = 1 + (p.gb_factor - 1) * (1 - p.gb_passivation);
      this.D = Float64Array.from(this.gb, (g) => g ? db * mult : db);
      this.Dmax = Math.max(...this.D);
      this.nAvg = this.carrierFraction();
      this.dt = null;
    }
    bandgapAt(x) { return this.mat(x); }
    carriers(eg, out) {
      const NN = eg.length, p = this.p;
      if (this.nAvg <= 0) { out.fill(0); return out; }
      const target = Math.min(this.nAvg, 0.999 * p.n_max), kT = this.kT;
      let mn = Infinity, mx = -Infinity; for (let i = 0; i < NN; i++) { if (eg[i] < mn) mn = eg[i]; if (eg[i] > mx) mx = eg[i]; }
      let s = 0; for (let i = 0; i < NN; i++) { out[i] = Math.exp(-(eg[i] - mn) / kT); s += out[i]; }
      let peak = 0; for (let i = 0; i < NN; i++) { out[i] *= target * NN / s; if (out[i] > peak) peak = out[i]; }
      if (peak < 0.3 * p.n_max) return out;
      let lo = mn - 1, hi = mx + 1;
      for (let it = 0; it < 40; it++) {
        const mu = 0.5 * (lo + hi); let m = 0;
        for (let i = 0; i < NN; i++) { out[i] = p.n_max / (1 + Math.exp(Math.max(-60, Math.min(60, (eg[i] - mu) / kT)))); m += out[i]; }
        if (m / NN > target) hi = mu; else lo = mu;
      }
      return out;
    }
    step(h) {
      const p = this.p, N = this.N, NN = N * N, x = this.x, kT = this.kT;
      const [eg, n, re, im, mu, gx, gy, tmp] = this.buf;
      for (let i = 0; i < NN; i++) eg[i] = this.mat(x[i]);
      this.carriers(eg, n);
      // ∇²x
      re.set(x); im.fill(0); this.fft2(re, im, false);
      for (let i = 0; i < NN; i++) { re[i] *= -this.k2[i]; im[i] *= -this.k2[i]; }
      this.fft2(re, im, true);
      for (let i = 0; i < NN; i++) {
        const xi = x[i];
        mu[i] = kT * Math.log(xi / (1 - xi)) + p.omega_eV * (1 - 2 * xi) + n[i] * this.mat.deriv(xi) - p.kappa_eVnm2 * re[i];
      }
      // ∇μ
      const muRe = tmp; muRe.set(mu); const [muIm, gxi, gyi] = this.buf2; muIm.fill(0); this.fft2(muRe, muIm, false);
      for (let i = 0; i < NN; i++) {
        gx[i] = -this.kx[i] * muIm[i]; gxi[i] = this.kx[i] * muRe[i];
        gy[i] = -this.ky[i] * muIm[i]; gyi[i] = this.ky[i] * muRe[i];
      }
      this.fft2(gx, gxi, true); this.fft2(gy, gyi, true);
      // M∇μ
      let M0 = 0;
      for (let i = 0; i < NN; i++) {
        const M = this.D[i] * x[i] * (1 - x[i]) / kT; if (M > M0) M0 = M;
        gx[i] *= M; gy[i] *= M; gxi[i] = 0; gyi[i] = 0;
      }
      this.fft2(gx, gxi, false); this.fft2(gy, gyi, false);
      const S = 2 * kT + Math.abs(p.omega_eV);
      for (let i = 0; i < NN; i++) {
        // div = i kx F(gx) + i ky F(gy)
        const dr = -this.kx[i] * gxi[i] - this.ky[i] * gyi[i];
        const di = this.kx[i] * gx[i] + this.ky[i] * gy[i];
        const den = 1 + h * M0 * this.k2[i] * (S + p.kappa_eVnm2 * this.k2[i]);
        re[i] = h * dr / den; im[i] = h * di / den;
      }
      this.fft2(re, im, true);
      let ch = 0;
      for (let i = 0; i < NN; i++) {
        const v = Math.min(1 - 1e-5, Math.max(1e-5, x[i] + re[i])); const d = Math.abs(v - x[i]); if (d > ch) ch = d; x[i] = v;
      }
      this.lastChange = ch; this.t += h;
      return { eg, n };
    }
    std() { const x = this.x, NN = x.length; let m = 0, s = 0; for (const v of x) m += v; m /= NN; for (const v of x) s += (v - m) ** 2; return Math.sqrt(s / NN); }
    /** Advance by sim time span with adaptive dt (same rule as Python) */
    advance(span, dtMax = 5) {
      const dtAcc = 0.3 * this.p.dx_nm ** 2 / this.Dmax;
      if (this.dt == null) this.dt = Math.min(dtAcc, dtMax);
      const tEnd = this.t + span; let guard = 0;
      while (this.t < tEnd - 1e-9 && guard++ < 4000) {
        const h = Math.min(this.dt, tEnd - this.t);
        this.step(h);
        const settled = this.nAvg === 0 || this.std() > 0.05;
        if (settled && this.lastChange < 1e-3) this.dt = Math.min(this.dt * 1.25, dtMax);
        else if (this.lastChange > 3e-3) this.dt = Math.min(dtAcc, dtMax);
      }
      const o = this.observables(); this.history.push(o); return o;
    }
    /** Advance k steps with adaptive dt (for playback: slow motion while changing fast, fast-forward when settled) */
    steps(k, dtMax = 5) {
      const dtAcc = 0.3 * this.p.dx_nm ** 2 / this.Dmax;
      if (this.dt == null) this.dt = Math.min(dtAcc, dtMax);
      for (let i = 0; i < k; i++) {
        this.step(this.dt);
        const settled = this.nAvg === 0 || this.std() > 0.05;
        if (settled && this.lastChange < 1e-3) this.dt = Math.min(this.dt * 1.25, dtMax);
        else if (this.lastChange > 3e-3) this.dt = Math.min(dtAcc, dtMax);
      }
      return this.observables();
    }
    observables() {
      const x = this.x, NN = x.length, kT = this.kT;
      let mn = Infinity, egm = 0, xmin = 1, irich = 0;
      const eg = new Float64Array(NN);
      for (let i = 0; i < NN; i++) { eg[i] = this.mat(x[i]); if (eg[i] < mn) mn = eg[i]; egm += eg[i]; if (x[i] < xmin) xmin = x[i]; if (x[i] < this.p.x_br - 0.1) irich++; }
      let ws = 0, pl = 0;
      for (let i = 0; i < NN; i++) { const w = Math.exp(-(eg[i] - mn) / kT); ws += w; pl += w * eg[i]; }
      return { t: this.t, x_std: this.std(), x_min: xmin, eg_mean: egm / NN, eg_min: mn, pl: pl / ws, i_rich: irich / NN };
    }
    domains(bins = 30) {
      const eg = Array.from(this.x, (v) => this.mat(v)); const lo = Math.min(...eg), hi = Math.max(...eg);
      if (hi - lo < 1e-6) return [[eg[0], 1]];
      const h = new Array(bins).fill(0); for (const e of eg) h[Math.min(bins - 1, Math.floor((e - lo) / (hi - lo) * bins))]++;
      return h.map((c, k) => [lo + (k + 0.5) * (hi - lo) / bins, c / eg.length]).filter((d) => d[1] > 0);
    }
  }

  function segregationImpact(sim, topCell, stack, index = 0, spec = "AM1.5G") {
    const eg0 = sim.mat(sim.p.x_br);
    const fresh = Object.assign({}, topCell, { eg: eg0, domains: null });
    const aged = Object.assign({}, topCell, { eg: eg0, domains: sim.domains() });
    const s0 = stack ? stack.slice() : [fresh], s1 = stack ? stack.slice() : [aged];
    if (stack) { s0[index] = fresh; s1[index] = aged; }
    const b = simulate(s0, spec, { npts: 800 }).total, a = simulate(s1, spec, { npts: 800 }).total;
    return { eg0, vocBefore: b.voc, vocAfter: a.voc, dvoc: (a.voc - b.voc) * 1000, pceBefore: b.pce, pceAfter: a.pce };
  }

  const api = { MAT, spectrum, cell, simulate, sqLimit, optimizeThickness, SegregationSim, segregationImpact, SEG_DEFAULTS };
  root.Perolab = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
