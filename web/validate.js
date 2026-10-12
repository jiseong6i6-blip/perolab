/* Extrapolation physics checks (BACKTEST3): node web/validate.js
   Compares with textbook properties and independent measurements, or checks trends that must hold even outside the calibrated range (monotonicity, limits, scaling).
   Result: outputs/backtest_physics.json (web/build.py puts it into the Validation tab) */
"use strict";
const fs = require("fs"), path = require("path");
const W = __dirname, ROOT = path.dirname(W);
globalThis.SPECTRA = JSON.parse(fs.readFileSync(path.join(W, "spectra.json"), "utf8"));
require(path.join(W, "perolab_core.js")); require(path.join(W, "perolab_phys.js")); require(path.join(W, "perolab_lab.js"));
const P = globalThis.Perolab, PH = globalThis.PerolabPhys, IO = require(path.join(W, "ionic.js"));
const rows = [];
const p3 = (x) => String(Number((+x).toPrecision(3)));
function check(area, name, value, ok, ref, unit = "") { rows.push({ area, name, value: (typeof value === "number" ? p3(value) : value) + unit, ok: !!ok, ref }); console.log(ok ? "PASS" : "FAIL", area, name, value, unit); }
const inR = (v, lo, hi) => v >= lo && v <= hi;

// ---------- gas kinetics ----------
const dW = PH.diffCoef("H2O", "air", 298.15, 101325) * 1e4;
check("Gas", "Water vapour-air diffusivity 25 °C", dW, inR(dW, 0.20, 0.30), "measured 0.25 cm²/s (CRC Handbook) · allowed 0.20-0.30", " cm²/s");
const dI = PH.diffCoef("I2", "air", 298.15, 101325) * 1e4;
check("Gas", "Iodine-air diffusivity 25 °C", dI, inR(dI, 0.06, 0.10), "measured about 0.07-0.08 cm²/s · allowed 0.06-0.10", " cm²/s");
const nT = Math.log(PH.diffCoef("I2", "N2", 400, 101325) / PH.diffCoef("I2", "N2", 300, 101325)) / Math.log(400 / 300);
check("Gas", "Diffusivity temperature exponent (300->400 K)", nT, inR(nT, 1.6, 1.9), "Fuller and measurements D ∝ T^1.75 · allowed 1.6-1.9");
const nP = PH.diffCoef("I2", "N2", 300, 1e4) / PH.diffCoef("I2", "N2", 300, 1e5);
check("Gas", "Diffusivity inversely proportional to pressure (0.1 bar/1 bar)", nP, inR(nP, 9.9, 10.1), "kinetic theory D ∝ 1/P · allowed 9.9-10.1");
const mfp = PH.meanFreePath("air", 298.15, 101325) * 1e9;
check("Gas", "Mean free path of air at 1 atm 25 °C", mfp, inR(mfp, 55, 75), "textbook about 66 nm · allowed 55-75", " nm");
const eN2 = PH.escapeProbability("N2", 328.15, 101325) / PH.ESC_VAC;
check("Gas", "Volatile suppression in N2 1 atm 55 °C (calibrated)", eN2, inR(eN2, 0.007, 0.013), "Ruess 2020: about 1/100 of vacuum (the single sticking coefficient s is fitted here)");
const eAr = PH.escapeProbability("Ar", 328.15, 101325), eN = PH.escapeProbability("N2", 328.15, 101325), eHe = PH.escapeProbability("He", 328.15, 101325);
check("Gas", "Heavier gas suppresses volatiles more (He > N₂ > Ar escape)", `He ${p3(eHe / eN)}× · Ar ${p3(eAr / eN)}×`, eHe > eN && eN > eAr, "molecular mass and size -> diffusivity order (must hold)");
let mono = true, prev = 2; for (let lp = -3; lp <= 6; lp += 0.25) { const e = PH.escapeProbability("N2", 300, 10 ** lp); if (e > prev + 1e-12) mono = false; prev = e; }
const eLow = PH.escapeProbability("N2", 300, 1e-3) / PH.escapeProbability("vacuum", 300, 0);
check("Gas", "Pressure down -> converges continuously to vacuum (10⁻³ Pa)", eLow, mono && eLow > 0.99, "must equal vacuum in the Knudsen regime + decrease monotonically with pressure");

// ---------- water vapour ----------
const w25 = PH.psatWater(25), w100 = PH.psatWater(100), wm20 = PH.psatWater(-20);
check("Water", "Saturation vapour pressure of water 25 °C", w25, inR(w25, 3135, 3200), "steam tables 3169 Pa · allowed ±1%", " Pa");
check("Water", "Saturation vapour pressure of water 100 °C", w100 / 1000, inR(w100, 100300, 102300), "boiling point 101.3 kPa · allowed ±1%", " kPa");
check("Water", "Saturation vapour pressure over ice −20 °C", wm20, inR(wm20, 100, 106), "steam tables 103.3 Pa · allowed ±3%", " Pa");
const rh = PH.rhFromPpm(1000, 25, 101325);
check("Water", "1000 ppm water -> relative humidity at 25 °C", rh, inR(rh, 3.1, 3.3), "by definition 1000e-6 × 101325 / 3169 = 3.2%", "%");

// ---------- solvents ----------
const dmf = PH.psat("DMF", 298.15);
check("Solvent", "DMF vapour pressure 25 °C", dmf, inR(dmf, 420, 560), "literature about 490 Pa (3.7 mmHg) · interpolated between the 20 °C value and the boiling point", " Pa");
const acn = PH.psat("ACN", 298.15) / 1000;
check("Solvent", "Acetonitrile vapour pressure 25 °C", acn, inR(acn, 11, 13), "literature 11.9 kPa (88.8 mmHg)", " kPa");
const dH = PH.dHeff("DMF") / 1000;
check("Solvent", "DMF effective heat of vaporization", dH, inR(dH, 42, 49), "literature 46.9 kJ/mol (25 °C), 44 (near the boiling point)", " kJ/mol");
const base = { method: "spin", rpm: 4000, conc: 1.2, solvents: { DMF: 0.8, DMSO: 0.2 }, T_C: 25, quench: "antisolvent", gasSpeed: 150, dripFrac: 0.6 };
const cr = (o) => PH.crystallize(Object.assign({}, base, o));
const ex = Math.log(cr({ rpm: 2000 }).thick_nm / cr({ rpm: 8000 }).thick_nm) / Math.log(4);
check("Process", "Spin thickness ∝ speed^(−n)", ex, inR(ex, 0.4, 0.7), "experiments n ≈ 0.5 (reported range for perovskite spin coating 0.4-0.7)");
const cx = cr({ conc: 1.6 }).thick_nm / cr({ conc: 0.8 }).thick_nm;
check("Process", "2x concentration -> thickness ratio", cx, inR(cx, 1.9, 2.6), "2x from mass conservation + a bit more from higher viscosity");
const ht = cr({ T_C: 80 }).thick_nm / cr({ T_C: 25 }).thick_nm;
check("Process", "Hot substrate -> wet film dries fast and gets thicker", ht, ht > 1.2, "Meyerhofer: h ∝ (η·E)^(1/3), evaporation E rises with vapour pressure (why hot-cast films are thick)");
const gN = cr({ quench: "none" }), gV = cr({ quench: "vacuum" }), gG = cr({ quench: "gas", gasSpeed: 400 }), gG2 = cr({ quench: "gas", gasSpeed: 20 });
check("Process", "Faster quench -> more nuclei, smaller grains", `vacuum ${p3(gV.grain_nm)} < none ${p3(gN.grain_nm)} nm`, gV.grain_nm < gN.grain_nm && gV.coverage > gN.coverage, "LaMer: the faster supersaturation rises, the bigger the nucleation burst (a trend that must hold)");
check("Process", "Faster gas knife -> smaller grains, higher coverage", `400 m/s ${p3(gG.grain_nm)} vs 20 m/s ${p3(gG2.grain_nm)} nm`, gG.grain_nm < gG2.grain_nm && gG.coverage >= gG2.coverage, "mass transfer k ∝ √speed -> same direction");
const r1 = PH.ripen(300, 100, 30), r2 = PH.ripen(300, 100, 240);
const lin = (r2 ** 3 - 300 ** 3) / (r1 ** 3 - 300 ** 3);
check("Process", "Ostwald ripening d³ − d₀³ ∝ t", lin, inR(lin, 7.99, 8.01), "LSW theory (8x time -> 8x increase in d³)");
check("Process", "Grain growth at 100 °C 30 min (calibrated)", r1 / 300, inR(r1 / 300, 1.2, 1.4), "reported annealing trend +30% (K₀ and Ea fitted to two points, 100 and 150 °C)", "×");

// ---------- thermal ----------
const T1 = PH.panelTemperature({ r: 1 }), Tm = PH.panelTemperature({ r: 1.524 });
check("Space thermal", "Sun-pointing panel temperature at Earth distance", T1 - 273.15, inR(T1 - 273.15, 20, 80), "reported operating temperature of space solar arrays about 40-70 °C · allowed 20-80", " °C");
check("Space thermal", "Temperature ratio at Mars distance T(1.52 AU)/T(1 AU)", Tm / T1, inR(Tm / T1, 0.80, 0.82), "radiative equilibrium T ∝ r^(−1/2) = 0.810 (must hold)");
const leo = PH.orbitThermal({ orbit: "leo", mc: 1500 }), leoH = PH.orbitThermal({ orbit: "leo", mc: 30000 });
check("Space thermal", "LEO eclipse temperature swing (thin panel vs heavy body)", `${p3(leo.dT)} vs ${p3(leoH.dT)} K`, leo.dT > leoH.dT && inR(leoH.dT, 20, 90) && inR(leo.dT, 90, 220),
  "light panels swing ±80 °C or more (ISS arrays reported −100 to +100 °C), SSPD-1 mounted on the satellite body −25 to 35 °C (60 K)");

// ---------- device ----------
const one = (o) => P.simulate([P.cell({ eg: 1.6, ere: 1e-3, dEgdT: 3e-4, rs: 0.5, rsh: 1e5 })], "AM1.5G", Object.assign({ npts: 2500 }, o)).total;
const v1 = one({ intensity: 1 }).voc, v01 = one({ intensity: 0.1 }).voc, slope = (v1 - v01) * 1000;
check("Device", "Voc slope (per 10x light)", slope, inR(slope, 56, 63), "ideality factor 1: kT/q·ln10 = 59.2 mV/decade (must hold)", " mV");
const hot = one({ T: 350 }), cold = one({ T: 300 });
const tc = (hot.pce - cold.pce) / cold.pce / 50 * 100;
check("Device", "Single-cell efficiency temperature coefficient", tc, inR(tc, -0.35, -0.05), "perovskite measurements −0.1 to −0.3 %/K (partly offset by the widening band gap)", " %/K");
const dvdt = (hot.voc - cold.voc) / 50 * 1000;
check("Device", "Voc temperature coefficient", dvdt, inR(dvdt, -2.0, -0.6), "perovskite measurements around −1 mV/K (smaller than silicon's −2 mV/K)", " mV/K");
const cellF = P.buildCell({});
check("Device", "Default recipe efficiency (must equal the Python fabrication model)", cellF.pce, inR(cellF.pce, 22.9, 23.1), "Python fabrication.py 22.99% (equal because process physics is normalized at the reference point)", " %");

// ---------- environment ----------
const st = cellF.stack;
const Tlo = P.simulateAging(st, { gas: "N2", pressure_Pa: 101325, o2_frac: 1e-6, rh_pct: 0, temp_C: 25, suns: 1, encapsulation: "none", hours: 1e6 }).t80;
const Thi = P.simulateAging(st, { gas: "N2", pressure_Pa: 101325, o2_frac: 1e-6, rh_pct: 0, temp_C: 120, suns: 1, encapsulation: "none", hours: 1e6 }).t80;
check("Env", "Temperature up -> lifetime decreases monotonically (25 vs 120 °C)", `${p3(Tlo)} → ${p3(Thi)} h`, Thi < Tlo, "every pathway is Arrhenius (must hold)");
let monoP = true, prevT = 0;
for (const lp of [-2, 0, 2, 3, 4, 5, 6]) { const t = P.simulateAging(st, { gas: "N2", pressure_Pa: 10 ** lp, o2_frac: 0, rh_pct: 0, temp_C: 65, suns: 1, encapsulation: "none", hours: 1e7 }).t80; if (t < prevT) monoP = false; prevT = t; }
check("Env", "Gas pressure up -> volatile lifetime increases monotonically", monoP ? "monotonic" : "reversed", monoP, "escape probability decreases monotonically with pressure (must hold)");
const legacy = P.simulateAging(st, { atmosphere: "n2_glovebox", temp_C: 55, suns: 1, encapsulation: "none", hours: 5000 });
check("Env", "Old atmosphere name still works (nitrogen glovebox)", legacy.volSuppress, inR(legacy.volSuppress, 0.008, 0.012), "must give the same value as the old table value 0.01");

// ---------- segregation ----------
const segRun = (o, n = 40) => { const s = new P.SegregationSim(Object.assign({ intensity_suns: 0 }, o)); for (let k = 0; k < n; k++) s.steps(10); return s.std(); };
const sHi = segRun({ omega_eV: 0.08 }), sLo = segRun({ omega_eV: 0.03 });
check("Segregation", "Spinodal decomposition in the dark only when Ω > 2kT", `Ω 80 meV σ=${p3(sHi)} · 30 meV σ=${p3(sLo)}`, sHi > 0.1 && sLo < 0.01, "regular-solution theory: critical Ω_c = 2kT = 52 meV @300 K (must hold)");
const sHot = segRun({ omega_eV: 0.08, temperature_K: 600 });
check("Segregation", "Even at Ω 80 meV, mixed when T > Ω/2k (464 K)", `600 K σ=${p3(sHot)}`, sHot < 0.01, "above the critical temperature entropy wins (must hold)");

// ---------- ions ----------
const H = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "outputs", "hysteresis_sweep.json"), "utf8")); } catch (e) { return null; } })();
const rB = IO.hysteresisRun({}, 0.1, {});
if (H) {
  const row = H.runs["298"].find((x) => Math.abs(x.rate - 0.1) < 1e-9);
  if (row) check("Ion", "Browser solver = Python solver (HI @100 mV/s)", `JS ${rB.HI.toFixed(4)} · Py ${row.HI.toFixed(4)}`, Math.abs(rB.HI - row.HI) < 0.003, "same equations, grid and time stepping ported -> must agree to the third decimal");
}
const rC = IO.hysteresisRun({ T: 233 }, 0.1, {}), rW = IO.hysteresisRun({ T: 393 }, 0.1, {});
check("Ion", "100 mV/s hysteresis vanishes at −40 °C and 120 °C", `−40 °C ${rC.HI.toFixed(3)} · 25 °C ${rB.HI.toFixed(3)} · 120 °C ${rW.HI.toFixed(3)}`, rC.HI < 0.05 && rW.HI < 0.05 && rB.HI > 0.2,
  "ions freeze (τ ≫ scan) or move too fast (τ ≪ scan), so hysteresis disappears - same direction as low-temperature measurements");
const tauR = new IO.IonicSolver({ T: 273 }, 0).tauIon() / new IO.IonicSolver({ T: 298 }, 0).tauIon();
const expR = Math.exp(0.58 / 8.617333e-5 * (1 / 273 - 1 / 298)) * Math.sqrt(273 / 298);
check("Ion", "Ion time-constant ratio τ(0 °C)/τ(25 °C)", tauR, Math.abs(tauR / expR - 1) < 0.01, `Arrhenius × √T (Debye length) analytic value ${p3(expR)}`);
const t1 = new IO.IonicSolver({ b: 800e-9 }, 0).tauIon() / new IO.IonicSolver({}, 0).tauIon();
check("Ion", "2x thickness -> 2x τ", t1, inR(t1, 1.99, 2.01), "τ = b·L_D/D (must hold)");

fs.mkdirSync(path.join(ROOT, "outputs"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "outputs", "backtest_physics.json"), JSON.stringify(rows, null, 1));
console.log(`\n${rows.filter((r) => r.ok).length}/${rows.length} passed → outputs/backtest_physics.json`);
