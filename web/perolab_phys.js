/* perolab physics extensions: instead of stopping at 'reproducing' paper values, this module lets the physical laws carry on beyond those conditions.
   (1) Gas kinetics      : Chapman-Enskog binary diffusivity + Knudsen regime -> escape probability of volatiles (continuous in gas type, pressure, temperature)
   (2) Water vapour      : Buck saturation vapour pressure -> ppm <-> relative humidity
   (3) Space thermal     : absorbed sunlight = radiated heat + electrical power -> cell temperature, irradiance S/r² at r (AU), eclipse cooling
   (4) Solvent drying    : Clausius-Clapeyron vapour pressure, rotating-disk (Levich) and flat-plate boundary-layer mass transfer, Meyerhofer spin-coating thickness
   (5) Crystallization   : LaMer supersaturation + classical nucleation theory (CNT) + interface growth + JMAK coverage + LSW Ostwald ripening
   (6) Band gap vs T     : halide perovskites have dEg/dT > 0 (lattice expansion dominates)
   The comment above each function gives the source of the equation (textbook) and which constants were 'fitted'. */
(function (root) {
  "use strict";
  const R = 8.314462618, KB = 1.380649e-23, NA = 6.02214076e23, SIGMA = 5.670374419e-8;

  // ============================ (1) gas kinetics ============================
  // Lennard-Jones parameters: Bird, Stewart, Lightfoot, Transport Phenomena appendix table (σ [Å], ε/k [K], M [g/mol])
  const LJ = {
    N2: { s: 3.798, e: 71.4, M: 28.014, name: "Nitrogen" },
    Ar: { s: 3.542, e: 93.3, M: 39.948, name: "Argon" },
    He: { s: 2.551, e: 10.22, M: 4.003, name: "Helium" },
    air: { s: 3.711, e: 78.6, M: 28.96, name: "Air" },
    CO2: { s: 3.941, e: 195.2, M: 44.01, name: "Carbon dioxide" },
    O2: { s: 3.467, e: 106.7, M: 32.0, name: "Oxygen" },
    H2O: { s: 2.641, e: 809.1, M: 18.015, name: "Water vapour" },
    I2: { s: 5.160, e: 474.2, M: 253.8, name: "Iodine" },
    HI: { s: 4.211, e: 288.7, M: 127.9, name: "Hydrogen iodide" },
  };
  // Neufeld et al. (1972) collision-integral approximation Ω_D(T*)
  function omegaD(Ts) {
    return 1.06036 / Math.pow(Ts, 0.15610) + 0.19300 / Math.exp(0.47635 * Ts) + 1.03587 / Math.exp(1.52996 * Ts) + 1.76474 / Math.exp(3.89411 * Ts);
  }
  /** Chapman-Enskog binary diffusivity [m²/s]. T [K], P [Pa] */
  function diffCoef(a, b, T, P) {
    const A = LJ[a], B = LJ[b];
    const sAB = (A.s + B.s) / 2, eAB = Math.sqrt(A.e * B.e), MAB = 2 / (1 / A.M + 1 / B.M);
    const D_cm2 = 0.00266 * Math.pow(T, 1.5) / ((P / 1e5) * Math.sqrt(MAB) * sAB * sAB * omegaD(T / eAB));
    return D_cm2 * 1e-4;
  }
  const meanSpeed = (Mgmol, T) => Math.sqrt(8 * R * T / (Math.PI * Mgmol * 1e-3));
  const meanFreePath = (gas, T, P) => KB * T / (Math.SQRT2 * Math.PI * Math.pow(LJ[gas].s * 1e-10, 2) * Math.max(P, 1e-30));
  /** Probability that a volatile (iodine) leaving the surface escapes instead of re-adsorbing.
      Diffusion through the boundary layer δ (molecular ⊕ Knudsen) competes with re-adsorption (sticking coefficient s × thermal speed/4).
      <- one fitted constant: s = 0.024 (matches Ruess 2020: 1/100 as fast in 1 atm N2 at 55 °C as in vacuum) */
  const STICK = 0.024, DELTA = 1e-3;
  function escapeProbability(gas, T, P, delta = DELTA) {
    const vbar = meanSpeed(LJ.I2.M, T);
    const DKn = vbar * delta / 3;
    const Dmol = gas === "vacuum" || P <= 0 ? Infinity : diffCoef("I2", gas, T, P);
    const Deff = 1 / (1 / Dmol + 1 / DKn);
    const out = Deff / delta, back = STICK * vbar / 4;
    return out / (out + back);
  }
  const ESC_VAC = escapeProbability("vacuum", 328.15, 0);

  // ============================ (2) water vapour ============================
  /** Saturation vapour pressure of water [Pa], Buck (1996) (within 0.05% from −40 to 100 °C) */
  function psatWater(TC) {
    if (TC >= 0) return 611.21 * Math.exp((18.678 - TC / 234.5) * (TC / (257.14 + TC)));
    return 611.15 * Math.exp((23.036 - TC / 333.7) * (TC / (279.82 + TC)));
  }
  const rhFromPpm = (ppm, TC, P) => Math.min(100, ppm * 1e-6 * P / psatWater(TC) * 100);

  // ============================ (3) space thermal balance ============================
  /** Solar panel temperature [K]: α S (1-η_eff) + (Earth IR) = ε σ (T⁴) × (two faces). Steady state.
      S0 = 1361 W/m² (solar constant), r in AU. */
  function panelTemperature({ r = 1, alpha = 0.9, eps = 0.85, eta = 0.2, earthIR = 0, sides = 2 } = {}) {
    const S = 1361 / (r * r);
    const absorbed = alpha * S - eta * S + 0.85 * earthIR;
    return Math.pow(Math.max(absorbed, 1e-6) / (sides * eps * SIGMA), 0.25);
  }
  /** Temperature during eclipse: m c dT/dt = -2εσT⁴ + absorbed Earth IR. Integrated in small steps instead of a closed form. */
  function eclipseCooling(T0, minutes, { eps = 0.85, earthIR = 70, mc = 1500 } = {}) {
    let T = T0; const dt = 1;
    const Tfloor = Math.pow(0.85 * earthIR / (2 * eps * SIGMA), 0.25);
    for (let t = 0; t < minutes * 60; t += dt) T += dt * (-2 * eps * SIGMA * Math.pow(T, 4) + 0.85 * earthIR) / mc;
    return { Tend: T, Tfloor };
  }
  function orbitThermal({ orbit = "leo", r = 1, mc = 1500, eta = 0.2 } = {}) {
    // LEO: ~500 km altitude, ~35 min eclipse per 95 min orbit, Earth IR ~237 W/m² × view factor 0.3
    const leo = orbit === "leo";
    const earthIR = leo ? 237 * 0.3 : 0;
    const Tsun = panelTemperature({ r, eta, earthIR: earthIR + (leo ? 0.3 * 1361 * 0.3 * 0.3 : 0) });
    if (orbit === "leo") {
      const { Tend } = eclipseCooling(Tsun, 35, { earthIR, mc });
      return { Tsun, Tecl: Tend, cyclesPerH: 24 / 1.583 / 24, dT: Tsun - Tend };
    }
    if (orbit === "geo") { // about 90 eclipses a year around the equinoxes, up to 72 min
      const { Tend } = eclipseCooling(Tsun, 72, { earthIR: 0, mc });
      return { Tsun, Tecl: Tend, cyclesPerH: 90 / 8766, dT: Tsun - Tend };
    }
    return { Tsun, Tecl: Tsun, cyclesPerH: 0, dT: 0 }; // interplanetary space: no eclipse
  }

  // ============================ (4) solvents ============================
  // boiling point Tb [K] (1 atm), vapour pressure at 20 °C P20 [Pa] (manufacturer data: DMF 2.7, DMSO 0.42, NMP 0.29, GBL 1.5, 2ME 6.2, ACN 72.8 mmHg),
  // molar mass [g/mol], viscosity [mPa s], density [kg/m³]
  const SOLVENTS = {
    DMF: { Tb: 426.1, P20: 360, M: 73.09, eta: 0.92, rho: 944, name: "DMF" },
    DMSO: { Tb: 462.2, P20: 56, M: 78.13, eta: 1.99, rho: 1100, name: "DMSO" },
    NMP: { Tb: 475.2, P20: 39, M: 99.13, eta: 1.65, rho: 1028, name: "NMP" },
    GBL: { Tb: 477.2, P20: 200, M: 86.09, eta: 1.73, rho: 1120, name: "GBL" },
    "2ME": { Tb: 397.6, P20: 830, M: 76.09, eta: 1.60, rho: 965, name: "2-Methoxyethanol" },
    ACN: { Tb: 354.8, P20: 9700, M: 41.05, eta: 0.34, rho: 786, name: "Acetonitrile" },
  };
  /** Vapour pressure [Pa]: Clausius-Clapeyron line ln P = a − ΔH/(RT) through two points (measured at 20 °C, 1 atm at the boiling point).
      Interpolated between the points, extrapolated along the same line outside (e.g. a 150 °C substrate). The effective heat of vaporization ΔH also comes from here. */
  const dHeff = (sol) => { const S = SOLVENTS[sol]; return R * Math.log(101325 / S.P20) / (1 / 293.15 - 1 / S.Tb); };
  const psat = (sol, T) => 101325 * Math.exp(-dHeff(sol) / R * (1 / T - 1 / SOLVENTS[sol].Tb));

  /** Gas-side mass-transfer coefficient k_m [m/s].
      Spin: rotating disk (Levich) k = 0.62 D^{2/3} ν^{-1/6} ω^{1/2}
      Gas knife: laminar flat-plate boundary layer k = 0.664 (D/L) Re^{1/2} Sc^{1/3}
      Natural convection: ~3 mm/s; vacuum: Hertz-Knudsen limit capped by pump speed, ~1 m/s */
  function massTransfer(mode, { rpm = 4000, gasSpeed = 20, Dv = 1e-5, nu = 1.5e-5, L = 0.01 } = {}) {
    if (mode === "spin") { const w = rpm * 2 * Math.PI / 60; return 0.62 * Math.pow(Dv, 2 / 3) * Math.pow(nu, -1 / 6) * Math.sqrt(w); }
    if (mode === "gas") { const Re = gasSpeed * L / nu; return 0.664 * Dv / L * Math.sqrt(Re) * Math.cbrt(nu / Dv); }
    if (mode === "vacuum") return 1.0;
    return 0.003;
  }

  // ============================ (5) crystallization ============================
  const VM = 1.54e-4; // perovskite molar volume [m³/mol] (FAPbI3: 632 g/mol ÷ 4.1 g/cm³)
  /** Time-integrate wet film -> drying -> nucleation -> growth -> coverage.
      Input p: {method:'spin'|'blade'|'slot'|'inkjet', rpm, wetUm (printed/blade wet-film thickness µm), conc (M),
               solvents:{DMF:0.8, DMSO:0.2}, quench:'none'|'antisolvent'|'gas'|'vacuum', gasSpeed, dripTime (s), T_C (substrate °C)}
      Returns: {thick_nm, grain_nm, coverage, Nnuc, tDry, Smax, path:[t,S,X]}
      <- 6 fitted constants: effective interface energy γ_eff, nucleation prefactor J0, precursor diffusivity k_g, solubility c_sat, gel concentration c_gel, antisolvent solubility drop
         = fitted by grid search to four typical results at 4000 rpm, 1.2 M: antisolvent (grains ~300 nm, coverage >97%), gas knife and vacuum (~400 nm, >96%), no quench (large islands, coverage ~75%)
           (cal2.js). Thickness is scaled by thickFudge to 550 nm for the reference process.
      Everything else (effects of spin speed, concentration, temperature, solvent, gas speed, wet-film thickness) follows from the physics above. */
  const CRYS = { gamma: 0.010, J0: 1e23, kg: 1e-12, csat0: 550, anti: 0.5, dmsoRetard: 6, thickFudge: 1.326, asp: 0.3, cgel: 3500 };
  function crystallize(p) {
    const T = (p.T_C ?? 25) + 273.15, x = p.solvents || { DMF: 0.8, DMSO: 0.2 };
    const keys = Object.keys(x).filter((k) => x[k] > 0 && SOLVENTS[k]), xs = keys.reduce((a, k) => a + x[k], 0) || 1;
    const frac = Object.fromEntries(keys.map((k) => [k, x[k] / xs]));
    const pvap = keys.reduce((a, k) => a + frac[k] * psat(k, T), 0);                    // Raoult
    const Mmix = keys.reduce((a, k) => a + frac[k] * SOLVENTS[k].M, 0) * 1e-3;
    const rho = keys.reduce((a, k) => a + frac[k] * SOLVENTS[k].rho, 0);
    // viscosity: Arrhenius temperature dependence of solvent viscosity (activation ~10 kJ/mol) × solute concentration effect
    const eta = keys.reduce((a, k) => a + frac[k] * SOLVENTS[k].eta, 0) * 1e-3 * (1 + 1.2 * (p.conc ?? 1.2)) * Math.exp(1200 * (1 / T - 1 / 298.15));
    const dmso = (frac.DMSO || 0) + 0.8 * (frac.NMP || 0);                               // solvents that form Lewis-base intermediates
    const method = p.method || "spin", quench = p.quench || "none";
    const kmBase = massTransfer(method === "spin" ? "spin" : "still", { rpm: p.rpm ?? 4000 });
    const kmGas = massTransfer("gas", { gasSpeed: p.gasSpeed ?? 20 }), kmVac = massTransfer("vacuum");
    const Evol = (km) => km * pvap / (R * T) * Mmix / rho;                                 // evaporation rate [m/s, liquid height]
    let h0;
    if (method === "spin") { const w = (p.rpm ?? 4000) * 2 * Math.PI / 60; h0 = Math.cbrt(3 * eta * Evol(kmBase) / (2 * rho * w * w)) * CRYS.thickFudge; }
    else h0 = (p.wetUm ?? (method === "inkjet" ? 4 : 6)) * 1e-6;
    const C0 = (p.conc ?? 1.2) * 1000;                    // mol/m³
    const nTot = C0 * h0;                                 // solute [mol/m²]
    const thick = nTot * VM;                              // dry film thickness [m]
    const csat0 = CRYS.csat0 * (1 + 0.6 * dmso) * Math.exp(-0.004 * (T - 298));
    const Omega = VM / NA;
    const B = 16 * Math.PI * Math.pow(CRYS.gamma, 3) * Omega * Omega / (3 * Math.pow(KB * T, 3));
    const J0 = CRYS.J0 / (1 + CRYS.dmsoRetard * dmso);
    const vIsl = 2 * Math.PI / 3 * CRYS.asp;
    // precursor diffusivity in solution: Stokes-Einstein D ∝ T/η(T) - CRYS.kg at 25 °C and the reference viscosity
    const eta298 = keys.reduce((a, k) => a + frac[k] * SOLVENTS[k].eta, 0) * 1e-3 * (1 + 1.2 * (p.conc ?? 1.2));
    const Dsol = CRYS.kg * (T / 298.15) * (eta298 / eta);              // island volume = vIsl·r³ (flattened half-ellipsoid)
    let h = h0, nSol = nTot, Vs = 0, N = 0, t = 0, Smax = 0, csatEff = csat0, quenched = false;
    const dripT = Math.min(0.99, Math.max(0.01, p.dripFrac ?? 0.6)); // quench when the wet film has thinned to this fraction
    const path = [];
    let km = kmBase, lastLog = -99;
    for (let it = 0; it < 60000 && h > 2e-9 && t < 7200; it++) {
      if (!quenched && h <= h0 * dripT) {
        quenched = true;
        if (quench === "antisolvent") csatEff = csat0 * CRYS.anti;
        if (quench === "gas") km = Math.max(km, kmGas);
        if (quench === "vacuum") km = Math.max(km, kmVac);
      }
      const E = Evol(km);
      const c = nSol / h, S = c / csatEff;
      if (c >= CRYS.cgel) break;                                             // gel / solidification: end of the solution stage
      Smax = Math.max(Smax, S);
      const lnS = Math.log(Math.max(S, 1.0000001));
      const J = S > 1 ? J0 * Math.exp(-B / (lnS * lnS)) : 0;               // [1/m³ s]
      const r = N > 0 ? Math.cbrt(Vs / (vIsl * N)) : 0;
      const areaTop = N * Math.PI * r * r;
      // diffusion-limited growth: solute flux into one island = 2π D r (c − c_sat) (hemisphere approximation), D = precursor diffusivity in solution
      const growth = S > 1 && N > 0 ? N * 2 * Math.PI * Dsol * Math.max(r, 1e-9) * (c - csatEff) * VM : 0; // dVs/dt [m/s]
      let dt = Math.min(0.02 * h / E, 0.5);
      if (growth > 0) dt = Math.min(dt, 0.05 * nSol * VM / growth);
      if (J > 0) dt = Math.min(dt, Math.max(1e-7, 0.2 * (N + 1e6) / (J * h)));
      dt = Math.max(dt, 1e-8);
      N += J * h * dt;
      const dV = Math.min(growth * dt, nSol * VM);
      Vs += dV; nSol -= dV / VM;
      h -= E * dt; t += dt;
      const lt = Math.log10(t);
      if (lt - lastLog > 0.05) { lastLog = lt; path.push([t, S, 1 - Math.exp(-areaTop)]); }
    }
    if (N < 1e9) N = 1e9;                                 // almost no nuclei: treat as a few forming at the end of the film
    Vs += nSol * VM;
    const rEnd = Math.cbrt(Vs / (vIsl * N));
    const coverage = 1 - Math.exp(-N * Math.PI * rEnd * rEnd);             // JMAK 2D
    const grain = Math.sqrt(1 / N);                                        // nucleus spacing = grain size
    return { thick_nm: thick * 1e9, grain_nm: grain * 1e9, coverage, Nnuc: N, tDry: t, Smax, h0_um: h0 * 1e6, pvap, Evap_nm_s: Evol(kmBase) * 1e9, path, kmBase, dmso };
  }
  /** LSW Ostwald ripening: d³ = d0³ + K t,  K = K0 exp(-Ea/kT).
      <- fitted: 100 °C 30 min -> about +30%, 150 °C 30 min -> about 2x (reported annealing trends) */
  function ripen(d0_nm, T_C, minutes, { Ea = 0.478, K0 = 5.2e10 } = {}) {
    const K = K0 * Math.exp(-Ea / (8.617333e-5 * (T_C + 273.15)));
    return Math.cbrt(Math.pow(d0_nm, 3) + K * minutes * 60);
  }

  // ============================ (6) band gap vs temperature ============================
  /** Unlike most semiconductors, halide perovskites widen their band gap as temperature rises (+0.2 to 0.35 meV/K).
      The slope tends to shrink with more Sn -> linear interpolation. */
  const dEgdT = (sn = 0) => (0.30 - 0.15 * sn) * 1e-3;
  const egAtT = (eg300, TK, sn = 0) => eg300 + dEgdT(sn) * (TK - 300);

  const api = { LJ, diffCoef, meanSpeed, meanFreePath, escapeProbability, ESC_VAC, STICK, psatWater, rhFromPpm,
    panelTemperature, eclipseCooling, orbitThermal, SOLVENTS, psat, dHeff, massTransfer, crystallize, ripen, CRYS, dEgdT, egAtT, VM };
  root.PerolabPhys = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : globalThis);
