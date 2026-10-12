/* perolab extensions - JavaScript port of environment.py and fabrication.py (same equations, same constants).
   Load after the Perolab core (perolab_core.js). */
(function (root) {
  "use strict";
  const P = root.Perolab;
  const PH = root.PerolabPhys;   // perolab_phys.js (gas kinetics, thermal balance, crystallization)
  const KB = 8.617333e-5;
  const arr = (Ea, T, Tref) => Math.exp(-Ea / KB * (1 / T - 1 / Tref));
  const erfc = (x) => { // Abramowitz-Stegun 7.1.26 (error < 1.5e-7)
    const z = Math.abs(x), t = 1 / (1 + 0.3275911 * z);
    const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-z * z);
    return x >= 0 ? y : 2 - y;
  };

  // ======================= environment =======================
  const ATMOSPHERES = {
    air: { o2: 0.21, rh: null, label: "Ambient air" },
    dry_air: { o2: 0.21, rh: 0.5, label: "Dry air" },
    n2_glovebox: { o2: 1e-6, rh: 0.003, label: "Nitrogen glovebox" },
    ar_glovebox: { o2: 1e-6, rh: 0.003, label: "Argon glovebox" },
    vacuum: { o2: 0, rh: 0, label: "Vacuum (space)" },
  };
  const VOLATILE_SUPPRESS = { air: 0.01, dry_air: 0.01, n2_glovebox: 0.01, ar_glovebox: 0.009, vacuum: 1.0 };
  const ENCAPSULATIONS = {
    none: { K85: null, width: 0, face: 1, cap: 1, label: "No encapsulation" },
    polymer: { K85: 0.38, width: 0.05, face: 1, cap: 0.3, label: "Polymer cover only" },
    glass_glass_pib: { K85: 0.021, width: 1.0, face: 0, cap: 0.01, label: "Glass-glass + PIB edge" },
    thin_film_ald: { K85: null, width: 0, face: 0.01, cap: 0.05, label: "Thin-film encapsulation (ALD)" },
  };
  function ingress(enc, h, TC, widthCm) {
    const e = ENCAPSULATIONS[enc];
    if (e.K85 == null) return e.face;
    const w = widthCm ?? e.width;
    const K = e.K85 * Math.sqrt(arr(0.5, TC + 273.15, 358.15));
    const edge = erfc(w / (K * Math.sqrt(Math.max(h, 1e-12))));
    return Math.min(1, Math.max(edge, e.face));
  }
  function kOx(s, o2, rh, suns, T) {
    if (suns <= 0 || o2 <= 0) return 0;
    const Ea = 0.48 - 0.40 * Math.min(rh / 60, 1), humid = 1 + 2 * Math.min(rh / 60, 1);
    const fg = Math.min(4, Math.max(0.02, (s.grain_nm / 150) ** -2));
    return Math.log(5) / 4 * (o2 / 0.21) * suns * humid * fg * (s.iodide_passivation ? 0.15 : 1) *
      (s.ma_frac + 0.1 * (1 - s.ma_frac)) * (s.surface_2d ? 0.5 : 1) * arr(Ea, T, 300);
  }
  function kMoist(s, rh, T) {
    if (rh <= 0) return 0;
    return -Math.log(0.8) / 72 * (rh / 50) ** 2 * (s.ma_frac + 0.08 * (1 - s.ma_frac)) * (s.surface_2d ? 0.3 : 1) * arr(0.6, T, 298.15);
  }
  function kThermal(s, T) {
    return s.ma_frac * (-Math.log(0.8) / 36 * arr(1.5, T, 358.15)) + (1 - s.ma_frac) * (-Math.log(0.8) / 8000 * arr(0.7, T, 358.15));
  }
  // volatile suppression = (escape probability in gas) / (escape probability in vacuum). From gas kinetics -> continuous in gas type, pressure, temperature.
  //   matches the calibration points: N2 1 atm 55 °C gives 0.0099 (old table value 0.01), argon 0.0085 (table 0.009).
  function volSuppress(gas, T, P) {
    if (!PH || gas == null) return null;
    if (gas === "vacuum" || P <= 0) return 1;
    return PH.escapeProbability(gas, T, P) / PH.escapeProbability("vacuum", T, 0);
  }
  function kVol(s, atm, cap, suns, T, supp) {
    if (suns <= 0) return 0;
    const f = supp != null ? supp : VOLATILE_SUPPRESS[atm];
    return -Math.log(0.6) / 0.5 * suns * (s.ma_frac + 0.1 * (1 - s.ma_frac)) * f * (s.capped ? 0.05 : 1) * cap * arr(0.5, T, 328.15);
  }
  const HTL_THERMAL = { spiro_litfsi: [150, 1.0], spiro_li: [3000, 0.8], ptaa: [20000, 0.7], sam: [20000, 0.7], nio: [40000, 0.7], pedot: [5000, 0.7] };
  const HTL_RAD = { spiro_litfsi: 3, spiro_li: 3, ptaa: 1, sam: 1, nio: 0.8, pedot: 1.5 };
  const kHtl = (s, T) => { const [t80, Ea] = HTL_THERMAL[s.htl] || [20000, 0.7]; return -Math.log(0.8) / t80 * arr(Ea, T, 358.15); };
  const kMetal = (s, T, suns) => {
    const base = { ag: 2000, cu: 8000, au: 6000, carbon: 1e6 }[s.electrode] || 5000;
    return -Math.log(0.8) / base * arr(0.9, T, 358.15) * (1 + 0.5 * suns) * (s.barrier ? 0.05 : 1);
  };
  const radRetention = (f, htl) => Math.exp(-Math.pow(f * (HTL_RAD[htl] || 1) / 1.69e15, 0.761));
  const cycleDamage = (dT, flex) => 5e-5 * (dT / 125) ** 2 * (flex ? 2 : 1);
  const ORBITS = {
    leo: { radiation_flux: 1.8e13 / 8766, thermal_cycles_per_h: 16 / 24, cycle_dT: 60, temp_C: 5, suns: 1.36 },
    geo: { radiation_flux: 1.0e12 / 8766, thermal_cycles_per_h: 90 / 365 / 24, cycle_dT: 200, temp_C: 60, suns: 1.36 },
  };
  const MECHS = ["Oxygen + light oxidation", "Moisture", "Thermal decomposition", "Volatilization (iodine escape)", "HTL degradation", "Metal electrode", "Radiation", "Thermal cycling", "Tin oxidation", "Intrinsic (ions/interfaces)"];
  // finished-cell calibration - fitted to the medians of 11 condition groups from ~1,550 measured T80 values in the Perovskite Database (same as Python environment.py)
  const DEVICE_CAL = { ox: 0.020, moist: 0.298, thermal: 0.453 }, K_INT = 6.68e-4, K_INT_LIGHT = 2.38, EA_INT = 0.05;
  const kTin = (s, o2, T) => (!s.sn_frac || o2 <= 0) ? 0 : -Math.log(0.8) / 10 * (s.sn_frac / 0.5) * (o2 / 0.21) * arr(0.4, T, 298.15);

  // the atmosphere is read as continuous values: gas (N2, Ar, He, air, CO2, vacuum), pressure_Pa, o2_frac (mole fraction), rh_pct or h2o_ppm.
  // old names (atmosphere: "air" etc.) are still accepted.
  const LEGACY_ATM = {
    air: { gas: "air", pressure_Pa: 101325, o2_frac: 0.21 }, dry_air: { gas: "air", pressure_Pa: 101325, o2_frac: 0.21, rh_pct: 0.5 },
    n2_glovebox: { gas: "N2", pressure_Pa: 101325, o2_frac: 1e-6, rh_pct: 0.003 }, ar_glovebox: { gas: "Ar", pressure_Pa: 101325, o2_frac: 1e-6, rh_pct: 0.003 },
    vacuum: { gas: "vacuum", pressure_Pa: 0, o2_frac: 0, rh_pct: 0 },
  };
  function resolveAtm(c) {
    const base = LEGACY_ATM[c.atmosphere] || {};
    const gas = c.gas ?? base.gas ?? "air", P = gas === "vacuum" ? 0 : (c.pressure_Pa ?? base.pressure_Pa ?? 101325);
    const o2f = c.o2_frac ?? base.o2_frac ?? (gas === "air" ? 0.21 : 0);
    let rh = base.rh_pct != null && c.gas == null ? base.rh_pct : (c.rh_pct ?? 0);
    if (c.h2o_ppm != null && PH) rh = PH.rhFromPpm(c.h2o_ppm, c.temp_C, Math.max(P, 1e-9));
    if (P <= 0) rh = 0;
    // oxidation and tin-oxidation rates scale with oxygen partial pressure -> relative to 1 atm air (0.21 atm)
    const o2 = o2f * P / 101325;
    return { gas, P, o2, rh: Math.min(100, Math.max(0, rh)) };
  }
  // the range where this model is directly calibrated by experiments. Outside it: 'extrapolated with physics'.
  const VALID = { temp_C: [20, 85], rh_pct: [0, 85], suns: [0, 1.5], hours: [0, 20000], pressure_Pa: [[0, 0], [9e4, 1.1e5]] };
  function extrapolation(c, a) {
    const out = [];
    if (c.temp_C < VALID.temp_C[0] || c.temp_C > VALID.temp_C[1]) out.push(`Temperature ${c.temp_C.toFixed(0)} °C: outside the calibrated range (20-85 °C) - extrapolated with the Arrhenius law of each pathway`);
    if (a.rh > 85) out.push(`Humidity ${a.rh.toFixed(0)}%: above 85% - close to condensation, moisture pathway extrapolated with the RH² law`);
    if (c.suns > 1.5) out.push(`Light ${c.suns.toFixed(1)} sun: concentrator range - light-driven pathways assumed proportional to intensity (in reality temperature also rises)`);
    if (a.gas !== "vacuum" && (a.P < 9e4 || a.P > 1.1e5)) out.push(`Pressure ${a.P < 1 ? a.P.toExponential(1) : a.P.toFixed(0)} Pa: between or beyond 1 atm and vacuum - volatile escape from gas kinetics (diffusion + Knudsen)`);
    if (a.gas === "He" || a.gas === "CO2") out.push(`${a.gas === "He" ? "Helium" : "Carbon dioxide"} atmosphere: no direct measurement - escape probability from molecular size and mass`);
    if (c.hours > 20000) out.push(`Duration ${(c.hours / 8766).toFixed(1)} years: beyond the longest measurements (~2 years) - rate constants assumed unchanged`);
    if (c.radiation_flux > 0 && c.radiation_flux * c.hours > 1e15) out.push(`Cumulative protons ${(c.radiation_flux * c.hours).toExponential(1)} /cm²: beyond the largest measured dose (10¹⁵) - Weibull curve extrapolated`);
    return out;
  }
  // cell quality -> intrinsic degradation factor estimate. End points: average 2014-2020 paper cell (MAPbI3, Spiro, untreated) = 1,
  // certified / satellite-tested cells ≈ 0.05 (the value needed to explain IEC 85/85 1000 h passes and SSPD-1 ~80% after 100 days by intrinsic degradation alone)
  function qualityScale(r) {
    let q = 1;
    if (r.passivation && r.passivation !== "none") q *= 0.4;
    if (r.barrier) q *= 0.6;
    if (["sam", "nio", "ptaa", "polytpd"].includes(r.htl)) q *= 0.5;
    if ((r.ma ?? 1) < 0.1) q *= 0.5;
    return Math.max(0.03, q);
  }
  function simulateAging(s, c, n = 240) {
    const a = resolveAtm(c), T = c.temp_C + 273.15, enc = ENCAPSULATIONS[c.encapsulation];
    const supp = volSuppress(a.gas, T, a.P);
    const atm = { o2: a.o2, rh: a.rh };
    const t = [0]; for (let i = 0; i < n; i++) t.push(Math.exp(Math.log(1e-3) + (Math.log(Math.max(c.hours, 1e-2)) - Math.log(1e-3)) * i / (n - 1)));
    const rhOut = a.rh;
    const dmg = Object.fromEntries(MECHS.map((m) => [m, new Float64Array(t.length)]));
    const dev = s.capped !== false && (c.calibration ?? "database") === "database", iscale = c.intrinsic_scale ?? 1;
    const kc = { "Intrinsic (ions/interfaces)": dev ? K_INT * iscale * (1 + K_INT_LIGHT * c.suns) * arr(EA_INT, T, 298.15) : 0, "Thermal decomposition": kThermal(s, T) * (dev ? DEVICE_CAL.thermal : 1), "Volatilization (iodine escape)": kVol(s, c.atmosphere, enc.cap, c.suns, T, supp), "HTL degradation": kHtl(s, T), "Metal electrode": kMetal(s, T, c.suns) };
    let prev = null;
    const fin = [];
    for (let i = 0; i < t.length; i++) {
      const f = ingress(c.encapsulation, t[i], c.temp_C, c.edge_width_cm), rh = rhOut * f, o2 = atm.o2 * f;
      fin.push(f);
      const k = Object.assign({ "Oxygen + light oxidation": kOx(s, o2, rh, c.suns, T) * (dev ? DEVICE_CAL.ox : 1), "Moisture": kMoist(s, rh, T) * (dev ? DEVICE_CAL.moist : 1), "Tin oxidation": kTin(s, o2, T) }, kc);
      if (prev) for (const m in k) dmg[m][i] = dmg[m][i - 1] + 0.5 * (k[m] + prev[m]) * (t[i] - t[i - 1]);
      prev = k;
    }
    if (c.radiation_flux > 0) for (let i = 0; i < t.length; i++) dmg["Radiation"][i] = -Math.log(radRetention(c.radiation_flux * t[i], s.htl));
    if (c.thermal_cycles_per_h > 0) {
      const flex = c.encapsulation === "thin_film_ald" || c.encapsulation === "polymer";
      for (let i = 0; i < t.length; i++) dmg["Thermal cycling"][i] = c.thermal_cycles_per_h * t[i] * cycleDamage(c.cycle_dT, flex);
    }
    const total = t.map((_, i) => MECHS.reduce((a, m) => a + dmg[m][i], 0));
    const ret = total.map((v) => Math.exp(-v));
    const lim = -Math.log(0.8);
    let t80 = Infinity;
    for (let i = 1; i < t.length; i++) if (total[i] >= lim) { t80 = t[i - 1] + (lim - total[i - 1]) / (total[i] - total[i - 1]) * (t[i] - t[i - 1]); break; }
    const last = t.length - 1, sum = MECHS.reduce((a, m) => a + dmg[m][last], 0) || 1;
    const share = Object.fromEntries(MECHS.map((m) => [m, dmg[m][last] / sum]));
    return { t, retention: ret, dmg, share, t80, ingress: fin, atm: a, volSuppress: supp, extrap: extrapolation(c, a) };
  }

  // ======================= fabrication =======================
  const RADII = { MA: 2.17, FA: 2.53, Cs: 1.88, Pb: 1.19, Sn: 1.10, I: 2.20, Br: 1.96, Cl: 1.81 };
  const HTLS = {
    ptaa: { name: "PTAA", plqy: 5.1e-3, rs: 2.0, parasitic: 1.0, polarity: "pin" },
    polytpd: { name: "PolyTPD", plqy: 7.3e-3, rs: 2.0, parasitic: 1.0, polarity: "pin" },
    sam: { name: "SAM (MeO-2PACz)", plqy: 1.0e-2, rs: 0.8, parasitic: 0.2, polarity: "pin" },
    nio: { name: "NiOx", plqy: 2.5e-3, rs: 1.5, parasitic: 2.0, polarity: "pin" },
    pedot: { name: "PEDOT:PSS", plqy: 7.5e-5, rs: 1.2, parasitic: 3.0, polarity: "pin" },
    spiro_litfsi: { name: "Spiro (Li-TFSI+tBP)", plqy: 1.4e-3, rs: 1.5, parasitic: 4.0, polarity: "nip" },
    spiro_li: { name: "Spiro (Li-TFSI only)", plqy: 1.4e-3, rs: 2.5, parasitic: 4.0, polarity: "nip" },
    p3ht: { name: "P3HT", plqy: 7.7e-4, rs: 2.0, parasitic: 4.0, polarity: "nip" },
  };
  const ETLS = {
    c60: { name: "C60", plqy: 3.8e-4, rs: 1.0, parasitic: 3.0, polarity: "pin" },
    lif_c60: { name: "LiF/C60", plqy: 1.3e-3, rs: 1.2, parasitic: 3.0, polarity: "pin" },
    pcbm: { name: "PCBM", plqy: 5.7e-4, rs: 1.5, parasitic: 2.0, polarity: "pin" },
    sno2: { name: "SnO2", plqy: 5.9e-3, rs: 1.2, parasitic: 0.5, polarity: "nip" },
    tio2: { name: "TiO2", plqy: 2.1e-3, rs: 1.8, parasitic: 1.0, polarity: "nip" },
  };
  const NEAT = 1.4e-2;
  const ELECTRODES = { ag: { name: "Ag", rs: 0.2 }, au: { name: "Au", rs: 0.3 }, cu: { name: "Cu", rs: 0.25 }, carbon: { name: "Carbon", rs: 3.0 } };
  const PASSIVATIONS = {
    none: { name: "None", bulk: 1, iface: 1, gb: 0, iodide: false, two_d: false, vac: 1 },
    pea_i: { name: "PEAI surface treatment", bulk: 0.8, iface: 0.35, gb: 0.5, iodide: true, two_d: true, vac: 0.8 },
    two_d: { name: "2D capping layer", bulk: 0.8, iface: 0.3, gb: 0.6, iodide: false, two_d: true, vac: 0.8 },
    scn: { name: "SCN additive", bulk: 0.5, iface: 0.8, gb: 0.3, iodide: true, two_d: false, vac: 0.2 },
    bufa: { name: "Butylamine→BuFA", bulk: 0.6, iface: 0.8, gb: 0.8, iodide: false, two_d: false, vac: 0.6 },
    mai: { name: "MAI iodide salt", bulk: 0.7, iface: 0.6, gb: 0.4, iodide: true, two_d: false, vac: 0.5 },
  };
  const QUENCH = { none: { name: "No quench", grain: 120, coverage: 0.88 } /* 0.78->0.88: Perovskite Database measured efficiency ratio 0.83 */, antisolvent: { name: "Antisolvent", grain: 280, coverage: 0.97 },
    gas: { name: "Nitrogen gas", grain: 450, coverage: 0.985 }, vacuum: { name: "Vacuum quench", grain: 380, coverage: 0.98 } };
  const DEPOSITION = { spin: { name: "Spin coating", factor: 1.0, cov: 0 }, blade: { name: "Blade", factor: 1.15, cov: -0.01 },
    slot: { name: "Slot-die", factor: 1.1, cov: -0.005 }, inkjet: { name: "Inkjet", factor: 1.05, cov: -0.015 } };
  const FAB_ATM = { n2: { name: "Nitrogen glovebox", o2: 1, rh: 0 }, ar: { name: "Argon glovebox", o2: 1, rh: 0 },
    dry_air: { name: "Dry air", o2: 2.1e5, rh: 3 }, air: { name: "Ambient air", o2: 2.1e5, rh: null } };
  const RECIPE_DEFAULT = { fa: 0.8, ma: 0, cs: 0.2, br: 0.17, cl: 0, sn: 0, snf2_pct: 0, dmso: 0.2, deposition: "spin", quench: "antisolvent",
    thickness_nm: 550, anneal_C: 100, anneal_min: 30, fab_atm: "n2", fab_rh: 30, glovebox_ppm: 1, htl: "sam", etl: "lif_c60",
    electrode: "ag", barrier: true, passivation: "pea_i",
    // process physics inputs (perolab_phys.crystallize): thickness, grain size and coverage are computed from these
    solvent: "DMF", rpm: 4000, conc_M: 1.2, substrate_C: 25, gas_speed: 150, drip_frac: 0.6, wet_um: null, process_physics: true };
  // process reference: the grain size and coverage in the QUENCH table are typical values at 'spin 4000 rpm, 1.2 M, DMF:DMSO 4:1, 25 °C'.
  // other process conditions are mapped by how much the crystallization physics (evaporation -> supersaturation -> nucleation -> growth) changes relative to that reference.
  const PROC_REF = { method: "spin", rpm: 4000, conc: 1.2, solvents: { DMF: 0.8, DMSO: 0.2 }, T_C: 25, gasSpeed: 150, dripFrac: 0.6 };
  const crysRef = {};
  function crysFor(r) {
    const solv = {}; solv[r.solvent || "DMF"] = 1 - r.dmso; solv.DMSO = (solv.DMSO || 0) + r.dmso;
    return { method: r.deposition, rpm: r.rpm, conc: r.conc_M, solvents: solv, T_C: r.substrate_C, quench: r.quench,
      gasSpeed: r.gas_speed, dripFrac: r.drip_frac, wetUm: r.wet_um ?? undefined };
  }
  const THICK_SCALE = 1;  // reference process thickness 550 nm is set via CRYS.thickFudge

  function tolerance(r) {
    const a = r.fa * RADII.FA + r.ma * RADII.MA + r.cs * RADII.Cs, b = (1 - r.sn) * RADII.Pb + r.sn * RADII.Sn;
    const x = (1 - r.br - r.cl) * RADII.I + r.br * RADII.Br + r.cl * RADII.Cl;
    return { t: (a + x) / (Math.SQRT2 * (b + x)), mu: b / x };
  }
  function bandgap(r) {
    const egPb = P.MAT.FACS_I_BR(r.br), egA = 0.03 * r.ma + 0.10 * (r.cs - 0.2), egCl = 0.3 * r.cl;
    if (r.sn <= 0) return egPb + egA + egCl;
    return P.MAT.PB_SN(r.sn) + (egPb - 1.55) * (1 - 0.4 * r.sn) + egA * (1 - r.sn) + egCl;
  }
  function buildCell(rIn, spec = "AM1.5G") {
    const r = Object.assign({}, RECIPE_DEFAULT, rIn), warn = [], notes = [];
    const { t, mu } = tolerance(r);
    let phase = 1;
    if (t > 1.0) { phase -= Math.min(0.6, (t - 1) * 8); warn.push(`Tolerance factor ${t.toFixed(3)} > 1.0: the yellow δ phase mixes in easily. A little Cs or MA stabilizes it.`); }
    if (t < 0.82) { phase -= Math.min(0.7, (0.82 - t) * 10); warn.push(`Tolerance factor ${t.toFixed(3)} < 0.82: tends to turn into a non-perovskite phase.`); }
    if (mu < 0.41) { phase -= 0.3; warn.push(`Octahedral factor ${mu.toFixed(2)} < 0.41.`); }
    if (r.cs > 0.5 && r.br < 0.5) { phase -= 0.4; warn.push("Mostly inorganic (Cs) iodide: tends to turn into yellow δ-CsPbI3 at room temperature."); }
    else if (r.cs > 0.3 && r.br < 0.3) { phase -= 0.15; warn.push("Above 30% Cs, iodide compositions tend to phase-separate Cs."); }
    if (r.fa > 0.95 && r.cs < 0.03 && r.ma < 0.03) notes.push("Pure FAPbI3 slowly turns into the δ phase at room temperature (usually stabilized with Cs, MA or MACl).");
    phase = Math.min(1, Math.max(0.1, phase));
    const eg = bandgap(r);
    const q = QUENCH[r.quench], dep = DEPOSITION[r.deposition];
    let grain = q.grain * dep.factor * (1 + 0.8 * r.dmso), cov = q.coverage + dep.cov, crys = null, extrap = [];
    if (r.process_physics && PH) {
      // thickness, grain and coverage from crystallization physics (applied to the table values as ratios to the reference process)
      crys = PH.crystallize(crysFor(r));
      if (!crysRef[r.quench]) crysRef[r.quench] = PH.crystallize(Object.assign({}, PROC_REF, { quench: r.quench }));
      const ref = crysRef[r.quench];
      grain = q.grain * 1.16 * Math.min(20, Math.max(0.05, crys.grain_nm / ref.grain_nm)); // 1.16 = the DMSO 20% factor of the original formula (matches at the reference)
      cov = q.coverage + (crys.coverage - ref.coverage);
      r.thickness_nm = Math.round(crys.thick_nm * THICK_SCALE);
      if (r.rpm < 1000 || r.rpm > 8000) extrap.push(`Spin speed ${r.rpm} rpm: outside the usual range (1000-8000) - extrapolated with the Meyerhofer law h ∝ ω^(-2/3)·E^(1/3)`);
      if (r.conc_M < 0.6 || r.conc_M > 1.8) extrap.push(`Concentration ${r.conc_M.toFixed(2)} M: outside the usual range (0.6-1.8 M) - computed from mass conservation and classical nucleation theory`);
      if (r.substrate_C > 40 || r.substrate_C < 15) extrap.push(`Substrate ${r.substrate_C} °C: not room temperature - computed from Clausius-Clapeyron vapour pressure and viscosity (hot-casting regime)`);
      if (r.solvent !== "DMF") extrap.push(`Main solvent ${PH.SOLVENTS[r.solvent].name}: vapour pressure and viscosity from property data, nucleation constants shared with DMF`);
      if (crys.tDry > 120) notes.push(`The wet film takes about ${(crys.tDry / 60).toFixed(1)} min to dry - slow drying tends to give large islands and pinholes.`);
    }
    if (r.dmso > 0.5) { cov -= (r.dmso - 0.5) * 0.15; warn.push("Too much DMSO slows drying and makes the film uneven."); }
    if (["inkjet", "blade", "slot"].includes(r.deposition) && r.quench === "antisolvent") { notes.push("Antisolvent is hard to spread evenly in large-area printing, so gas or vacuum quenching is usual."); cov -= 0.02; }
    if (r.deposition === "inkjet" && r.quench === "none") { cov -= 0.05; warn.push("Inkjet + no quench: the coffee-ring effect tends to cause pinholes."); }
    const TK = r.anneal_C + 273.15, tauC = Math.exp(0.8 / KB * (1 / TK - 1 / 373.15));
    const conv = 1 - Math.exp(-r.anneal_min / tauC);
    if (conv < 0.95) warn.push(`Under-annealed: ${(conv * 100).toFixed(0)}% precursor conversion.`);
    if (r.process_physics && PH) {
      // LSW Ostwald ripening d³ = d0³ + K(T)·t, normalized so the reference (100 °C 30 min) matches the original calibration ×1.15
      const g0 = q.grain * 1.16, f = PH.ripen(grain, r.anneal_C, r.anneal_min) / grain, fRef = PH.ripen(g0, 100, 30) / g0;
      grain *= Math.max(1, f / fRef * 1.15);
      if (r.anneal_C > 180 || r.anneal_C < 60) extrap.push(`Anneal ${r.anneal_C} °C: outside the reported range (60-180 °C) - conversion, decomposition and ripening all extrapolated with Arrhenius laws`);
      if (r.anneal_min > 120) extrap.push(`Anneal ${r.anneal_min} min: over 2 hours - ripening continues with the t^(1/3) law`);
    } else grain *= Math.min(2.5, Math.max(1, 1 + 0.15 * Math.sqrt(r.anneal_min / 30) * Math.exp(0.6 / KB * (1 / 373.15 - 1 / TK))));
    const dec = 1 - Math.exp(-kThermal({ ma_frac: r.ma }, TK) * r.anneal_min / 60);
    if (dec > 0.03) warn.push(`Overheated: about ${(dec * 100).toFixed(0)}% decomposed to PbI2 (more sensitive with more MA).`);
    else if (dec > 0.003) notes.push("A slight PbI2 excess can passivate grain boundaries and help.");
    const fa = FAB_ATM[r.fab_atm], o2 = (r.fab_atm === "n2" || r.fab_atm === "ar") ? r.glovebox_ppm : fa.o2;
    const rh = fa.rh == null ? r.fab_rh : fa.rh;
    let atmF = 1;
    if (rh > 0) {
      if (r.ma > 0.3 && rh >= 15 && rh <= 35) { grain *= 1.15; notes.push("MA compositions are reported to grow slightly larger grains in mild humidity (RH 15-35%)."); }
      atmF *= 1 + Math.max(rh - 30, 0) / 15;
      if (rh > 50) { cov -= 0.04; warn.push(`Fabrication humidity ${rh.toFixed(0)}%: more hydrates and pinholes.`); }
    }
    let pdop = 0;
    if (r.sn > 0) {
      let sn4 = 0.015 * (1 + o2 / 2);
      if (r.fab_atm === "air" || r.fab_atm === "dry_air") { sn4 = 5; warn.push("Sn cells made in air: Sn²⁺ oxidizes immediately and the cell barely works."); }
      if (o2 > 10 && (r.fab_atm === "n2" || r.fab_atm === "ar")) warn.push(`Glovebox oxygen ${o2.toFixed(0)} ppm: more Sn oxidation (usually <1 ppm).`);
      pdop = 7.6e16 * (sn4 / 0.015) / (1 + 50 * r.snf2_pct ** 1.3) * r.sn / 0.5;
      if (r.snf2_pct < 0.5) warn.push("Sn without SnF2: many background holes, voltage and lifetime drop sharply (usually 5-10% relative to Sn).");
      if (r.snf2_pct > 15) notes.push("Too much SnF2 can leave SnOx / SnF2 clusters on the surface.");
    }
    const pas = PASSIVATIONS[r.passivation];
    let Nt = 1e14 * (1 + 300 / grain);
    Nt *= atmF * (1 + 3 * (1 - conv)) * (1 + 5 * Math.max(dec - 0.02, 0)) * (1 + 2 * (1 - phase)) * pas.bulk;
    let rate = 1e-8 * Nt;
    if (r.sn > 0) { const Nsn = (1.5e15 + 5.85e16 / (1 + 60 * r.snf2_pct ** 1.5)) * r.sn / 0.5 * (1 + o2 / 10); Nt += Nsn; rate += 3e-9 * Nsn; }
    if (r.br > 0.3) { const f = 1 + 2 * (r.br - 0.3); Nt *= f; rate *= f; }
    let tau = 1 / rate;
    if (pdop > 0) tau = 1 / (1 / tau + 6e-11 * pdop);
    const ereBulk = 1 / (1 + (1 / NEAT - 1) * (1e-6 / tau));
    const htl = HTLS[r.htl], etl = ETLS[r.etl];
    if (htl.polarity !== etl.polarity) notes.push(`${htl.name} and ${etl.name} are usually used in different architectures (n-i-p / p-i-n).`);
    let ere = 1 / (1 / ereBulk + (1 / htl.plqy - 1 / NEAT) + (1 / etl.plqy - 1 / NEAT) * pas.iface);
    // extra voltage loss for wide gaps (> 1.75 eV) 0.3 V/eV - half the increase of the measured Eg-Voc gap in the Perovskite Database (same as Python)
    if (eg > 1.75) ere *= Math.exp(-0.3 * (eg - 1.75) / 0.025852);
    const rs = htl.rs + etl.rs + ELECTRODES[r.electrode].rs + 1;
    cov = Math.min(0.995, Math.max(0.5, cov));
    let rsh = Math.max(30, 1e4 * Math.exp(-(1 - cov) / 0.04)); // floor 30 Ω·cm² (same as Python)
    if (cov < 0.95) warn.push(`Coverage ${(cov * 100).toFixed(0)}%: pinholes cause leakage (shunt).`);
    if (r.thickness_nm < 300) rsh *= r.thickness_nm / 300;
    const parasitic = (htl.polarity === "pin" ? htl.parasitic : etl.parasitic) / 100;
    const cell = P.cell({ eg, thickness_nm: r.thickness_nm * conv * (1 - dec), ere, rs, rsh, eu: 0.015 + 0.01 * (1 - phase) + 0.005 * Math.max(r.br - 0.3, 0) });
    const res = P.simulate([cell], spec, { reflect: 0.02 + parasitic, npts: 1200 }).total;
    const jsc = res.jsc * cov * (0.7 + 0.3 * phase), pce = res.pce * (res.jsc > 0 ? jsc / res.jsc : 0);
    const vocRad = P.simulate([P.cell({ eg, thickness_nm: r.thickness_nm, ere: 1, rs: 0, rsh: 1e12 })], spec, { npts: 800 }).total.voc;
    const vac = pas.vac * (1 + 4 * Math.max(dec - 0.01, 0)) * (1 + 0.5 * (r.anneal_C > 130 ? 1 : 0));
    const ionEa = 0.58 * r.ma + 0.50 * r.fa + 0.55 * r.cs + 0.03 * (pas.gb > 0.4 ? 1 : 0);
    const omega = 0.040 * (1 + 0.5 * Math.max(r.cs - 0.15, 0) / 0.15) * (r.cl > 0 ? 0.8 : 1);
    if (r.br > 0.2) notes.push(`Br ${(r.br * 100).toFixed(0)}%: halide segregation possible under light -> check in the segregation bench.`);
    if (r.electrode === "ag" && !r.barrier) warn.push("Ag electrode without a barrier: reacts with iodine and degrades fast when hot.");
    if (r.htl === "spiro_litfsi") notes.push("Spiro with Li-TFSI + tBP degrades quickly near 85 °C.");
    const htlStab = ["spiro_litfsi", "spiro_li", "ptaa", "sam", "nio", "pedot"].includes(r.htl) ? r.htl : "ptaa";
    return {
      recipe: r, tolerance: t, octahedral: mu, phase, eg, grain, coverage: cov, conversion: conv, decomposed: dec,
      trap: Nt, tau_ns: tau * 1e9, pdop, ereBulk, ere, rs, rsh, jsc, voc: res.voc, ff: res.ff, pce, vocRad,
      v: res.v, j: res.j, warnings: warn, notes, ionN0: 1.6e19 * vac, ionEa, crys, extrap, thickness_nm: r.thickness_nm, wideLoss: eg > 1.75 ? 0.3 * (eg - 1.75) : 0,
      seg: { x_br: r.br, grain_size_nm: grain, vacancy_ratio: vac, gb_passivation: pas.gb, omega_eV: omega, carrier_lifetime_ns: Math.min(tau * 1e9, 3000) },
      stack: { ma_frac: r.ma, sn_frac: r.sn, x_br: r.br, grain_nm: grain, iodide_passivation: pas.iodide, surface_2d: pas.two_d, htl: htlStab, electrode: r.electrode, barrier: r.barrier, capped: true },
    };
  }
  const PRESET_RECIPES = {
    "Record p-i-n (FA-Cs)": {},
    "Stolterfoht 2019 reproduction": { fa: 0.79, ma: 0.16, cs: 0.05, br: 0.17, htl: "ptaa", etl: "c60", passivation: "none" },
    "Classic MAPbI3 (n-i-p)": { fa: 0, ma: 1, cs: 0, br: 0, htl: "spiro_litfsi", etl: "tio2", electrode: "au", barrier: false, passivation: "none" },
    "Tandem top 1.77 eV": { br: 0.40 },
    "Tandem bottom Pb-Sn": { fa: 0.7, ma: 0.3, cs: 0, br: 0, sn: 0.5, snf2_pct: 10, thickness_nm: 1000, conc_M: 1.7, rpm: 3000, drip_frac: 0.85 },
    "Large-area inkjet": { deposition: "inkjet", quench: "gas", dmso: 0.3 },
    "Hot-casting 2ME (extrapolated)": { solvent: "2ME", dmso: 0, substrate_C: 70, quench: "none", rpm: 4000, conc_M: 0.8 },
    "Blade + gas knife": { deposition: "blade", quench: "gas", gas_speed: 250, wet_um: 7, conc_M: 1.0 },
  };

  Object.assign(P, { simulateAging, ATMOSPHERES, ENCAPSULATIONS, ORBITS, MECHS, buildCell, tolerance, bandgapRecipe: bandgap,
    HTLS, ETLS, ELECTRODES, PASSIVATIONS, QUENCH, DEPOSITION, FAB_ATM, RECIPE_DEFAULT, PRESET_RECIPES, ingress, radRetention,
    resolveAtm, volSuppress, LEGACY_ATM, crysFor, qualityScale });
})(typeof window !== "undefined" ? window : globalThis);
