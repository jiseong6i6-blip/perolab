(function () {
  "use strict";
  const P = window.Perolab;
  const $ = (id) => document.getElementById(id);
  const fmt = (v, d = 2) => Number.isFinite(v) ? v.toFixed(d) : "—";
  const signed = (v) => { const r = Math.round(v); return r > 0 ? `+${r}` : r === 0 ? "0" : `${r}`; };
  const NS = "http://www.w3.org/2000/svg";
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  // ---------- shared UI ----------
  function slider(host, o) {
    const wrap = document.createElement("div"); wrap.className = "ctl";
    const disp = (v) => o.fmt ? o.fmt(v) : v;
    wrap.innerHTML = `<label for="${o.id}">${o.label}</label><output id="${o.id}-out"></output>
      <input type="range" id="${o.id}" min="${o.min}" max="${o.max}" step="${o.step}" value="${o.value}">
      ${o.hint ? `<span class="hint">${o.hint}</span>` : ""}`;
    host.appendChild(wrap);
    const inp = wrap.querySelector("input"), out = wrap.querySelector("output");
    const sync = () => { out.textContent = disp(+inp.value); };
    inp.addEventListener("input", () => { sync(); o.onInput && o.onInput(+inp.value); });
    inp.addEventListener("change", () => { o.onChange && o.onChange(+inp.value); });
    sync();
    return { get: () => +inp.value, set: (v) => { inp.value = v; sync(); }, el: inp, wrap };
  }
  // quick-pick buttons under a slider (jump straight to an exact value)
  function quickBtns(ctl, list, onPick) {
    const row = document.createElement("div"); row.className = "row"; row.style.gap = "6px";
    for (const [v, lab] of list) {
      const b = document.createElement("button"); b.className = "chip"; b.textContent = lab;
      b.addEventListener("click", () => { ctl.set(v); onPick(v); });
      row.appendChild(b);
    }
    ctl.wrap.appendChild(row);
  }
  // quick-pick button groups split into Ground / Space. groups: [{label, list: [[value, name, extra action on click]]}]
  function quickGroups(ctl, groups, onPick) {
    const box = document.createElement("div"); box.style.display = "grid"; box.style.gap = "6px"; box.style.marginTop = "4px";
    for (const g of groups) {
      const row = document.createElement("div"); row.className = "row"; row.style.gap = "6px"; row.style.alignItems = "center";
      row.innerHTML = `<span class="hint" style="min-width:34px">${g.label}</span>`;
      for (const [v, lab, extra] of g.list) {
        const b = document.createElement("button"); b.className = "chip"; b.textContent = lab;
        b.addEventListener("click", () => { if (extra) extra(); ctl.set(v); onPick(v); });
        row.appendChild(b);
      }
      box.appendChild(row);
    }
    ctl.wrap.appendChild(box);
  }
  const LIGHT_GROUND = [[1, "Clear midday 1.0"], [0.6, "Light clouds 0.6"], [0.2, "Cloudy 0.2"], [0.05, "Heavy clouds · rain 0.05"]];
  const LIGHT_SPACE = [[1.36, "Earth orbit 1.36"], [1.41, "Perihelion (Jan) 1.41"], [1.32, "Aphelion (Jul) 1.32"], [0.59, "Mars distance 0.59"]];
  function kpis(el, items) {
    el.innerHTML = items.map((it) => `<div class="kpi ${it.cls || ""}"><div class="k">${it.k}</div>
      <div class="v"${String(it.v).length > 14 ? ' style="font-size:15px;white-space:normal;line-height:1.25"' : ""}>${it.v}${it.u ? `<small>${it.u}</small>` : ""}</div>${it.s ? `<div class="s">${it.s}</div>` : ""}</div>`).join("");
  }
  function segGroup(el, attr, onPick) {
    el.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      el.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
      onPick(b.dataset[attr]);
    }));
  }

  // ---------- SVG line chart ----------
  function niceTicks(lo, hi, n = 5) {
    const span = hi - lo || 1, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || 10 * mag;
    const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function chart(svg, o) {
    const vb = svg.getAttribute("viewBox").split(/\s+/).map(Number), W = vb[2], H = vb[3];
    const m = Object.assign({ l: 46, r: 12, t: 12, b: 34 }, o.margin);
    const [x0, x1] = o.x, [y0, y1] = o.y;
    const tf = o.xlog ? (v) => Math.log10(v) : (v) => v;
    const X = (v) => m.l + (tf(v) - tf(x0)) / (tf(x1) - tf(x0)) * (W - m.l - m.r);
    if (o.xlog && !o.xticks) {
      o.xticks = [];
      for (let e = Math.ceil(Math.log10(x0) - 1e-9); e <= Math.floor(Math.log10(x1) + 1e-9); e++) o.xticks.push(10 ** e);
    }
    const Y = (v) => H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b);
    let s = "";
    for (const sh of o.shades || []) {
      const a = Math.max(x0, sh[0]), b = Math.min(x1, sh[1]); if (b <= a) continue;
      s += `<rect x="${X(a)}" y="${m.t}" width="${X(b) - X(a)}" height="${H - m.t - m.b}" fill="${sh[2]}" opacity="0.18"/>`;
    }
    const xt = o.xticks || niceTicks(x0, x1, o.nx || 6), yt = o.yticks || niceTicks(y0, y1, o.ny || 5);
    for (const v of yt) s += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 6}" y="${Y(v) + 3}" text-anchor="end">${o.yf ? o.yf(v) : v}</text>`;
    for (const v of xt) s += `${o.xgrid ? `<line class="grid" x1="${X(v)}" x2="${X(v)}" y1="${m.t}" y2="${H - m.b}"/>` : ""}<text x="${X(v)}" y="${H - m.b + 14}" text-anchor="middle">${o.xf ? o.xf(v) : v}</text>`;
    s += `<line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>`;
    if (o.xl) s += `<text class="ttl" x="${(m.l + W - m.r) / 2}" y="${H - 4}" text-anchor="middle">${o.xl}</text>`;
    if (o.yl) s += `<text class="ttl" x="12" y="${(m.t + H - m.b) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(m.t + H - m.b) / 2})">${o.yl}</text>`;
    for (const se of o.series) {
      const pts = [];
      for (let i = 0; i < se.xs.length; i++) {
        const xv = se.xs[i], yv = se.ys[i];
        if (xv < x0 || xv > x1 || !Number.isFinite(yv)) continue;
        pts.push(`${X(xv).toFixed(1)},${Y(Math.max(y0, Math.min(y1, yv))).toFixed(1)}`);
      }
      if (!pts.length) continue;
      if (se.fill) {
        const base = Y(se.base ?? y0);
        s += `<polygon points="${pts[0].split(",")[0]},${base} ${pts.join(" ")} ${pts[pts.length - 1].split(",")[0]},${base}" fill="${se.color}" opacity="${se.opacity ?? 0.25}"/>`;
      }
      if (se.line !== false) s += `<polyline points="${pts.join(" ")}" fill="none" stroke="${se.color}" stroke-width="${se.w || 2}" ${se.dash ? `stroke-dasharray="${se.dash}"` : ""} stroke-linejoin="round"/>`;
    }
    for (const p of o.points || []) {
      if (p.x < x0 || p.x > x1) continue;
      s += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${p.r || 5}" fill="${p.color}" stroke="${cssVar("--panel")}" stroke-width="2"/>`;
      if (p.label) s += `<text x="${X(p.x) + 8}" y="${Y(p.y) - 8}" style="fill:${p.color}">${p.label}</text>`;
    }
    svg.innerHTML = s;
  }

  // ---------- tabs ----------
  const tabs = document.querySelectorAll("nav.tabs button");
  function showTab(btn) {
    tabs.forEach((b) => {
      const on = b === btn; b.setAttribute("aria-selected", on);
      $(b.getAttribute("aria-controls")).hidden = !on;
    });
    if (btn.id === "tab-cell") cellUpdate();
    if (btn.id === "tab-comp") compUpdate();
    if (btn.id === "tab-seg") drawPL();
    if (btn.id === "tab-fab") fabUpdate();
    if (btn.id === "tab-env") envUpdate();
    if (btn.id === "tab-ion") ionUpdate();
  }
  tabs.forEach((b) => b.addEventListener("click", () => showTab(b)));
  const hash = (location.hash || "").slice(1);
  const byHash = { cell: "tab-cell", comp: "tab-comp", log: "tab-log", seg: "tab-seg", env: "tab-env", ion: "tab-ion", fab: "tab-fab" };

  // =====================================================================
  // Segregation bench
  // =====================================================================
  const TOP = P.cell({ eg: 1.77, thickness_nm: 300, ere: 1e-4 }), BOT = P.cell({ eg: 1.25, thickness_nm: 1100, ere: 1e-3 });
  const S = { sim: null, running: true, speed: 1, light: true, lightT: 300, darkT: 300, shades: [], hist: [], impact: null, lastImpact: 0, pl0: 0 };
  const PRESETS = {
    "Reference sample": {},
    "Vacancy filling (SCN-type)": { vacancy_ratio: 0.2 },
    "Grain-boundary passivation layer": { gb_passivation: 0.9, vacancy_ratio: 0.6 },
    "Large grains (600 nm)": { grain_size_nm: 600 },
    "Lattice strain relief": { omega_eV: 0.020 },
    "Fast charge extraction": { carrier_lifetime_ns: 300 },
    "Less bromide (Br 30%)": { x_br: 0.30 },
    "Combined": { vacancy_ratio: 0.2, gb_passivation: 0.9, carrier_lifetime_ns: 300 },
  };
  const PRESET_NOTE = {
    "Reference sample": "FA0.8Cs0.2Pb(I0.6Br0.4)3, 150 nm grains, untreated. A 1.77 eV composition common for tandem top cells.",
    "Vacancy filling (SCN-type)": "Additives such as thiocyanate fill iodide vacancies and block ion paths (Nature Energy 2024). Vacancy density 1/5.",
    "Grain-boundary passivation layer": "Grain boundaries covered with 2D layers or bulky cations to block 'ion highways' (Fraunhofer 2025, etc.).",
    "Large grains (600 nm)": "Grains grown large to remove boundaries. Larger than this sample (256 nm), so almost no boundaries.",
    "Lattice strain relief": "Ion sizes matched so mixing is less strained. Mixing interaction Ω halved.",
    "Fast charge extraction": "Good transport layers pull carriers out quickly — similar to a cell delivering power.",
    "Less bromide (Br 30%)": "Using less bromide by tuning Cl and Cs. Bandgap drops to 1.70 eV.",
    "Combined": "Vacancy filling + grain-boundary protection + fast charge extraction combined.",
  };
  const base = P.SEG_DEFAULTS;
  const segCtl = {};
  const sampleHost = $("ctl-sample"), envHost = $("ctl-env"), matHost = $("ctl-mat");
  segCtl.x_br = slider(sampleHost, { id: "s-xbr", label: "Br fraction", min: 0.02, max: 0.98, step: 0.01, value: base.x_br,
    fmt: (v) => `${(v * 100).toFixed(0)}% · ${P.MAT.FACS_I_BR(v).toFixed(2)} eV`, hint: "Below about 20% there is almost no segregation (Hoke 2015)", onChange: () => resetSim() });
  segCtl.grain_size_nm = slider(sampleHost, { id: "s-grain", label: "Grain size", min: 30, max: 1500, step: 10, value: base.grain_size_nm,
    fmt: (v) => `${v} nm`, hint: "Grain boundaries (borders between crystals) are fast paths for ions", onChange: () => resetSim() });
  segCtl.suns = slider(envHost, { id: "s-suns", label: "Light intensity", min: 0.05, max: 3, step: 0.01, value: 1,
    fmt: (v) => `${v.toFixed(2)} sun`, hint: "Ground max about 1 sun, space (AM0) 1.36 sun", onInput: (v) => { if (S.light) S.sim.setLight(v); segRange(); } });
  quickGroups(segCtl.suns, [{ label: "Ground", list: LIGHT_GROUND }, { label: "Space", list: LIGHT_SPACE }], (v) => { if (S.light) S.sim.setLight(v); segRange(); });
  segCtl.lightT = slider(envHost, { id: "s-tl", label: "Temperature under light", min: -50, max: 100, step: 5, value: 27,
    fmt: (v) => `${v} °C`, onInput: (v) => { S.lightT = v + 273; if (S.light) S.sim.setTemperature(S.lightT); segRange(); } });
  segCtl.darkT = slider(envHost, { id: "s-td", label: "Temperature in shade (light off)", min: -120, max: 80, step: 5, value: 27,
    fmt: (v) => `${v} °C`, hint: "LEO eclipse is about −100 °C. When cold, ions cannot move and recovery stops", onInput: (v) => { S.darkT = v + 273; if (!S.light) S.sim.setTemperature(S.darkT); segRange(); } });
  segCtl.vacancy_ratio = slider(matHost, { id: "s-vac", label: "Mobile vacancy density (log)", min: -1, max: 0.7, step: 0.02, value: 0,
    fmt: (v) => `× ${(10 ** v).toPrecision(2)}`, hint: "Vacant sites halide ions hop through. 0.1–5×", onInput: (v) => { S.sim.setParam("vacancy_ratio", 10 ** v); segRange(); } });
  segCtl.gb_passivation = slider(matHost, { id: "s-gbp", label: "Grain-boundary passivation", min: 0, max: 1, step: 0.05, value: 0,
    fmt: (v) => `${(v * 100).toFixed(0)}%`, hint: "Passivation: covering defects with molecules", onInput: (v) => S.sim.setParam("gb_passivation", v) });
  segCtl.omega_eV = slider(matHost, { id: "s-om", label: "Mixing interaction Ω", min: 0.01, max: 0.06, step: 0.001, value: base.omega_eV,
    fmt: (v) => `${(v * 1000).toFixed(0)} meV`, hint: "How much I and Br dislike mixing. Larger with more lattice strain", onInput: (v) => { S.sim.setParam("omega_eV", v); segRange(); } });
  segCtl.carrier_lifetime_ns = slider(matHost, { id: "s-tau", label: "Carrier lifetime", min: 10, max: 5000, step: 10, value: base.carrier_lifetime_ns,
    fmt: (v) => `${v} ns`, hint: "Shorter means faster charge extraction → fewer charges collect in the funnel", onInput: (v) => S.sim.setParam("carrier_lifetime_ns", v) });

  { const raw = segCtl.vacancy_ratio; segCtl.vacancy_ratio = { get: () => 10 ** raw.get(), set: (v) => raw.set(Math.log10(Math.max(v, 1e-3))), el: raw.el, wrap: raw.wrap }; }
  const segX = document.createElement("div"); segX.style.marginTop = "14px";
  $("ctl-mat").parentElement.parentElement.appendChild(segX);
  // range where the segregation model was compared directly with experiments (conditions of Hoke 2015, Brennan 2020, Knight 2021, etc.) - outside it the same equations are extrapolated
  function segRange() {
    const x = [], br = segCtl.x_br.get(), I = segCtl.suns.get(), Tl = S.lightT - 273, Td = S.darkT - 273, v = segCtl.vacancy_ratio.get(), om = segCtl.omega_eV.get(), g = segCtl.grain_size_nm.get(), tau = segCtl.carrier_lifetime_ns.get();
    if (br < 0.2 || br > 0.6) x.push(`Br ${(br * 100).toFixed(0)}%: compared with experiments at 20–60% — computed from regular-solution free energy (entropy + Ω)`);
    if (I < 0.1) x.push(`Light intensity ${I.toPrecision(2)} sun: outside compared range 0.1–3 sun — ${I > 3 ? "Carriers fill the I-rich regions (Fermi occupation), weakening the funnel — same direction as re-mixing at high intensity (Mao et al. 2021)" : "Near the threshold where the funnel drive falls below thermal noise and segregation stops"}`);
    if (Tl < 0 || Tl > 80 || Td < -20 || Td > 80) x.push(`Outside temperature range — ion diffusion Arrhenius (Ea ${P.SEG_DEFAULTS.ea_eV} eV), mixing entropy from kT. ${Math.max(Tl, Td) > 120 ? "If Ω < 2kT, mixing is thermally favoured" : ""}`);
    if (v < 0.2 || v > 3) x.push(`vacancies ×${v.toPrecision(2)}: scales diffusion proportionally (speed changes, final state does not)`);
    if (om < 0.02 || om > 0.05) x.push(`Ω ${(om * 1000).toFixed(0)} meV: ${om > 2 * 8.617e-5 * S.lightT ? "Ω > 2kT — spontaneous (spinodal) separation even in the dark" : "outside reported values (20–50 meV)"}`);
    if (g < 50 || g > 600) x.push(`grain ${g} nm: ${g > 256 ? "Larger than the sample window (256 nm), so no grain boundaries" : "Very dense grain boundaries — more ion highways"}`);
    if (tau < 100 || tau > 3000) x.push(`Carrier lifetime ${tau} ns: reflected through steady-state carrier density n = Gτ`);
    segX.innerHTML = `<div class="row between"><span class="hint">Input conditions</span><span class="vb ${x.length ? "ext" : ""}">${x.length ? "Extrapolated · physics" : "Within validated range"}</span></div>` +
      (x.length ? `<ul class="msgs">${x.map((t) => `<li class="x">${t}</li>`).join("")}</ul>` : "");
  }

  const presetHost = $("presets");
  Object.keys(PRESETS).forEach((name) => {
    const b = document.createElement("button"); b.className = "chip"; b.textContent = name; b.setAttribute("aria-pressed", name === "Reference sample");
    b.addEventListener("click", () => {
      presetHost.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      const mod = Object.assign({ x_br: base.x_br, grain_size_nm: base.grain_size_nm, vacancy_ratio: 1, gb_passivation: 0, omega_eV: base.omega_eV, carrier_lifetime_ns: base.carrier_lifetime_ns }, PRESETS[name]);
      for (const k in mod) segCtl[k].set(mod[k]);
      $("preset-note").textContent = PRESET_NOTE[name];
      resetSim(true);
    });
    presetHost.appendChild(b);
  });
  $("preset-note").textContent = PRESET_NOTE["Reference sample"];

  function simParams() {
    return { x_br: segCtl.x_br.get(), grain_size_nm: segCtl.grain_size_nm.get(), vacancy_ratio: segCtl.vacancy_ratio.get(),
      gb_passivation: segCtl.gb_passivation.get(), omega_eV: segCtl.omega_eV.get(), carrier_lifetime_ns: segCtl.carrier_lifetime_ns.get(),
      intensity_suns: S.light ? segCtl.suns.get() : 0, temperature_K: S.light ? S.lightT : S.darkT };
  }
  function resetSim(lightOn) {
    if (lightOn) setLight(true, true);
    S.sim = new P.SegregationSim(simParams()); segRange();
    S.hist = [S.sim.history[0]]; S.pl0 = S.sim.history[0].pl; S.impact = null; S.lastImpact = 0;
    S.shades = S.light ? [[0, Infinity]] : [];
    drawMap(); drawPL(); segKPIs();
  }
  function setLight(on, silent) {
    S.light = on;
    const b = $("btn-lamp"); b.setAttribute("aria-pressed", on); b.textContent = on ? "☀ Light off" : "☀ Light on";
    $("lamp-pill").classList.toggle("on", on); $("lamp-text").textContent = on ? "Light on" : "Light off (dark)";
    if (silent || !S.sim) return;
    const t = S.sim.t;
    if (on) S.shades.push([t, Infinity]); else if (S.shades.length) S.shades[S.shades.length - 1][1] = t;
    S.sim.setLight(on ? segCtl.suns.get() : 0);
    S.sim.setTemperature(on ? S.lightT : S.darkT);
  }
  $("btn-lamp").addEventListener("click", () => setLight(!S.light));
  $("btn-pause").addEventListener("click", () => { S.running = !S.running; $("btn-pause").textContent = S.running ? "Pause" : "Resume"; });
  $("btn-reset").addEventListener("click", () => resetSim(true));
  $("show-gb").addEventListener("change", drawMap);
  segGroup(document.querySelector(".seg[aria-label='Playback speed']"), "speed", (v) => { S.speed = +v; });

  // real sample colours: iodide dark red-brown -> bromide orange
  const STOPS = [[0, [33, 21, 15]], [0.25, [90, 42, 18]], [0.5, [165, 71, 15]], [0.75, [233, 130, 26]], [1, [255, 200, 87]]];
  function cmap(v) {
    v = Math.max(0, Math.min(1, v));
    for (let i = 1; i < STOPS.length; i++) if (v <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i], t = (v - a) / (b - a);
      return ca.map((c, k) => c + t * (cb[k] - c));
    }
    return STOPS[STOPS.length - 1][1];
  }
  const off = document.createElement("canvas"), mapCv = $("map"), mctx = mapCv.getContext("2d");
  function drawMap() {
    const sim = S.sim, N = sim.N; off.width = N; off.height = N;
    const ctx = off.getContext("2d"), img = ctx.createImageData(N, N), gbOn = $("show-gb").checked;
    for (let i = 0; i < N * N; i++) {
      let [r, g, b] = cmap(sim.x[i]);
      if (gbOn && sim.gb[i]) { r = r * 0.55 + 255 * 0.45; g = g * 0.55 + 255 * 0.45; b = b * 0.55 + 255 * 0.45; }
      img.data[4 * i] = r; img.data[4 * i + 1] = g; img.data[4 * i + 2] = b; img.data[4 * i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    mctx.imageSmoothingEnabled = true; mctx.imageSmoothingQuality = "high";
    mctx.drawImage(off, 0, 0, mapCv.width, mapCv.height);
  }
  function fmtTime(t) { return t < 120 ? `${t.toFixed(1)} s` : t < 7200 ? `${(t / 60).toFixed(1)} min` : `${(t / 3600).toFixed(2)} h`; }
  function drawPL() {
    if ($("bench-seg").hidden) return;
    const h = S.hist, t1 = Math.max(10, h[h.length - 1].t);
    const pls = h.map((o) => o.pl), lo = Math.min(...pls, S.pl0 - 0.02), hi = Math.max(...pls, S.pl0) + 0.01;
    const unit = t1 < 120 ? 1 : t1 < 7200 ? 60 : 3600, ul = unit === 1 ? "s" : unit === 60 ? "min" : "h";
    chart($("pl-chart"), {
      x: [0, t1 / unit], y: [Math.floor(lo * 50) / 50, Math.ceil(hi * 50) / 50], xl: `Time (${ul})`, yl: "PL peak (eV)",
      shades: S.shades.map(([a, b]) => [a / unit, Math.min(b, t1) / unit, cssVar("--lamp")]),
      series: [{ xs: h.map((o) => o.t / unit), ys: pls, color: cssVar("--accent"), w: 2.2 },
               { xs: [0, t1 / unit], ys: [S.pl0, S.pl0], color: cssVar("--muted"), w: 1, dash: "4 4" }],
      points: [{ x: t1 / unit, y: pls[pls.length - 1], color: cssVar("--accent"), r: 4 }],
      yf: (v) => v.toFixed(2),
    });
  }
  function segKPIs() {
    const o = S.hist[S.hist.length - 1], shift = (o.pl - S.pl0) * 1000, im = S.impact;
    const sev = (v, a, b) => v < a ? "bad" : v < b ? "warn" : "good";
    kpis($("seg-kpis"), [
      { k: "Initial bandgap", v: fmt(P.MAT.FACS_I_BR(S.sim.p.x_br)), u: "eV", s: `Br ${(S.sim.p.x_br * 100).toFixed(0)}%` },
      { k: "Current PL peak", v: fmt(o.pl, 3), u: "eV", s: "Emission colour = where charges sit" },
      { k: "PL shift", v: signed(shift), u: "meV", cls: sev(shift, -60, -15), s: shift < -15 ? "Segregating" : "Mixed" },
      { k: "I-rich island area", v: (o.i_rich * 100).toFixed(1), u: "%", s: `Most I-rich spot Br ${(o.x_min * 100).toFixed(0)}%` },
      { k: "Tandem Voc change", v: im ? signed(im.dvoc) : "…", u: "mV", cls: im ? sev(im.dvoc, -60, -15) : "", s: "Voc: open-circuit voltage, the cell's maximum voltage" },
      { k: "Tandem efficiency", v: im ? fmt(im.pceAfter, 1) : "…", u: "%", s: im ? `Before segregation ${fmt(im.pceBefore, 1)}%` : "2-junction, bottom 1.25 eV" },
    ]);
    $("clock").textContent = `t = ${fmtTime(S.sim.t)}`;
  }
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let frame = 0;
  function loop() {
    requestAnimationFrame(loop);
    if (!S.running || $("bench-seg").hidden) return;
    const t0 = performance.now(), budget = 10 * S.speed;
    let o;
    do { o = S.sim.steps(S.speed < 1 ? 1 : 2); } while (performance.now() - t0 < Math.min(budget, 22) && S.speed >= 1);
    S.hist.push(o);
    if (S.hist.length > 1500) S.hist = S.hist.filter((_, i) => i % 2 === 0 || i === S.hist.length - 1);
    const now = performance.now();
    if (now - S.lastImpact > 700) { S.impact = P.segregationImpact(S.sim, TOP, [TOP, BOT], 0); S.lastImpact = now; }
    drawMap();
    if (++frame % 3 === 0) { drawPL(); segKPIs(); }
  }
  if (reduced) S.running = false, $("btn-pause").textContent = "Start";

  // =====================================================================
  // Tandem designer
  // =====================================================================
  const LAYER_NAMES = { 1: ["Absorber"], 2: ["Top cell", "Bottom cell"], 3: ["Top cell", "Middle cell", "Bottom cell"] };
  const LAYER_COLORS = { 1: ["--mid"], 2: ["--top", "--bot"], 3: ["--top", "--mid", "--bot"] };
  const DEFAULT_LAYERS = {
    1: [{ eg: 1.55, ere: -3, t: 600 }],
    2: [{ eg: 1.77, ere: -4, t: 300 }, { eg: 1.25, ere: -3, t: 1100 }],
    3: [{ eg: 1.95, ere: -4, t: 150 }, { eg: 1.55, ere: -3, t: 270 }, { eg: 1.25, ere: -3, t: 1100 }],
  };
  const C = { n: 2, spec: "AM1.5G", layers: JSON.parse(JSON.stringify(DEFAULT_LAYERS[2])), ctl: [], pending: false };
  function compText(eg) {
    if (eg >= 1.55) return `FA0.8Cs0.2Pb(I1-xBrx)3 · Br x ≈ ${P.MAT.FACS_I_BR.inverse(eg).toFixed(2)}`;
    if (eg >= 1.235) return `Pb1-ySnyI3 · Sn y ≈ ${P.MAT.PB_SN.inverse(eg).toFixed(2)}`;
    return "A bandgap hard to reach with perovskites (Pb-Sn minimum about 1.23 eV)";
  }
  function buildLayers() {
    const host = $("layers"); host.innerHTML = ""; C.ctl = [];
    C.layers.forEach((L, k) => {
      const card = document.createElement("div"); card.className = "layer";
      card.style.setProperty("--c", `var(${LAYER_COLORS[C.n][k]})`);
      card.innerHTML = `<div class="head"><h3>${LAYER_NAMES[C.n][k]}</h3><span class="comp" id="comp-${k}"></span></div><div class="ctls two"></div>`;
      host.appendChild(card);
      const h = card.querySelector(".ctls"), upd = () => { card.querySelector(".comp").textContent = compText(L.eg); schedule(); };
      const eg = slider(h, { id: `l${k}-eg`, label: "Bandgap", min: 1.2, max: 2.3, step: 0.01, value: L.eg, fmt: (v) => `${v.toFixed(2)} eV`, onInput: (v) => { L.eg = v; upd(); } });
      const ere = slider(h, { id: `l${k}-ere`, label: "ERE", min: -5, max: -1, step: 0.1, value: L.ere, fmt: (v) => `10^${v.toFixed(1)}`, hint: "External radiative efficiency", onInput: (v) => { L.ere = v; upd(); } });
      const th = slider(h, { id: `l${k}-t`, label: "Thickness", min: 50, max: 2000, step: 10, value: L.t, fmt: (v) => `${v} nm`, onInput: (v) => { L.t = v; upd(); } });
      C.ctl.push({ eg, ere, th });
      card.querySelector(".comp").textContent = compText(L.eg);
    });
  }
  // temperature coefficient: the perovskite band gap widens as temperature rises (+0.30 meV/K, smaller with more Sn)
  const snOf = (eg) => eg < 1.55 ? P.MAT.PB_SN.inverse(eg) : 0;
  const toCells = () => C.layers.map((L) => P.cell({ eg: L.eg, ere: 10 ** L.ere, thickness_nm: L.t, dEgdT: window.PerolabPhys ? window.PerolabPhys.dEgdT(snOf(L.eg)) : 3e-4 }));
  C.T = 25; C.I = 1;
  const cellT = slider($("cell-cond"), { id: "c-T", label: "Cell temperature", min: -100, max: 100, step: 1, value: 25, fmt: (v) => `${v} °C`,
    hint: "Bandgap shift (+0.3 meV/K), thermal voltage and dark current all change. Space eclipse −100 °C, summer rooftop around 70 °C", onInput: (v) => { C.T = v; schedule(); } });
  // light intensity is absolute suns (1 sun = 1000 W/m²). Converted to a multiple of the chosen spectrum (Ground AM1.5G 1000 W/m², Space AM0 about 1361 W/m²) when computing
  C.sun = 1;
  const specW = () => P.spectrum(C.spec).power;
  const cellI = slider($("cell-cond"), { id: "c-I", label: "Light intensity", min: 0.05, max: 1.5, step: 0.01, value: 1,
    fmt: (v) => `${v.toFixed(2)} sun · ${Math.round(v * 1000)} W/m²`, hint: "1 sun = midday sunlight at ground level. In space (Earth orbit) 1.36 sun. Under weak light, leakage (shunt) cuts efficiency", onInput: (v) => { C.sun = v; schedule(); } });
  const setSpec = (sp) => { C.spec = sp; document.querySelectorAll("#spec-seg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.s === sp)); };
  quickGroups(cellI, [
    { label: "Ground", list: LIGHT_GROUND.map(([v, l]) => [v, l, () => setSpec("AM1.5G")]) },
    { label: "Space", list: LIGHT_SPACE.map(([v, l]) => [v, l, () => setSpec("AM0")]) },
  ], (v) => { C.sun = v; schedule(); });
  Object.defineProperty(C, "I", { get: () => C.sun * 1000 / specW() });
  const simOpts = (n) => ({ npts: n, T: C.T + 273.15, intensity: C.I });
  function schedule() { if (C.pending) return; C.pending = true; requestAnimationFrame(() => { C.pending = false; cellUpdate(); }); }
  function cellUpdate() {
    if ($("bench-cell").hidden) return;
    const r = P.simulate(toCells(), C.spec, simOpts(1200)), t = r.total;
    const ideal = P.simulate(C.layers.map((L) => P.cell({ eg: L.eg, ideal: true })), C.spec, { npts: 1200 }).total.pce;
    const ext = C.T < 15 || C.T > 85 || C.sun < 0.1;
    $("pce").innerHTML = `${fmt(t.pce, 2)}<small>%</small>`;
    $("pce-sub").innerHTML = `${C.spec === "AM0" ? "Space AM0 spectrum" : "Ground AM1.5G spectrum"} · ${C.sun.toFixed(2)} sun (${Math.round(C.sun * 1000)} W/m²), ${C.T} °C · ideal limit for same bandgap (25 °C) ${fmt(ideal, 1)}% <span class="vb ${ext ? "ext" : ""}">${ext ? "Extrapolated · physics" : "Within validated range"}</span>` +
      (C.T !== 25 ? ` · bandgap ${r.subcells.map((s) => s.eg.toFixed(3)).join(" / ")} eV` : "");
    kpis($("cell-kpis"), [
      { k: "Voc open-circuit voltage", v: fmt(t.voc, 3), u: "V" },
      { k: "Jsc short-circuit current", v: fmt(t.jsc, 2), u: "mA/cm²" },
      { k: "FF fill factor", v: fmt(t.ff * 100, 1), u: "%", s: "How close the output is to ideal" },
    ]);
    // current-matching bars
    const mx = Math.max(...r.subcells.map((s) => s.jsc));
    $("jbars").innerHTML = r.subcells.map((s, k) => `<div class="jbar ${C.n > 1 && k === r.limiting ? "lim" : ""}" style="--c:var(${LAYER_COLORS[C.n][k]})">
      <span class="name">${LAYER_NAMES[C.n][k]}</span><div class="track"><div class="fill" style="width:${(s.jsc / mx * 100).toFixed(1)}%"></div></div>
      <span class="num" style="text-align:right">${fmt(s.jsc, 2)}</span></div>`).join("") +
      (C.n > 1 ? `<p class="hint" style="margin:6px 0 0">Units mA/cm² · spread between cells ${fmt(mx - Math.min(...r.subcells.map((s) => s.jsc)), 2)}. Closer to 0 means less loss</p>` : `<p class="hint" style="margin:6px 0 0">Units mA/cm² · single cells need no matching</p>`);
    // absorption spectrum
    const E = r.E, sp = P.spectrum(C.spec).phi, step = 3, xs = [], sun = [];
    for (let i = 0; i < E.length; i += step) { xs.push(E[i]); sun.push(sp[i] * C.I / 1e21); }
    const series = [{ xs, ys: sun, color: cssVar("--muted"), fill: true, opacity: 0.15, w: 1 }];
    r.subcells.forEach((s, k) => {
      const ys = []; for (let i = 0; i < E.length; i += step) ys.push(s.absFlux[i] / 1e21);
      series.push({ xs, ys, color: cssVar(LAYER_COLORS[C.n][k]), fill: true, opacity: 0.35, w: 1.6 });
    });
    chart($("abs-chart"), { x: [1.0, 3.6], y: [0, Math.max(...sun) * 1.05], xl: "Photon energy (eV) · bluer to the right", yl: "Photons (×10²¹/m²·s·eV)", series, yf: (v) => v < 0.1 ? v.toPrecision(1) : v.toFixed(1), xf: (v) => v.toFixed(1) });
    // J-V
    const v = Array.from(t.v), j = Array.from(t.j);
    chart($("jv-chart"), { x: [0, Math.ceil(t.voc * 1.08 * 10) / 10], y: [0, Math.ceil(t.jsc * 1.15)], xl: "Voltage (V)", yl: "mA/cm²", margin: { l: 40 },
      series: [{ xs: v, ys: j, color: cssVar("--accent"), w: 2.2, fill: true, opacity: 0.08 }], nx: 4, ny: 4,
      xf: (x) => x.toFixed(1) });
  }
  segGroup($("junction-seg"), "n", (n) => { C.n = +n; C.layers = JSON.parse(JSON.stringify(DEFAULT_LAYERS[C.n])); buildLayers(); $("match-note").textContent = ""; cellUpdate(); });
  segGroup($("spec-seg"), "s", (s) => { C.spec = s; C.sun = s === "AM0" ? 1.36 : 1; cellI.set(C.sun); cellUpdate(); });
  $("btn-match").addEventListener("click", () => {
    if (C.n < 2) { $("match-note").textContent = "A single cell has no current to match"; return; }
    $("match-note").textContent = "Computing…";
    setTimeout(() => {
      const before = P.simulate(toCells(), C.spec, simOpts(800)).total.pce;
      const o = P.optimizeThickness(toCells(), C.spec, simOpts(800));
      o.cells.forEach((c, k) => { C.layers[k].t = Math.round(c.thickness_nm); C.ctl[k].th.set(C.layers[k].t); });
      $("match-note").textContent = `${fmt(before, 2)}% → ${fmt(o.result.total.pce, 2)}%`;
      cellUpdate();
    }, 20);
  });
  buildLayers();

  // =====================================================================
  // Composition calculator
  // =====================================================================
  const K = {};
  K.target = slider($("ctl-target"), { id: "c-target", label: "Target bandgap", min: 1.2, max: 2.3, step: 0.01, value: 1.77, fmt: (v) => `${v.toFixed(2)} eV`, onInput: () => compUpdate() });
  K.x = slider($("ctl-comp"), { id: "c-x", label: "Br fraction x (I/Br series)", min: 0, max: 1, step: 0.01, value: 0.4, fmt: (v) => `${(v * 100).toFixed(0)}%`, onInput: () => compUpdate() });
  K.y = slider($("ctl-comp"), { id: "c-y", label: "Sn fraction y (Pb/Sn series)", min: 0, max: 1, step: 0.01, value: 0.5, fmt: (v) => `${(v * 100).toFixed(0)}%`, onInput: () => compUpdate() });
  function compUpdate() {
    if ($("bench-comp").hidden) return;
    const xs = Array.from({ length: 101 }, (_, i) => i / 100), M = P.MAT, tg = K.target.get(), x = K.x.get(), y = K.y.get();
    const pts = [{ x, y: M.FACS_I_BR(x), color: cssVar("--top"), label: `${M.FACS_I_BR(x).toFixed(2)} eV` },
                 { x: y, y: M.PB_SN(y), color: cssVar("--bot"), label: `${M.PB_SN(y).toFixed(2)} eV` }];
    chart($("eg-chart"), { x: [0, 1], y: [1.1, 2.4], xl: "Composition fraction (x or y)", yl: "Bandgap (eV)",
      series: [{ xs, ys: xs.map(M.MA_I_BR), color: cssVar("--muted"), w: 1.4, dash: "5 4" },
               { xs, ys: xs.map(M.FACS_I_BR), color: cssVar("--top"), w: 2.4 },
               { xs, ys: xs.map(M.PB_SN), color: cssVar("--bot"), w: 2.4 },
               { xs: [0, 1], ys: [tg, tg], color: cssVar("--accent"), w: 1, dash: "2 4" }],
      points: pts, xf: (v) => `${(v * 100).toFixed(0)}%`, yf: (v) => v.toFixed(1) });
    const role = tg >= 1.72 ? "For tandem top cells" : tg >= 1.45 ? "For single or middle cells" : "For tandem bottom cells";
    const pbsnMin = 1.23;
    kpis($("target-kpis"), [
      { k: "With I/Br", v: tg >= 1.55 ? `Br ${(M.FACS_I_BR.inverse(tg) * 100).toFixed(0)}` : "—", u: tg >= 1.55 ? "%" : "", s: tg >= 1.55 ? "FA0.8Cs0.2Pb(I,Br)3" : "not possible below 1.55 eV" },
      { k: "With Pb/Sn", v: tg <= 1.55 && tg >= pbsnMin ? `Sn ${(M.PB_SN.inverse(tg) * 100).toFixed(0)}` : "—", u: tg <= 1.55 && tg >= pbsnMin ? "%" : "", s: tg > 1.55 ? "not possible above 1.55 eV" : tg < pbsnMin ? "minimum about 1.23 eV" : "Pb1-ySnyI3" },
      { k: "Use", v: tg >= 1.72 ? "Top" : tg >= 1.45 ? "Single · middle" : "Bottom", s: role },
    ]);
    kpis($("comp-kpis"), [
      { k: `Br ${(x * 100).toFixed(0)}%`, v: fmt(M.FACS_I_BR(x)), u: "eV", s: x > 0.2 ? "Segregation possible under light" : "Almost no segregation", cls: x > 0.2 ? "warn" : "" },
      { k: `Sn ${(y * 100).toFixed(0)}%`, v: fmt(M.PB_SN(y)), u: "eV", s: "Tin oxidises easily (Sn²⁺→Sn⁴⁺)" },
    ]);
  }

  // =====================================================================
  // Validation
  // =====================================================================
  const BT = window.BACKTEST || [];
  $("bt-score").textContent = `${BT.filter((r) => r.ok).length}/${BT.length} passed`;
  $("bt-table").innerHTML = `<thead><tr><th>Area</th><th>Item</th><th class="num">Model</th><th>Reference (paper · record)</th><th></th></tr></thead><tbody>` +
    BT.map((r) => `<tr><td><span class="badge">${r.area}</span></td><td>${r.name}</td><td class="num mono">${r.value}</td><td class="hint">${r.ref}<br>Tolerance ${r.range}</td><td class="${r.ok ? "ok" : ""}">${r.ok ? "Pass" : "Fail"}</td></tr>`).join("") + "</tbody>";
  const ST = [
    ["Reference sample", 5.6, -160, -105, "32.42 → 30.55"], ["Vacancy filling (SCN-type)", 26.4, -155, -98, "32.42 → 30.67"],
    ["Grain-boundary passivation layer", 26.5, -154, -99, "32.42 → 30.66"], ["Large grains (600 nm)", 19.3, -156, -101, "32.42 → 30.63"],
    ["Lattice strain relief", 19.2, -125, -71, "32.42 → 31.16"], ["Fast charge extraction", 384.3, -158, -70, "32.42 → 31.17"],
    ["Less bromide (Br 30%)", 27.3, -85, -45, "29.21 → 28.47"], ["Combined", ">600", 0, 0, "32.42 → 32.42"],
  ];
  $("st-table").innerHTML = `<thead><tr><th>Strategy</th><th class="num">t½ (s)</th><th class="num">PL shift</th><th class="num">ΔVoc</th><th class="num">Tandem efficiency %</th></tr></thead><tbody>` +
    ST.map((r) => `<tr><td>${r[0]}</td><td class="num mono">${r[1]}</td><td class="num mono">${r[2]} meV</td><td class="num mono">${r[3]} mV</td><td class="num mono">${r[4]}</td></tr>`).join("") + "</tbody>";

  // =====================================================================
  // shared: select boxes, check boxes
  // =====================================================================
  function selectCtl(host, o) {
    const w = document.createElement("div"); w.className = "sel";
    w.innerHTML = `<label for="${o.id}">${o.label}</label><select id="${o.id}">${Object.entries(o.options).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>${o.hint ? `<span class="hint">${o.hint}</span>` : ""}`;
    host.appendChild(w);
    const s = w.querySelector("select"); s.value = o.value;
    s.addEventListener("change", () => o.onChange(s.value));
    return { get: () => s.value, set: (v) => { s.value = v; }, wrap: w };
  }
  function checkCtl(host, o) {
    const w = document.createElement("label"); w.className = "check";
    w.innerHTML = `<input type="checkbox" id="${o.id}"> ${o.label}`;
    host.appendChild(w);
    const c = w.querySelector("input"); c.checked = o.value;
    c.addEventListener("change", () => o.onChange(c.checked));
    return { get: () => c.checked, set: (v) => { c.checked = v; }, wrap: w };
  }
  function setSeg(el, v) { el.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === String(v))); }
  const fmtH = (h) => !Number.isFinite(h) ? "not reached" : h < 1 ? `${(h * 60).toFixed(0)} min` : h < 48 ? `${h.toFixed(h < 10 ? 1 : 0)} h` : h < 24 * 400 ? `${(h / 24).toFixed(0)} d` : `${(h / 8766).toFixed(1)} yr`;
  const sci = (v, d = 1) => { if (!Number.isFinite(v) || v <= 0) return "—"; const e = Math.floor(Math.log10(v)); return `${(v / 10 ** e).toFixed(d)}×10<sup>${e}</sup>`; };

  // =====================================================================
  // Cell lab
  // =====================================================================
  const F = { r: Object.assign({}, P.RECIPE_DEFAULT), cell: null, name: "Record p-i-n (FA-Cs)", edited: false, ctl: {}, pending: false };
  const fc = F.ctl;
  // undo history: a continuous drag counts as one step (changes within 0.7 s are the same action)
  F.hist = []; F.lastPush = 0;
  function fabPush(force) {
    const now = Date.now();
    if (force || now - F.lastPush > 700) { F.hist.push({ r: JSON.parse(JSON.stringify(F.r)), name: F.name, base: F.base, baseName: F.baseName }); if (F.hist.length > 50) F.hist.shift(); }
    F.lastPush = now;
  }
  function fabSet(k, v) { fabPush(); F.r[k] = v; F.edited = true; fabSchedule(); }
  function normA(changed, v) {
    fabPush();
    const keys = ["fa", "ma", "cs"], others = keys.filter((k) => k !== changed);
    const rest = 1 - v, cur = others.reduce((a, k) => a + F.r[k], 0);
    F.r[changed] = v;
    others.forEach((k) => { F.r[k] = cur > 1e-9 ? F.r[k] / cur * rest : rest / 2; fc[k].set(+F.r[k].toFixed(2)); });
    F.edited = true; fabSchedule();
  }
  const pct = (v) => `${(v * 100).toFixed(0)}%`;
  const comp = $("fab-comp");
  fc.fa = slider(comp, { id: "f-fa", label: "FA (formamidinium)", min: 0, max: 1, step: 0.01, value: F.r.fa, fmt: pct, hint: "A-site organic cation, heat-tolerant", onInput: (v) => normA("fa", v) });
  fc.ma = slider(comp, { id: "f-ma", label: "MA (methylammonium)", min: 0, max: 1, step: 0.01, value: F.r.ma, fmt: pct, hint: "Crystallises well but volatilises near 85 °C", onInput: (v) => normA("ma", v) });
  fc.cs = slider(comp, { id: "f-cs", label: "Cs (caesium)", min: 0, max: 1, step: 0.01, value: F.r.cs, fmt: pct, hint: "Inorganic cation, stabilises the structure", onInput: (v) => normA("cs", v) });
  fc.br = slider(comp, { id: "f-br", label: "Br (X-site bromide)", min: 0, max: 0.8, step: 0.01, value: F.r.br, fmt: pct, hint: "Widens the bandgap; too much causes segregation", onInput: (v) => fabSet("br", v) });
  fc.cl = slider(comp, { id: "f-cl", label: "Cl additive", min: 0, max: 0.1, step: 0.005, value: F.r.cl, fmt: pct, onInput: (v) => fabSet("cl", v) });
  fc.sn = slider(comp, { id: "f-sn", label: "Sn (B-site tin)", min: 0, max: 0.8, step: 0.01, value: F.r.sn, fmt: pct, hint: "Narrows the bandgap (for tandem bottom cells); prone to oxidation", onInput: (v) => fabSet("sn", v) });
  fc.snf2_pct = slider(comp, { id: "f-snf2", label: "SnF₂ (relative to Sn)", min: 0, max: 20, step: 0.5, value: F.r.snf2_pct, fmt: (v) => `${v.toFixed(1)}%`, hint: "Scavenges Sn⁴⁺ (oxidised tin). Only matters with Sn", onInput: (v) => fabSet("snf2_pct", v) });
  const sol = $("fab-sol");
  const PHS = window.PerolabPhys;
  fc.solvent = selectCtl(sol, { id: "f-solv", label: "Main solvent", options: Object.fromEntries(["DMF", "2ME", "NMP", "GBL", "ACN"].map((k) => [k, `${PHS.SOLVENTS[k].name} (boiling point ${(PHS.SOLVENTS[k].Tb - 273.15).toFixed(0)} °C)`])), value: F.r.solvent,
    hint: "Higher vapour pressure dries faster and makes supersaturation steeper", onChange: (v) => fabSet("solvent", v) });
  fc.dmso = slider(sol, { id: "f-dmso", label: "DMSO fraction (rest = main solvent)", min: 0, max: 1, step: 0.05, value: F.r.dmso, fmt: pct, hint: "DMSO forms an intermediate with lead: solubility↑, nucleation↓, slower evaporation", onInput: (v) => fabSet("dmso", v) });
  fc.conc_M = slider(sol, { id: "f-conc", label: "Solution concentration", min: 0.5, max: 2.0, step: 0.05, value: F.r.conc_M, fmt: (v) => `${v.toFixed(2)} M`, hint: "Usually 1.0–1.5 M. Thickness roughly proportional to concentration", onInput: (v) => fabSet("conc_M", v) });
  fc.rpm = slider(sol, { id: "f-rpm", label: "Spin speed", min: 500, max: 8000, step: 100, value: F.r.rpm, fmt: (v) => `${v} rpm`, hint: "Wet film thickness h ∝ ω^(−2/3) (Meyerhofer)", onInput: (v) => fabSet("rpm", v) });
  fc.wet_um = slider(sol, { id: "f-wet", label: "Wet film thickness (printing)", min: 2, max: 20, step: 0.5, value: F.r.wet_um ?? 6, fmt: (v) => `${v} µm`, hint: "Set by blade gap, slot flow rate or inkjet drop volume", onInput: (v) => fabSet("wet_um", v) });
  fc.substrate_C = slider(sol, { id: "f-sub", label: "Substrate · solution temperature", min: 15, max: 100, step: 1, value: F.r.substrate_C, fmt: (v) => `${v} °C`, hint: "Higher temperature raises vapour pressure exponentially, so it dries fast (hot casting)", onInput: (v) => fabSet("substrate_C", v) });
  fc.drip_frac = slider(sol, { id: "f-drip", label: "Quench timing", min: 0.05, max: 0.95, step: 0.01, value: F.r.drip_frac, fmt: (v) => `Wet film ${(v * 100).toFixed(0)}% remaining`, hint: "Too late and large islands have already grown, leaving pinholes", onInput: (v) => fabSet("drip_frac", v) });
  fc.gas_speed = slider(sol, { id: "f-gas", label: "Gas-knife speed", min: 5, max: 300, step: 5, value: F.r.gas_speed, fmt: (v) => `${v} m/s`, hint: "Flat-plate boundary-layer mass transfer k ∝ √speed", onInput: (v) => fabSet("gas_speed", v) });
  function fabProcVis() {
    fc.rpm.wrap.hidden = F.r.deposition !== "spin"; fc.wet_um.wrap.hidden = F.r.deposition === "spin";
    fc.drip_frac.wrap.hidden = F.r.quench === "none"; fc.gas_speed.wrap.hidden = F.r.quench !== "gas";
  }
  segGroup($("fab-dep"), "v", (v) => { fabSet("deposition", v); if (v !== "spin" && F.r.wet_um == null) { F.r.wet_um = v === "inkjet" ? 4 : 6; fc.wet_um.set(F.r.wet_um); } fabProcVis(); });
  segGroup($("fab-quench"), "v", (v) => { fabSet("quench", v); fabProcVis(); });
  const ann = $("fab-anneal");
  fc.anneal_C = slider(ann, { id: "f-at", label: "Temperature", min: 25, max: 200, step: 5, value: F.r.anneal_C, fmt: (v) => `${v} °C`, hint: "MA compounds start decomposing above 120 °C. Conversion, decomposition and ripening all Arrhenius", onInput: (v) => fabSet("anneal_C", v) });
  fc.anneal_min = slider(ann, { id: "f-am", label: "Time", min: 1, max: 180, step: 1, value: F.r.anneal_min, fmt: (v) => `${v} min`, onInput: (v) => fabSet("anneal_min", v) });
  const atmHost = $("fab-atm-ctl");
  fc.glovebox_ppm = slider(atmHost, { id: "f-ppm", label: "Glovebox O₂·H₂O", min: -1, max: 3, step: 0.05, value: Math.log10(F.r.glovebox_ppm), fmt: (v) => `${(10 ** v).toFixed(v < 0 ? 1 : 0)} ppm`, hint: "ppm: parts per million. Usually kept below 1 ppm", onInput: (v) => fabSet("glovebox_ppm", 10 ** v) });
  fc.fab_rh = slider(atmHost, { id: "f-rh", label: "Ambient humidity", min: 0, max: 100, step: 1, value: F.r.fab_rh, fmt: (v) => `${v}% RH`, onInput: (v) => fabSet("fab_rh", v) });
  segGroup($("fab-atm"), "v", (v) => { fabSet("fab_atm", v); fabAtmVis(); });
  function fabAtmVis() { fc.glovebox_ppm.wrap.hidden = !["n2", "ar"].includes(F.r.fab_atm); fc.fab_rh.wrap.hidden = F.r.fab_atm !== "air"; }
  const stk = $("fab-stack");
  const nm = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.name]));
  fc.htl = selectCtl(stk, { id: "f-htl", label: "Hole transport layer (HTL)", options: nm(P.HTLS), value: F.r.htl, onChange: (v) => fabSet("htl", v) });
  fc.etl = selectCtl(stk, { id: "f-etl", label: "Electron transport layer (ETL)", options: nm(P.ETLS), value: F.r.etl, onChange: (v) => fabSet("etl", v) });
  fc.passivation = selectCtl(stk, { id: "f-pas", label: "Surface · grain-boundary treatment", options: nm(P.PASSIVATIONS), value: F.r.passivation, onChange: (v) => fabSet("passivation", v) });
  fc.electrode = selectCtl(stk, { id: "f-el", label: "Metal electrode", options: nm(P.ELECTRODES), value: F.r.electrode, onChange: (v) => fabSet("electrode", v) });
  fc.barrier = checkCtl(stk, { id: "f-bar", label: "Barrier before metal (ITO · ALD SnO₂)", value: F.r.barrier, onChange: (v) => fabSet("barrier", v) });
  function fabSync() {
    for (const k of ["fa", "ma", "cs", "br", "cl", "sn", "snf2_pct", "dmso", "conc_M", "rpm", "substrate_C", "drip_frac", "gas_speed", "anneal_C", "anneal_min", "fab_rh"]) fc[k].set(F.r[k]);
    fc.wet_um.set(F.r.wet_um ?? (F.r.deposition === "inkjet" ? 4 : 6)); fc.solvent.set(F.r.solvent);
    if (F.r.deposition !== "spin" && F.r.wet_um == null) F.r.wet_um = F.r.deposition === "inkjet" ? 4 : 6;
    fabProcVis();
    fc.glovebox_ppm.set(Math.log10(F.r.glovebox_ppm));
    for (const k of ["htl", "etl", "passivation", "electrode"]) fc[k].set(F.r[k]);
    fc.barrier.set(F.r.barrier);
    setSeg($("fab-dep"), F.r.deposition); setSeg($("fab-quench"), F.r.quench); setSeg($("fab-atm"), F.r.fab_atm);
    fabAtmVis();
  }
  // ---- presets, undo, my recipes ----
  const FULL = (r) => Object.assign({}, P.RECIPE_DEFAULT, r);
  F.base = FULL({}); F.baseName = F.name;
  const STEP_KEYS = {
    1: ["fa", "ma", "cs", "br", "cl", "sn", "snf2_pct"],
    2: ["deposition", "quench", "solvent", "dmso", "conc_M", "rpm", "wet_um", "substrate_C", "drip_frac", "gas_speed"],
    3: ["anneal_C", "anneal_min"],
    4: ["fab_atm", "glovebox_ppm", "fab_rh"],
    5: ["htl", "etl", "passivation", "electrode", "barrier"],
  };
  const KEY_LABEL = { fa: "FA", ma: "MA", cs: "Cs", br: "Br", cl: "Cl", sn: "Sn", snf2_pct: "SnF₂", deposition: "Coating method", quench: "Quench", solvent: "Solvent", dmso: "DMSO",
    conc_M: "Concentration", rpm: "Spin speed", wet_um: "Wet film", substrate_C: "Substrate temperature", drip_frac: "Quench timing", gas_speed: "Gas speed", anneal_C: "Annealing temperature", anneal_min: "Annealing time",
    fab_atm: "Atmosphere", glovebox_ppm: "O₂·H₂O", fab_rh: "Humidity", htl: "HTL", etl: "ETL", passivation: "Surface treatment", electrode: "Electrode", barrier: "Barrier" };
  const same = (a, b) => typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)) : a === b;
  const changedKeys = () => Object.values(STEP_KEYS).flat().filter((k) => k !== "wet_um" || F.r.deposition !== "spin").filter((k) => !same(F.r[k], F.base[k]) && !(F.r[k] == null && F.base[k] == null));
  function fabLoad(r, name, base, baseName) {
    F.r = FULL(JSON.parse(JSON.stringify(r))); F.name = name;
    if (base) { F.base = FULL(JSON.parse(JSON.stringify(base))); F.baseName = baseName || name; F.basePce = null; }
    F.edited = changedKeys().length > 0;
    $("fab-presets").querySelectorAll("button.chip").forEach((x) => x.setAttribute("aria-pressed", x.dataset.name === F.baseName));
    fabSync(); fabUpdate();
  }
  function presetChip(name, recipe, mine) {
    const b = document.createElement("button"); b.className = "chip" + (mine ? " mine" : ""); b.dataset.name = name;
    b.setAttribute("aria-pressed", name === F.baseName);
    b.innerHTML = mine ? `★ ${name}<span class="x" title="Delete" role="button" aria-label="Delete ${name}">×</span>` : name;
    b.addEventListener("click", (e) => {
      if (e.target.classList.contains("x")) { delMine(name); return; }
      fabPush(true); fabLoad(recipe, name, recipe, name);
    });
    $("fab-presets").appendChild(b);
  }
  Object.keys(P.PRESET_RECIPES).forEach((name) => presetChip(name, P.PRESET_RECIPES[name], false));
  // My recipes: stored only in this browser (localStorage). Where that is unavailable, kept for this visit only
  const MY_KEY = "perolab.myRecipes.v1";
  let MINE = [];
  try { MINE = JSON.parse(localStorage.getItem(MY_KEY) || "[]"); } catch (e) { MINE = []; }
  const saveMine = () => { try { localStorage.setItem(MY_KEY, JSON.stringify(MINE)); return true; } catch (e) { return false; } };
  function renderMine() {
    $("fab-presets").querySelectorAll(".chip.mine").forEach((x) => x.remove());
    MINE.forEach((m) => presetChip(m.name, m.r, true));
  }
  function delMine(name) {
    MINE = MINE.filter((m) => m.name !== name); saveMine(); renderMine();
    $("fab-tool-note").textContent = `'${name}' deleted`;
  }
  renderMine();
  $("fab-save").addEventListener("click", () => {
    let n = 1; while (MINE.some((m) => m.name === `My recipe ${n}`)) n++;
    const name = `My recipe ${n}`, r = JSON.parse(JSON.stringify(F.r));
    MINE.push({ name, r }); const ok = saveMine(); renderMine();
    F.name = name; F.base = FULL(r); F.baseName = name; F.basePce = null; F.edited = false;
    $("fab-presets").querySelectorAll("button.chip").forEach((x) => x.setAttribute("aria-pressed", x.dataset.name === name));
    $("fab-tool-note").textContent = ok ? `'${name}' saved (kept in this browser)` : `'${name}' saved (lost when this window closes)`;
    fabUpdate();
  });
  $("fab-undo").addEventListener("click", fabUndo);
  function fabUndo() {
    const h = F.hist.pop(); if (!h) return;
    F.r = h.r; F.name = h.name; F.base = h.base; F.baseName = h.baseName; F.basePce = null; F.lastPush = 0;
    F.edited = changedKeys().length > 0;
    $("fab-presets").querySelectorAll("button.chip").forEach((x) => x.setAttribute("aria-pressed", x.dataset.name === F.baseName));
    fabSync(); fabUpdate();
  }
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z" && !$("bench-fab").hidden && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || "") ) { e.preventDefault(); fabUndo(); }
  });
  $("fab-reset-preset").addEventListener("click", () => { fabPush(true); fabLoad(F.base, F.baseName); $("fab-tool-note").textContent = `'${F.baseName}' restored`; });
  $("fab-reset-all").addEventListener("click", () => {
    fabPush(true); const first = Object.keys(P.PRESET_RECIPES)[0];
    fabLoad(P.PRESET_RECIPES[first], first, P.PRESET_RECIPES[first], first); $("fab-tool-note").textContent = "Reset to default recipe";
  });
  // per-step reset buttons
  document.querySelectorAll("#bench-fab .step").forEach((panel) => {
    const n = +panel.querySelector(".step-n").textContent, btn = document.createElement("button");
    btn.className = "step-reset"; btn.textContent = "↺ Reset this step only"; btn.dataset.step = n;
    btn.addEventListener("click", () => {
      fabPush(true);
      for (const k of STEP_KEYS[n]) F.r[k] = F.base[k] == null ? null : JSON.parse(JSON.stringify(F.base[k]));
      F.edited = changedKeys().length > 0; fabSync(); fabUpdate();
    });
    panel.querySelector(".step-h").appendChild(btn);
  });
  const CTL_OF = { glovebox_ppm: "glovebox_ppm" };
  function fabMarks(ch) {
    const set = new Set(ch);
    for (const k in fc) if (fc[k] && fc[k].wrap) fc[k].wrap.classList.toggle("changed", set.has(k));
    document.querySelectorAll("#bench-fab .step-reset").forEach((b) => { b.disabled = !STEP_KEYS[b.dataset.step].some((k) => set.has(k)); });
    $("fab-undo").disabled = !F.hist.length; $("fab-reset-preset").disabled = !ch.length;
  }
  // ---- compare with real cells (Perovskite Database Project, about 40,000 cells) ----
  const RC = window.REALCELLS;
  const KEY_NAMES = { arch: "architecture", acat: "A cation", brb: "Br fraction", snb: "Sn fraction", htl2: "HTL", etl2: "ETL", quench: "quench", dep: "coating method", anb: "anneal temperature" };
  function realKeys(r) {
    const pol = (P.HTLS[r.htl] || {}).polarity || "pin";
    const acat = r.ma >= 0.9 ? "MA" : r.fa >= 0.9 ? "FA" : r.cs >= 0.9 ? "Cs" : r.cs < 0.03 ? "FAMA" : r.ma < 0.03 ? "CsFA" : r.fa < 0.03 ? "CsMA" : "CsFAMA";
    const brb = r.br < 0.02 ? 0 : r.br <= 0.1 ? 1 : r.br <= 0.25 ? 2 : r.br <= 0.45 ? 3 : r.br <= 0.7 ? 4 : 5;
    const snb = r.sn < 0.02 ? 0 : r.sn <= 0.4 ? 1 : r.sn <= 0.7 ? 2 : 3;
    const htl2 = { spiro_li: "spiro_litfsi" }[r.htl] || r.htl, anb = r.anneal_C < 90 ? "lt90" : r.anneal_C <= 130 ? "90-130" : "gt130";
    return { arch: pol, acat, brb, snb, htl2, etl2: r.etl, quench: r.quench, dep: r.deposition, anb };
  }
  function fabReal(c) {
    const el = $("fab-real"); if (!RC) { el.innerHTML = ""; return; }
    const k = realKeys(F.r);
    let hit = null, lv = null;
    for (const L of RC.levels) { const row = L.rows[L.keys.map((x) => k[x]).join("|")]; if (row && row[0] >= 15) { hit = row; lv = L; break; } }
    if (!hit) { el.innerHTML = `<div class="hint">Real-cell comparison: fewer than 15 similar cells (architecture, composition) in the database, so no comparison.</div>`; return; }
    const [n, p10, p50, p90, mx] = hit, me = c.pce;
    const lo = 0, hi = Math.max(30, me, mx), X = (v) => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
    const pos = me < p10 ? "below bottom 10%" : me < p50 ? "bottom 10–50%" : me < p90 ? "top 10–50%" : me <= mx ? "within top 10%" : "above the measured best";
    const dropped = Object.keys(KEY_NAMES).filter((x) => !lv.keys.includes(x)).map((x) => KEY_NAMES[x]);
    el.innerHTML = `<div class="row between"><b style="font-size:14px">Compare with real cells</b><span class="hint">Perovskite Database (NOMAD) · ${RC.meta.years[0]}~${RC.meta.years[1]} papers</span></div>
      <div class="hint">Similar real cells: <b>${n.toLocaleString()}</b> - matched on: ${lv.keys.map((x) => KEY_NAMES[x]).join(", ")}${dropped.length ? ` <span style="opacity:.7">(ignored for lack of data: ${dropped.join(", ")})</span>` : ""}</div>
      <div class="bar" role="img" aria-label="This cell's position in the measured distribution">
        <div class="iqr" style="left:${X(p10)}%;width:${X(p90) - X(p10)}%"></div><div class="med" style="left:${X(p50)}%"></div><div class="me" style="left:${X(me)}%"></div></div>
      <div class="ticks"><span>0%</span><span>bottom 10% ${p10.toFixed(1)} · median ${p50.toFixed(1)} · top 10% ${p90.toFixed(1)} · best ${mx.toFixed(1)}</span><span>${hi.toFixed(0)}%</span></div>
      <div class="hint">▼ Model efficiency of this recipe <b>${me.toFixed(1)}%</b> = in the measured distribution: <b>${pos}</b>. The model assumes a 'well-made cell', so near the top 10% is normal${me > mx ? ". Above the measured best means post-2020 technology or an optimistic combination in the model" : ""}.</div>`;
  }
  function fabSchedule() { if (F.pending) return; F.pending = true; requestAnimationFrame(() => { F.pending = false; fabUpdate(); }); }
  function fabUpdate() {
    const c = F.cell = P.buildCell(F.r);
    if ($("bench-fab").hidden) return;
    const ch = changedKeys();
    $("fab-current").textContent = `Recipe: ${F.baseName}${ch.length ? ` · changed items ${ch.length} (${ch.slice(0, 4).map((k) => KEY_LABEL[k]).join(", ")}${ch.length > 4 ? " …" : ""})` : ""}`;
    F.edited = ch.length > 0; F.name = F.edited ? `${F.baseName} (edited)` : F.baseName;
    fabMarks(ch);
    $("fab-pce").innerHTML = `${fmt(c.pce, 1)}<small>%</small>`;
    if (F.basePce == null) F.basePce = P.buildCell(F.base).pce;
    const d = c.pce - F.basePce;
    $("fab-delta").className = "delta" + (Math.abs(d) < 0.05 ? "" : d > 0 ? " up" : " down");
    $("fab-delta").textContent = ch.length ? `${d >= 0 ? "+" : ""}${d.toFixed(2)} pts vs ${F.baseName}` : "";
    fabReal(c);
    kpis($("fab-kpis"), [
      { k: "Bandgap", v: fmt(c.eg, 2), u: "eV" }, { k: "Voc open-circuit voltage", v: fmt(c.voc, 3), u: "V" },
      { k: "Jsc short-circuit current", v: fmt(c.jsc, 1), u: "mA/cm²" }, { k: "FF fill factor", v: fmt(c.ff * 100, 0), u: "%" },
    ]);
    const tolCls = c.tolerance > 1 || c.tolerance < 0.82 ? "bad" : "good";
    kpis($("fab-film"), [
      { k: "Black 3D phase fraction", v: (c.phase * 100).toFixed(0), u: "%", cls: c.phase < 0.9 ? "bad" : "good", s: "the rest is phases that absorb poorly" },
      { k: "Film thickness (computed)", v: c.thickness_nm.toFixed(0), u: "nm", s: "Solute amount = concentration × wet film thickness", cls: c.thickness_nm > 1500 || c.thickness_nm < 250 ? "warn" : "" },
      { k: "Grain size", v: c.grain.toFixed(0), u: "nm", s: "Larger means fewer grain boundaries" },
      { k: "Coverage", v: (c.coverage * 100).toFixed(1), u: "%", cls: c.coverage < 0.95 ? "warn" : "", s: "Bare spots (pinholes) are leakage paths" },
      { k: "Defect density", v: sci(c.trap), u: "cm⁻³", s: "Sites that trap and kill electrons" },
      { k: "Carrier lifetime", v: c.tau_ns >= 1000 ? (c.tau_ns / 1000).toFixed(2) : c.tau_ns.toFixed(0), u: c.tau_ns >= 1000 ? "µs" : "ns", s: "How long charges survive before disappearing" },
      { k: "Conversion / decomposition", v: `${(c.conversion * 100).toFixed(0)}/${(c.decomposed * 100).toFixed(1)}`, u: "%", cls: c.conversion < 0.95 || c.decomposed > 0.03 ? "warn" : "", s: "Precursor conversion / PbI₂ decomposition" },
    ]);
    const lo = 0.75, hi = 1.05, pos = (v) => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
    $("tol-gauge").innerHTML = `<div class="row between"><span class="hint">Tolerance factor t (how well ion sizes fit the perovskite structure)</span><span class="num ${tolCls === "bad" ? "" : ""}">t = ${c.tolerance.toFixed(3)}</span></div>
      <div class="track" style="background:linear-gradient(90deg, color-mix(in srgb, var(--bad) 30%, transparent) 0 ${pos(0.82)}%, color-mix(in srgb, var(--good) 30%, transparent) ${pos(0.82)}% ${pos(1.0)}%, color-mix(in srgb, var(--bad) 30%, transparent) ${pos(1.0)}% 100%)"><div class="mark" style="left:${pos(c.tolerance)}%"></div></div>
      <div class="lbl"><span>0.75 · non-perovskite</span><span>0.82 – 1.00 stable</span><span>δ-phase · 1.05</span></div>`;
    // voltage loss
    const VT = 0.025852, h = P.HTLS[F.r.htl], e = P.ETLS[F.r.etl], pas = P.PASSIVATIONS[F.r.passivation];
    const dh = 1 / h.plqy - 1 / 1.4e-2, de = (1 / e.plqy - 1 / 1.4e-2) * pas.iface;
    const Lw = c.wideLoss || 0, Lb = VT * Math.log(1 / c.ereBulk), Lt = VT * Math.log(1 / c.ere), Li = Lt - Lb - Lw;
    const Lh = Li * dh / (dh + de || 1), Le = Li - Lh, Lo = c.vocRad - Lt - c.voc;
    const steps = [["Ideal limit", 0, c.vocRad, "--good"], ["Bulk defects", Lb, null, "--warn"], [`HTL interface (${h.name})`, Lh, null, "--top"], [`ETL interface (${e.name})`, Le, null, "--bot"], ...(Lw > 0.001 ? [["Wide-bandgap extra loss", Lw, null, "--mid"]] : []), ["Other (leakage · resistance)", Lo, null, "--muted"], ["Actual Voc", 0, c.voc, "--accent"]];
    const vmin = Math.min(c.voc, c.vocRad - Lt) - 0.05, vmax = c.vocRad + 0.01, X = (v) => (v - vmin) / (vmax - vmin) * 100;
    let cur = c.vocRad;
    $("fab-wf").innerHTML = steps.map(([lab, loss, abs, col]) => {
      let a, b, txt;
      if (abs != null) { a = vmin; b = abs; txt = `${abs.toFixed(3)} V`; }
      else { a = cur - Math.max(loss, 0); b = cur; cur -= loss; txt = `−${(loss * 1000).toFixed(0)} mV`; }
      return `<div class="wf-row"><span>${lab}</span><div class="track"><div class="seg-bar" style="--c:var(${col});left:${X(a)}%;width:${Math.max(0.5, X(b) - X(a))}%"></div></div><span class="num" style="text-align:right">${txt}</span></div>`;
    }).join("");
    $("fab-vb").innerHTML = `<span class="vb ${c.extrap.length ? "ext" : ""}">${c.extrap.length ? "Extrapolated · physics" : "Within validated range"}</span>`;
    if (c.crys) {
      const k = c.crys, path = k.path.filter((p) => p[0] > 0);
      const t0 = Math.max(0.01, Math.min(0.1 * k.tDry, path.length ? path[0][0] : 0.01)), t1 = Math.max(t0 * 10, k.tDry * 1.05);
      const sMax = Math.max(2, ...path.map((p) => p[1]));
      chart($("fab-crys"), { x: [t0, t1], y: [0, Math.ceil(sMax * 1.1)], xlog: true, xgrid: true, xl: "Time (s, log)", yl: "Supersaturation S", margin: { b: 30 },
        series: [{ xs: path.map((p) => p[0]), ys: path.map((p) => p[1]), color: cssVar("--accent"), w: 2.2 }, { xs: [t0, t1], ys: [1, 1], color: cssVar("--muted"), w: 1, dash: "4 4" }],
        xf: (v) => v >= 1 ? String(v) : v.toExponential(0), ny: 4 });
      kpis($("fab-proc"), [
        { k: "Initial wet film", v: k.h0_um.toFixed(1), u: "µm" }, { k: "Evaporation rate", v: k.Evap_nm_s.toPrecision(2), u: "nm/s", s: `Solvent vapour pressure ${(k.pvap / 1000).toPrecision(2)} kPa` },
        { k: "Solution stage time", v: k.tDry < 1 ? k.tDry.toFixed(2) : k.tDry.toFixed(1), u: "s" }, { k: "Max supersaturation", v: k.Smax.toFixed(1), s: "Larger means more nuclei" },
        { k: "Nucleus density", v: (k.Nnuc * 1e-12).toPrecision(2), u: "/µm²" },
      ]);
    }
    const ms = c.warnings.map((w) => `<li class="w">${w}</li>`).concat(c.notes.map((n) => `<li class="n">${n}</li>`)).concat(c.extrap.map((x) => `<li class="x">${x}</li>`));
    $("fab-msgs").innerHTML = ms.length ? ms.join("") : `<li class="ok">No warnings. The film and stack are a reasonable combination.</li>`;
  }
  $("send-env").addEventListener("click", () => { E.useFab = true; E.compare = false; showTab($("tab-env")); });
  $("send-seg").addEventListener("click", () => { if (!F.cell) fabUpdate(); applySeg(F.cell.seg); showTab($("tab-seg")); });
  $("send-ion").addEventListener("click", () => { showTab($("tab-ion")); document.querySelector('#ion-src button[data-v="fab"]').click(); });
  function applySeg(seg) {
    const map = { x_br: "x_br", grain_size_nm: "grain_size_nm", vacancy_ratio: "vacancy_ratio", gb_passivation: "gb_passivation", omega_eV: "omega_eV", carrier_lifetime_ns: "carrier_lifetime_ns" };
    for (const k in map) if (segCtl[map[k]]) segCtl[map[k]].set(seg[k]);
    presetHost.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", "false"));
    $("preset-note").textContent = `Sample from the Cell lab: Br ${(seg.x_br * 100).toFixed(0)}%, grain ${seg.grain_size_nm.toFixed(0)} nm, vacancy ×${seg.vacancy_ratio.toFixed(2)}, lifetime ${seg.carrier_lifetime_ns.toFixed(0)} ns.`;
    resetSim(true);
  }
  fabAtmVis(); fabProcVis();

  // =====================================================================
  // Environment lab
  // =====================================================================
  const E = { gas: "air", enc: "none", orbit: "none", useFab: true, compare: false, pending: false, cal: "database", q: "auto" };
  const PHX = window.PerolabPhys;
  const MECH_COL = ["--top", "--mid", "--warn", "--accent", "--bot", "--bad", "--muted", "--lamp", "--ink", "--good"];
  const ec = {};
  const envHost2 = $("env-ctl"), atmCtl = $("env-atm-ctl"), spaceCtl = $("env-space-ctl");
  const fmtPa = (p) => p >= 1e5 ? `${(p / 101325).toPrecision(3)} atm` : p >= 100 ? `${(p / 1000).toPrecision(3)} kPa` : p >= 1 ? `${p.toPrecision(2)} Pa` : `${p.toExponential(0)} Pa`;
  const fmtPpm = (x) => x >= 1e4 ? `${(x / 1e4).toPrecision(2)}%` : x >= 1 ? `${x.toPrecision(2)} ppm` : `${x.toFixed(2)} ppm`;
  ec.press = slider(atmCtl, { id: "e-p", label: "Pressure (log)", min: -6, max: 0.3, step: 0.05, value: 0, fmt: (v) => fmtPa(101325 * 10 ** v),
    hint: "1 atm = 101 kPa. How strongly gas molecules bounce iodine back to the film changes continuously with pressure", onInput: () => envSchedule() });
  ec.o2 = slider(atmCtl, { id: "e-o2", label: "Oxygen level (log)", min: -1, max: 6, step: 0.05, value: Math.log10(210000), fmt: (v) => fmtPpm(10 ** v),
    hint: "Air 21% = 210 000 ppm, glovebox < 1 ppm. Oxidation rate ∝ oxygen partial pressure (concentration × pressure)", onInput: () => envSchedule() });
  ec.h2o = slider(atmCtl, { id: "e-h2o", label: "Moisture (log)", min: -1, max: 4.5, step: 0.05, value: 0, fmt: (v) => fmtPpm(10 ** v),
    hint: "Glovebox moisture ppm → relative humidity at cell temperature (Buck saturation vapour pressure)", onInput: () => envSchedule() });
  ec.rh = slider(envHost2, { id: "e-rh", label: "Relative humidity", min: 0, max: 100, step: 1, value: 50, fmt: (v) => `${v}%`, hint: "for air", onInput: () => envSchedule() });
  ec.temp = slider(envHost2, { id: "e-t", label: "Cell temperature", min: -100, max: 120, step: 1, value: 25, fmt: (v) => `${v} °C`, hint: "Each degradation pathway extrapolated by Arrhenius with its own activation energy", onInput: () => envSchedule() });
  ec.suns = slider(envHost2, { id: "e-s", label: "Light", min: 0, max: 1.5, step: 0.05, value: 1, fmt: (v) => v === 0 ? "Dark" : `${v.toFixed(2)} sun`, hint: "Ground-level. For space, choose 'Space orbit' below and 1.36 sun etc. is computed", onInput: () => envSchedule() });
  quickGroups(ec.suns, [{ label: "Ground", list: [[1, "Clear midday 1.0"], [0.6, "Light clouds 0.6"], [0.2, "Cloudy 0.2"], [0, "Dark (storage)"]] }], () => envSchedule());
  ec.hours = slider(envHost2, { id: "e-h", label: "Test duration", min: 0, max: 5.4, step: 0.05, value: 3, fmt: (v) => fmtH(10 ** v), hint: "Up to about 29 years (module warranty level)", onInput: () => envSchedule() });
  ec.edge = slider(envHost2, { id: "e-w", label: "Edge seal width", min: 0.2, max: 3, step: 0.1, value: 1, fmt: (v) => `${(v * 10).toFixed(0)} mm`, hint: "IPVF: needs at least 1 cm to pass damp heat. Ingress time ∝ width²", onInput: () => envSchedule() });
  ec.r = slider(spaceCtl, { id: "e-r", label: "Distance from Sun", min: 0.9, max: 1.6, step: 0.01, value: 1, fmt: (v) => `${v.toFixed(2)} AU`, hint: "Earth 1, Mars 1.52 AU. Sunlight ∝ 1/r²", onInput: () => envSchedule() });
  ec.mc = slider(spaceCtl, { id: "e-mc", label: "Panel heat capacity (log)", min: 2.3, max: 4.5, step: 0.05, value: Math.log10(1500), fmt: (v) => `${(10 ** v).toFixed(0)} J/m²K`,
    hint: "Thin flexible panel ~500, glass-covered panel ~5000, body-mounted cell (SSPD-1) ~30000. Smaller cools faster in shade", onInput: () => envSchedule() });
  ec.att = slider(spaceCtl, { id: "e-att", label: "Sun pointing", min: 0.2, max: 1, step: 0.01, value: 1, fmt: (v) => `${(v * 100).toFixed(0)}%`,
    hint: "Wing panel facing the Sun: 100%. Body-mounted cells at an angle get less. 80% + heat capacity 30000 gives about −7–34 °C (SSPD-1 measured −25–35 °C)", onInput: () => envSchedule() });
  ec.eta = slider(spaceCtl, { id: "e-eta", label: "Fraction leaving as electricity", min: 0, max: 0.4, step: 0.01, value: 0.2, fmt: (v) => `${(v * 100).toFixed(0)}%`, hint: "The efficiency share does not become heat", onInput: () => envSchedule() });
  const GAS_NOTE = {
    air: "Air: 21% oxygen + humidity. Light plus oxygen gives oxidation, the fastest degradation pathway.",
    N2: "Nitrogen: an inert gas. At 1 atm, gas molecules bounce escaping iodine back into the film, so volatile loss is about 1/100 of vacuum.",
    Ar: "Argon: heavier and larger than nitrogen, so iodine diffuses a bit slower → about 15% stronger volatile suppression than nitrogen (gas kinetics).",
    He: "Helium: light and small, so iodine escapes easily → even at 1 atm volatile suppression is about 1/4 of nitrogen. No measurements; gas kinetics only.",
    CO2: "CO₂: heavy and strongly interacting, so it suppresses volatiles more than nitrogen. Chemical reactions with perovskite are not modelled.",
    vacuum: "Vacuum: no oxygen or moisture, but no gas to hold volatiles back, so light-driven iodine/organic loss is fastest (Ruess 2020).",
  };
  function envVis() {
    const vac = E.gas === "vacuum", air = E.gas === "air";
    ec.press.wrap.hidden = vac; ec.o2.wrap.hidden = vac || air; ec.h2o.wrap.hidden = vac || air; ec.rh.wrap.hidden = !air;
    ec.edge.wrap.hidden = E.enc !== "glass_glass_pib";
    const sp = E.orbit !== "none";
    spaceCtl.hidden = !sp; ec.r.wrap.hidden = E.orbit !== "deep";
    ec.temp.el.disabled = sp; ec.suns.el.disabled = sp;
  }
  segGroup($("env-gas"), "v", (v) => {
    E.gas = v;
    if (v !== "vacuum" && E.orbit !== "none") { E.orbit = "none"; setSeg($("env-orbit"), "none"); }
    if (v === "air") ec.o2.set(Math.log10(210000)); else if (ec.o2.get() > 4) ec.o2.set(0);
    envVis(); envSchedule();
  });
  segGroup($("env-enc"), "v", (v) => { E.enc = v; envVis(); envSchedule(); });
  segGroup($("env-cal"), "v", (v) => { E.cal = v; envSchedule(); });
  const Q_OPTS = { auto: "Auto (estimated from recipe)", "1": "Average 2014–2020 paper cell ×1", "0.3": "Good cell ×0.3", "0.05": "Certified-grade recent cell ×0.05" };
  const qSel = selectCtl($("env-q-host"), { id: "e-q", label: "Cell quality (speed of intrinsic ion/interface degradation)", options: Q_OPTS, value: "auto",
    hint: "Degradation that happens even in nitrogen. An average paper cell reaches 80% in about 330 h dark and 100 h at 1 sun", onChange: (v) => { E.q = v; envSchedule(); } });
  const envQ = () => E.q === "auto" ? P.qualityScale(F.r) : +E.q;
  segGroup($("env-orbit"), "v", (v) => {
    E.orbit = v;
    if (v !== "none") { E.gas = "vacuum"; setSeg($("env-gas"), "vacuum"); if (ec.hours.get() < 3.9) ec.hours.set(Math.log10(8766)); }
    envVis(); envSchedule();
  });
  // orbit physics: thermal-balance temperature, eclipse cooling, number of cycles, sunlight 1.361/r² sun, radiation
  function orbitState() {
    if (E.orbit === "none") return null;
    const r = E.orbit === "deep" ? ec.r.get() : 1, mc = 10 ** ec.mc.get(), eta = ec.eta.get();
    const att = ec.att.get();
    // sun pointing -> effective Sun distance r/√att (absorbed heat and light both scale by att)
    const th = PHX.orbitThermal({ orbit: E.orbit === "deep" ? "deep" : E.orbit, r: r / Math.sqrt(att), mc, eta });
    const o = P.ORBITS[E.orbit] || P.ORBITS.geo;
    // interplanetary: solar protons outside Earth's magnetosphere - GEO value (mostly solar origin) scaled by 1/r²
    const flux = E.orbit === "deep" ? P.ORBITS.geo.radiation_flux / (r * r) : o.radiation_flux;
    // time-averaged cell temperature: sunlit temperature (eclipse fraction LEO 37%, GEO 0.8%)
    return { th, r, suns: 1.361 * att / (r * r), temp_C: th.Tsun - 273.15, radiation_flux: flux, thermal_cycles_per_h: th.cyclesPerH, cycle_dT: th.dT };
  }
  const ENV_PRESETS = {
    "Lab air": { gas: "air", enc: "none", rh: 50, temp: 25, suns: 1, hours: 1000, note: "An unencapsulated cell left in the lab." },
    "Nitrogen glovebox": { gas: "N2", enc: "none", o2: 1, h2o: 1, temp: 25, suns: 1, hours: 2000, note: "A nitrogen-filled glovebox (O₂ and H₂O 1 ppm each)." },
    "Argon glovebox": { gas: "Ar", enc: "none", o2: 1, h2o: 1, temp: 25, suns: 1, hours: 2000, note: "Compare with nitrogen. Gas kinetics gives a slightly longer life." },
    "Low vacuum 100 Pa (extrapolated)": { gas: "N2", enc: "none", o2: 1, h2o: 1, p: 100, temp: 25, suns: 1, hours: 2000, note: "Between 1 atm and vacuum. Iodine's mean free path grows, so escape rises sharply." },
    "Damp heat 85/85": { gas: "air", enc: "glass_glass_pib", rh: 85, temp: 85, suns: 0, hours: 1000, note: "IEC 61215 test: 85 °C, 85% humidity, dark, 1000 h. Pass if loss is under 5%." },
    "Outdoor installation": { gas: "air", enc: "glass_glass_pib", rh: 60, temp: 45, suns: 1, hours: 20000, note: "Heated to 45 °C in daytime as on a rooftop (simplified as constant light)." },
    "Space LEO": { orbit: "leo", enc: "thin_film_ald", hours: 8766, note: "LEO for 1 year: vacuum, AM0 1.36 sun, radiation, 35 min eclipse every 95 min. Temperature from thermal balance." },
    "Space GEO": { orbit: "geo", enc: "thin_film_ald", hours: 8766, note: "GEO for 1 year: almost continuous sunlight, up to 72 min eclipse around the equinoxes." },
    "Mars orbit (extrapolated)": { orbit: "deep", r: 1.52, enc: "thin_film_ald", hours: 8766 * 2, note: "Sunlight 0.59 sun; panel temperature below freezing from thermal balance. Solar protons weaken as 1/r²." },
  };
  Object.entries(ENV_PRESETS).forEach(([name, p], i) => {
    const b = document.createElement("button"); b.className = "chip"; b.textContent = name; b.setAttribute("aria-pressed", i === 0);
    b.addEventListener("click", () => {
      $("env-presets").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      E.enc = p.enc; setSeg($("env-enc"), p.enc);
      E.orbit = p.orbit || "none"; setSeg($("env-orbit"), E.orbit);
      if (p.orbit) { E.gas = "vacuum"; if (p.r) ec.r.set(p.r); }
      else {
        E.gas = p.gas; ec.temp.set(p.temp); ec.suns.set(p.suns);
        if (p.rh != null) ec.rh.set(p.rh);
        ec.press.set(Math.log10((p.p ?? 101325) / 101325));
        ec.o2.set(Math.log10(p.gas === "air" ? 210000 : p.o2 ?? 1)); ec.h2o.set(Math.log10(p.h2o ?? 1));
      }
      setSeg($("env-gas"), E.gas);
      ec.hours.set(Math.log10(p.hours));
      $("env-preset-note").textContent = p.note;
      envVis(); envUpdate();
    });
    $("env-presets").appendChild(b);
  });
  $("env-preset-note").textContent = ENV_PRESETS["Lab air"].note;
  $("env-use-mapi").addEventListener("click", () => { E.compare = !E.compare; $("env-use-mapi").textContent = E.compare ? "Hide comparison" : "Compare: classic MAPbI3"; envUpdate(); });
  function envSchedule() { if (E.pending) return; E.pending = true; requestAnimationFrame(() => { E.pending = false; envUpdate(); }); }
  function envCond() {
    const orb = orbitState();
    const c = { gas: E.gas, pressure_Pa: E.gas === "vacuum" ? 0 : 101325 * 10 ** ec.press.get(), encapsulation: E.enc,
      edge_width_cm: E.enc === "glass_glass_pib" ? ec.edge.get() : undefined, hours: 10 ** ec.hours.get(),
      temp_C: ec.temp.get(), suns: ec.suns.get(), radiation_flux: 0, thermal_cycles_per_h: 0, cycle_dT: 0,
      calibration: E.cal, intrinsic_scale: envQ() };
    if (E.gas === "air") { c.o2_frac = 0.21; c.rh_pct = ec.rh.get(); }
    else if (E.gas !== "vacuum") { c.o2_frac = 10 ** ec.o2.get() * 1e-6; c.h2o_ppm = 10 ** ec.h2o.get(); }
    if (orb) {
      Object.assign(c, { temp_C: orb.temp_C, suns: orb.suns, radiation_flux: orb.radiation_flux, thermal_cycles_per_h: orb.thermal_cycles_per_h, cycle_dT: orb.cycle_dT });
      ec.temp.set(Math.round(orb.temp_C)); ec.suns.set(Math.min(10, +orb.suns.toFixed(2)));
    }
    return { c, orb };
  }
  function envUpdate() {
    if ($("bench-env").hidden) return;
    if (!F.cell) F.cell = P.buildCell(F.r);
    envVis();
    $("env-atm-note").textContent = GAS_NOTE[E.gas];
    qSel.wrap.hidden = E.cal !== "database";
    $("env-cal-note").textContent = E.cal === "database"
      ? `Finished-cell degradation rates fitted to about 1,550 measured T80 values from the Perovskite Database (11 groups: air/nitrogen · light/dark · temperature · encapsulation). Cross-validated error about 1.5×. Current cell quality factor ×${(+envQ()).toPrecision(2)}.`
      : "Rates exactly as measured in individual paper experiments on bare films or specific cells (Aristidou 2017, Ruess 2020, etc.). Much faster in air + light and much slower in nitrogen than real finished cells.";
    const { c: cond, orb } = envCond(), stack = F.cell.stack;
    $("env-cell-name").innerHTML = `Cell from the Cell lab: <b>${F.name}</b> · MA ${(stack.ma_frac * 100).toFixed(0)}%, ${P.HTLS[F.r.htl].name}, ${P.ELECTRODES[F.r.electrode].name}${F.r.barrier ? " + barrier" : ""}`;
    const r = P.simulateAging(stack, cond);
    const mapi = E.compare ? P.simulateAging(P.buildCell(P.PRESET_RECIPES["Classic MAPbI3 (n-i-p)"]).stack, cond) : null;
    const top = Object.entries(r.share).sort((a, b) => b[1] - a[1])[0];
    const fin = r.retention[r.retention.length - 1];
    const GASNAME = { air: "Air", N2: "Nitrogen", Ar: "Argon", He: "Helium", CO2: "CO₂", vacuum: "Vacuum" };
    kpis($("env-kpis"), [
      { k: "T80 (time to 80% efficiency)", v: fmtH(r.t80), cls: Number.isFinite(r.t80) ? (r.t80 < 1000 ? "bad" : r.t80 < 10000 ? "warn" : "good") : "good" },
      { k: "Retention at end", v: (fin * 100).toFixed(1), u: "%", s: "after " + fmtH(cond.hours) },
      { k: "Largest degradation pathway", v: top[1] > 0 ? top[0] : "—", s: top[1] > 0 ? `${(top[1] * 100).toFixed(0)}% of total damage` : "" },
      { k: "Atmosphere · encapsulation", v: GASNAME[E.gas] + (E.gas !== "vacuum" && Math.abs(r.atm.P - 101325) > 5000 ? ` ${fmtPa(r.atm.P)}` : ""), s: P.ENCAPSULATIONS[E.enc].label },
      ...(mapi ? [{ k: "Compare: classic MAPbI3 T80", v: fmtH(mapi.t80) }] : []),
    ]);
    const t0 = 0.1, t1 = Math.max(cond.hours, 1);
    const sel = (res) => { const xs = [], ys = []; res.t.forEach((t, i) => { if (t >= t0 * 0.999) { xs.push(t); ys.push(res.retention[i] * 100); } }); return [xs, ys]; };
    const [xa, ya] = sel(r);
    const series = [{ xs: xa, ys: ya, color: cssVar("--accent"), w: 2.4 }, { xs: [t0, t1], ys: [80, 80], color: cssVar("--muted"), w: 1, dash: "4 4" }];
    if (mapi) { const [xm, ym] = sel(mapi); series.push({ xs: xm, ys: ym, color: cssVar("--top"), w: 2, dash: "6 3" }); }
    const xfH = (v) => v >= 8766 ? `${(v / 8766).toFixed(v >= 87660 ? 0 : 1)} yr` : v >= 24 ? `${(v / 24).toFixed(0)} d` : `${v}h`;
    chart($("env-chart"), { x: [t0, t1], y: [0, 100], xlog: true, xgrid: true, xl: "Time (h)", yl: "Efficiency retention (%)", series,
      points: Number.isFinite(r.t80) && r.t80 >= t0 && r.t80 <= t1 ? [{ x: r.t80, y: 80, color: cssVar("--accent"), r: 4, label: `T80 ${fmtH(r.t80)}` }] : [], xf: xfH });
    $("env-legend").innerHTML = `<span style="--c:var(--accent)">${F.name}</span>${mapi ? `<span style="--c:var(--top)">Classic MAPbI3</span>` : ""}<span style="--c:var(--muted)">80% line</span>`;
    $("env-share").innerHTML = P.MECHS.map((m, i) => r.share[m] > 0.002 ? `<span title="${m} ${(r.share[m] * 100).toFixed(0)}%" style="width:${r.share[m] * 100}%;background:var(${MECH_COL[i]})"></span>` : "").join("");
    $("env-share-legend").innerHTML = P.MECHS.map((m, i) => r.share[m] > 0.002 ? `<span style="--c:var(${MECH_COL[i]})">${m} ${(r.share[m] * 100).toFixed(0)}%</span>` : "").join("") || `<span style="--c:var(--good)">Almost no damage</span>`;
    const xi = [], yi = []; r.t.forEach((t, i) => { if (t >= t0 * 0.999) { xi.push(t); yi.push(r.ingress[i] * 100); } });
    chart($("env-ingress"), { x: [t0, t1], y: [0, 100], xlog: true, xgrid: true, yl: "%", series: [{ xs: xi, ys: yi, color: cssVar("--mid"), w: 2, fill: true, opacity: 0.12 }], xf: xfH, ny: 4, margin: { b: 24 } });
    // Physics readout
    const TK = cond.temp_C + 273.15, mfp = E.gas === "vacuum" ? Infinity : PHX.meanFreePath(E.gas === "air" ? "air" : E.gas, TK, r.atm.P);
    const ph = [
      { k: "Volatile suppression (vs vacuum)", v: r.volSuppress != null ? (r.volSuppress < 0.01 ? r.volSuppress.toExponential(1) : r.volSuppress.toFixed(3)) : "—", s: "How much iodine is pushed back by the gas. 1 = vacuum" },
      { k: "Gas mean free path", v: !Number.isFinite(mfp) ? "∞" : mfp < 1e-6 ? (mfp * 1e9).toFixed(0) : mfp < 1e-3 ? (mfp * 1e6).toPrecision(2) : (mfp * 1e3).toPrecision(2), u: !Number.isFinite(mfp) ? "" : mfp < 1e-6 ? "nm" : mfp < 1e-3 ? "µm" : "mm", s: "Distance a molecule travels before a collision" },
      { k: "Oxygen partial pressure", v: r.atm.o2 > 0 ? (r.atm.o2 * 101.325 >= 0.1 ? (r.atm.o2 * 101.325).toPrecision(3) + " kPa" : (r.atm.o2 * 101325).toPrecision(2) + " Pa") : "0", s: "Oxidation rate ∝ this value" },
      { k: "Relative humidity at the cell", v: r.atm.rh < 1 ? r.atm.rh.toPrecision(2) : r.atm.rh.toFixed(0), u: "%", s: E.gas !== "air" && E.gas !== "vacuum" ? `${fmtPpm(10 ** ec.h2o.get())} at ${cond.temp_C.toFixed(0)} °C` : "" },
    ];
    if (orb) ph.push(
      { k: "Sun-side panel temperature", v: (orb.th.Tsun - 273.15).toFixed(0), u: "°C", s: "Absorbed = radiated + electrical power" },
      { k: "Temperature at end of eclipse", v: (orb.th.Tecl - 273.15).toFixed(0), u: "°C", s: orb.th.cyclesPerH > 0 ? `${(orb.th.cyclesPerH * 24).toPrecision(2)} times per day` : "No eclipse" },
      { k: "Sunlight", v: orb.suns.toFixed(2), u: "sun", s: `1.361 × pointing / r², r = ${orb.r.toFixed(2)} AU` });
    kpis($("env-phys"), ph);
    const ex = r.extrap.slice();
    if (orb && orb.th.dT > 150) ex.push(`Thermal cycle amplitude ${orb.th.dT.toFixed(0)} K: above the test standard (−40–85 °C, 125 K) — damage ∝ (ΔT/125)² (Coffin-Manson type) extrapolated`);
    $("env-vb").innerHTML = `<span class="vb ${ex.length ? "ext" : ""}">${ex.length ? "Extrapolated · physics" : "Within validated range"}</span>`;
    $("env-x").innerHTML = ex.length ? ex.map((x) => `<li class="x">${x}</li>`).join("") : `<li class="ok">All conditions are within the calibration data.</li>`;
  }

  // =====================================================================
  // Ions · hysteresis
  // =====================================================================
  const H = window.HYST || null;
  const IO = window.PerolabIonic;
  const ION_LABEL = { "298": "Python: default 25 °C", "273": "Python: 0 °C", "298_N0x0.1": "Python: ions 1/10", "298_N0x10": "Python: ions ×10" };
  const I = { src: "base", busy: false, worker: null, live: null, sweep: [], sweepKey: null };
  const ic = {}, ionHost = $("ion-ctl");
  const p2 = (x) => String(Number(x.toPrecision(2)));
  const rateFmt = (v) => { const r = 10 ** v; return r >= 1 ? `${p2(r)} V/s` : `${p2(r * 1000)} mV/s`; };
  const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  const sciTxt = (x) => { const e = Math.floor(Math.log10(x)); return `${(x / 10 ** e).toFixed(1)}×10${String(e).split("").map((c) => c === "-" ? "⁻" : SUP[+c]).join("")}`; };
  ic.N0 = slider(ionHost, { id: "i-n0", label: "Mobile ion (vacancy) density (log)", min: 17, max: 20, step: 0.05, value: Math.log10(1.6e19), fmt: (v) => sciTxt(10 ** v) + " cm⁻³", hint: "Default 1.6×10¹⁹. More ions means more charge piled at the interfaces", onInput: () => ionMark() });
  ic.Ea = slider(ionHost, { id: "i-ea", label: "Ion activation energy", min: 0.3, max: 0.8, step: 0.01, value: 0.58, fmt: (v) => `${v.toFixed(2)} eV`, hint: "D = D∞·exp(−Ea/kT). 0.1 eV difference → ion speed about 50×", onInput: () => ionMark() });
  ic.T = slider(ionHost, { id: "i-t", label: "Temperature", min: -20, max: 85, step: 1, value: 25, fmt: (v) => `${v} °C`, hint: "Enters ion diffusion, thermal voltage and intrinsic carrier density", onInput: () => ionMark() });
  ic.b = slider(ionHost, { id: "i-b", label: "Absorber thickness", min: 200, max: 1500, step: 10, value: 400, fmt: (v) => `${v} nm`, onInput: () => ionMark() });
  ic.light = slider(ionHost, { id: "i-l", label: "Light intensity (log)", min: -1, max: 0.15, step: 0.05, value: 0, fmt: (v) => `${(10 ** v).toPrecision(2)} sun`, onInput: () => ionMark() });
  ic.rate = slider(ionHost, { id: "i-rate", label: "Scan rate (log)", min: -2, max: 1.5, step: 0.05, value: -1, fmt: rateFmt, hint: "How fast the voltage is swept. The question is whether ions can keep up", onInput: () => ionMark() });
  ic.Vhi = slider(ionHost, { id: "i-vhi", label: "Scan start voltage", min: 1.0, max: 1.4, step: 0.05, value: 1.2, fmt: (v) => `${v.toFixed(2)} V`, onInput: () => ionMark() });
  ic.pre = slider(ionHost, { id: "i-pre", label: "Hold at start voltage", min: 0, max: 60, step: 1, value: 5, fmt: (v) => `${v} s`, hint: "Preconditioning: pushes ions to one side first", onInput: () => ionMark() });
  function ionFabMap() {
    if (!F.cell) F.cell = P.buildCell(F.r);
    const c = F.cell, D = IO.DEFAULTS, Q = 1.602176634e-19, h = P.HTLS[F.r.htl], e = P.ETLS[F.r.etl], pas = P.PASSIVATIONS[F.r.passivation];
    const dH = Math.max(1, 1 / h.plqy - 1 / 1.4e-2), dE = Math.max(1, (1 / e.plqy - 1 / 1.4e-2) * pas.iface);
    const b = c.thickness_nm * 1e-9, Ev = D.Ec - c.eg;
    return { Ev, EvH: Ev + 0.3, tn: c.tau_ns * 1e-9, tp: c.tau_ns * 1e-9,
      vpE: 10 * (dE / 2560) ** 0.7, vnH: 0.1 * (dH / 125) ** 0.7,
      Fph: Math.max(1e18, c.jsc * 10 / Q / (1 - Math.exp(-D.alpha * b))) };
  }
  function ionParams() {
    const p = { N0: 10 ** ic.N0.get() * 1e6, EAI: ic.Ea.get(), T: ic.T.get() + 273.15, b: ic.b.get() * 1e-9 };
    if (I.src === "fab") Object.assign(p, ionFabMap());
    return p;
  }
  const ionOpts = () => ({ Vhi: ic.Vhi.get(), precond: ic.pre.get(), light: 10 ** ic.light.get(), dV: 0.01 });
  function ionKey() { return JSON.stringify([ionParams(), ionOpts()]); }
  function ionExtrap() {
    const x = [], n0 = 10 ** ic.N0.get(), T = ic.T.get(), L = 10 ** ic.light.get(), r = 10 ** ic.rate.get();
    if (n0 < 1e17 || n0 > 1e20) x.push(`Ion density ${sci(n0)} cm⁻³: outside reported range (10¹⁷–10²⁰) — Debye length L_D = √(εkT/q²N₀) sets the interfacial ion-layer thickness`);
    if (ic.Ea.get() < 0.35 || ic.Ea.get() > 0.7) x.push(`Activation energy ${ic.Ea.get().toFixed(2)} eV: outside measured range (0.35–0.7 eV) — Arrhenius law as is`);
    if (T < 0 || T > 85) x.push(`${T} °C: outside 0–85 °C — ion diffusion follows Arrhenius; bandgap temperature shift is not in this ion model`);
    if (ic.b.get() < 250 || ic.b.get() > 1000) x.push(`Thickness ${ic.b.get()} nm: outside common range (250–1000 nm) — same equations, grid re-divided`);
    if (L < 0.1 || L > 2) x.push(`Light ${L.toPrecision(2)} sun: generation scales with intensity (heating ignored)`);
    if (r < 0.01 || r > 10) x.push(`Scan ${rateFmt(ic.rate.get())}: outside typical range (10 mV/s–10 V/s)`);
    if (I.src === "fab") x.push("Cell-lab cell: bandgap, lifetime, interface recombination and photogeneration taken from the fabrication model (transport-layer energy offsets assumed 0.3 eV as in the default cell)");
    return x;
  }
  function ionMark() {
    const x = ionExtrap();
    $("ion-vb").innerHTML = `<span class="vb ${x.length ? "ext" : ""}">${x.length ? "Extrapolated · physics" : "Within validated range"}</span>`;
    $("ion-x").innerHTML = x.length ? x.map((t) => `<li class="x">${t}</li>`).join("") : `<li class="ok">Near the IonMonger defaults — same range as the Python results.</li>`;
    if (!I.busy) $("ion-status").textContent = I.live && I.live.key !== ionKey() ? "Conditions changed. Press 'Run at this rate' to solve again." : $("ion-status").textContent;
  }
  segGroup($("ion-src"), "v", (v) => {
    I.src = v;
    if (v === "fab") {
      if (!F.cell) F.cell = P.buildCell(F.r);
      ic.N0.set(Math.log10(F.cell.ionN0)); ic.Ea.set(+F.cell.ionEa.toFixed(2)); ic.b.set(Math.round(F.cell.thickness_nm / 10) * 10);
      const m = ionFabMap();
      $("ion-src-note").textContent = `${F.name}: bandgap ${F.cell.eg.toFixed(2)} eV, lifetime ${F.cell.tau_ns.toFixed(0)} ns, ETL interface hole recombination velocity ${m.vpE.toPrecision(2)} m/s, HTL interface ${m.vnH.toPrecision(2)} m/s, thickness ${F.cell.thickness_nm} nm`;
    } else {
      ic.N0.set(Math.log10(1.6e19)); ic.Ea.set(0.58); ic.b.set(400);
      $("ion-src-note").textContent = "IonMonger default cell (MAPbI3, TiO2/Spiro type): 400 nm, ions 1.6×10¹⁹ cm⁻³, Ea 0.58 eV.";
    }
    ionMark();
  });
  $("ion-src-note").textContent = "IonMonger default cell (MAPbI3, TiO2/Spiro type): 400 nm, ions 1.6×10¹⁹ cm⁻³, Ea 0.58 eV.";
  // ---- computation (Web Worker) ----
  const slimRun = (r) => ({ rev: r.rev, fwd: r.fwd, a: r.a, b: r.b, HI: r.HI, tauIon: r.tauIon, path: r.startPath,
    prof: { x: r.profile0V.x, reg: r.profile0V.reg, P: r.profile0V.P, phi: r.profile0V.phi } });
  function makeWorker() {
    if (!window.Worker || !window.IONIC_SRC) return null;
    const src = window.IONIC_SRC + `
;self.onmessage = function (e) {
  var d = e.data;
  for (var k = 0; k < d.rates.length; k++) {
    try {
      var r = self.PerolabIonic.hysteresisRun(d.params, d.rates[k], d.opts, function (f, m) { self.postMessage({ type: "prog", f: (k + f) / d.rates.length, msg: m, k: k }); });
      self.postMessage({ type: "one", k: k, rate: d.rates[k], res: { rev: r.rev, fwd: r.fwd, a: r.a, b: r.b, HI: r.HI, tauIon: r.tauIon, path: r.startPath,
        prof: { x: r.profile0V.x, reg: r.profile0V.reg, P: r.profile0V.P, phi: r.profile0V.phi } } });
    } catch (err) { self.postMessage({ type: "fail", k: k, rate: d.rates[k], msg: String(err && err.message || err) }); }
  }
  self.postMessage({ type: "done" });
};`;
    try { return new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" }))); } catch (e) { return null; }
  }
  function ionBusy(on, msg) {
    I.busy = on; $("ion-run").disabled = on; $("ion-sweep").disabled = on; $("ion-stop").hidden = !on;
    if (msg != null) $("ion-status").textContent = msg;
    if (!on) $("ion-bar").style.width = "0";
  }
  function ionStart(rates, sweep) {
    const params = ionParams(), opts = ionOpts(), key = ionKey(), t0 = performance.now(); let fails = 0, oks = 0;
    if (sweep) { I.sweep = []; I.sweepKey = key; }
    ionBusy(true, "Starting…");
    const onMsg = (m) => {
      if (m.type === "prog") { $("ion-bar").style.width = `${(m.f * 100).toFixed(1)}%`; $("ion-status").textContent = `${rates.length > 1 ? `${m.k + 1}/${rates.length} · ` : ""}${m.msg} · ${((performance.now() - t0) / 1000).toFixed(0)} s`; }
      else if (m.type === "one") { oks++;
        const res = Object.assign({ rate: m.rate, key, params, opts }, m.res);
        if (sweep) { I.sweep.push(res); I.sweep.sort((a, b) => a.rate - b.rate); }
        if (!sweep || Math.abs(Math.log10(m.rate) - ic.rate.get()) < 0.26 || !I.live || I.live.key !== key) I.live = res;
        ionUpdate();
      } else if (m.type === "fail") { fails++; }
      else if (m.type === "done") {
        ionBusy(false, fails ? `${oks} succeeded, ${fails} failed to converge (the numerical solution diverged — for extreme conditions try a slightly different start voltage or thickness) · ${((performance.now() - t0) / 1000).toFixed(1)} s`
          : `Done · ${((performance.now() - t0) / 1000).toFixed(1)} s elapsed`);
        ionUpdate();
      }
    };
    if (!I.worker) I.worker = makeWorker();
    if (I.worker) { I.worker.onmessage = (e) => onMsg(e.data); I.worker.postMessage({ params, opts, rates }); }
    else {
      // environments without Workers: run on the main thread (the page freezes briefly)
      let k = 0;
      const next = () => {
        if (k >= rates.length) return onMsg({ type: "done" });
        try { const r = IO.hysteresisRun(params, rates[k], opts); onMsg({ type: "one", k, rate: rates[k], res: slimRun(r) }); }
        catch (err) { onMsg({ type: "fail", k, rate: rates[k], msg: String(err.message || err) }); }
        k++; onMsg({ type: "prog", f: k / rates.length, msg: "Computing", k: Math.min(k, rates.length - 1) }); setTimeout(next, 30);
      };
      setTimeout(next, 30);
    }
  }
  $("ion-run").addEventListener("click", () => ionStart([10 ** ic.rate.get()], false));
  $("ion-sweep").addEventListener("click", () => {
    // pick 7 rates around the largest hysteresis from the ion time constant τ (slower side when τ is long)
    let tau = 58;
    try { tau = new IO.IonicSolver(ionParams(), 0).tauIon(); } catch (e) {}
    const rc = Math.min(10, Math.max(0.03, 0.3 * 58 / tau));
    const rates = [-1.5, -1, -0.5, 0, 0.5, 1, 1.5].map((e) => Math.min(30, Math.max(0.01, rc * 10 ** e)));
    ionStart([...new Set(rates.map((r) => +r.toPrecision(3)))], true);
  });
  $("ion-stop").addEventListener("click", () => { if (I.worker) { I.worker.terminate(); I.worker = null; } ionBusy(false, "Stopped."); });
  function ionUpdate() {
    if ($("bench-ion").hidden) return;
    ionMark();
    const base = H && H.runs["298"] && H.runs["298"].length ? H.runs["298"] : null;
    let row, src;
    if (I.live) { row = I.live; src = "live"; }
    else if (base) { const b = base.reduce((a, x) => Math.abs(Math.log10(x.rate) + 1) < Math.abs(Math.log10(a.rate) + 1) ? x : a, base[0]); row = { rate: b.rate, HI: b.HI, a: b.rev, b: b.fwd, rev: b.curve_rev, fwd: b.curve_fwd, tauIon: 58 }; src = "py"; }
    if (!row) { $("ion-kpis").innerHTML = `<div class="kpi"><div class="k">No results yet</div><div class="s">Press 'Run at this rate'.</div></div>`; return; }
    const fmtTau = (t) => t >= 3600 ? `${(t / 3600).toPrecision(2)} h` : t >= 1 ? `${t.toPrecision(2)} s` : `${(t * 1000).toPrecision(2)} ms`;
    kpis($("ion-kpis"), [
      { k: "Hysteresis index HI", v: row.HI.toFixed(3), cls: row.HI > 0.2 ? "bad" : row.HI > 0.05 ? "warn" : "good", s: `${rateFmt(Math.log10(row.rate))}${src === "py" ? " · Python precomputed" : ""}` },
      { k: "Reverse PCE", v: fmt(row.a.pce, 1), u: "%", s: `Voc ${row.a.voc.toFixed(3)} V, FF ${(row.a.ff * 100).toFixed(0)}%` },
      { k: "Forward PCE", v: fmt(row.b.pce, 1), u: "%", s: `Voc ${row.b.voc.toFixed(3)} V, FF ${(row.b.ff * 100).toFixed(0)}%` },
      { k: "Ion time constant τ", v: fmtTau(row.tauIon), s: "τ = b·L_D / D_I. Hysteresis peaks when the scan time is close to τ" },
    ]);
    const vmax = src === "live" ? row.opts.Vhi : 1.2, jmax = Math.max(5, ...row.rev[1], ...row.fwd[1]);
    $("ion-jv-note").textContent = src === "live" ? `${vmax.toFixed(2)} V for ${row.opts.precond} s hold → reverse → forward` : "Python precomputed (default cell, 100 mV/s)";
    chart($("ion-jv"), { x: [0, vmax], y: [0, Math.ceil(jmax * 1.1)], xl: "Voltage (V)", yl: "Current density (mA/cm²)",
      series: [{ xs: row.rev[0], ys: row.rev[1], color: cssVar("--accent"), w: 2.4 }, { xs: row.fwd[0], ys: row.fwd[1], color: cssVar("--top"), w: 2.4, dash: "6 3" }], xf: (v) => v.toFixed(1) });
    // HI-Rate
    const series = [], pts = [];
    if (H) for (const k of Object.keys(H.runs)) if (H.runs[k].length) series.push({ xs: H.runs[k].map((x) => x.rate * 1000), ys: H.runs[k].map((x) => x.HI), color: cssVar("--muted"), w: k === "298" ? 1.6 : 1, dash: k === "298" ? null : "3 3" });
    const sw = I.sweep.filter((x) => x.key === I.sweepKey);
    if (sw.length) { series.push({ xs: sw.map((x) => x.rate * 1000), ys: sw.map((x) => x.HI), color: cssVar("--accent"), w: 2.6 }); sw.forEach((x) => pts.push({ x: x.rate * 1000, y: x.HI, color: cssVar("--accent"), r: 4 })); }
    if (src === "live") pts.push({ x: row.rate * 1000, y: row.HI, color: cssVar("--top"), r: 6 });
    const allR = [...(H ? H.rates : []), ...sw.map((x) => x.rate), row.rate], allH = [...series.flatMap((s) => s.ys), row.HI];
    chart($("ion-hi"), { x: [Math.min(...allR) * 1000 / 1.5, Math.max(...allR) * 1000 * 1.5], y: [Math.min(0, ...allH), Math.max(0.1, Math.ceil(Math.max(...allH) * 10) / 10)],
      xlog: true, xgrid: true, xl: "Scan rate (mV/s)", yl: "HI", series, points: pts, yf: (v) => v.toFixed(1), xf: (v) => v >= 1000 ? `${v / 1000}k` : String(v) });
    $("ion-legend").innerHTML = `<span style="--c:var(--muted)">Python precomputed (default · 0 °C · ions 1/10 · ×10)</span>${sw.length ? `<span style="--c:var(--accent)">Browser sweep</span>` : ""}${src === "live" ? `<span style="--c:var(--top)">Current run</span>` : ""}`;
    // ion distribution
    if (row.prof) {
      const xs = [], ys = [], N0 = row.params.N0;
      row.prof.x.forEach((x, i) => { if (row.prof.reg[i] === 1) { xs.push(x); ys.push(Math.log10(Math.max(row.prof.P[i] / N0, 1e-6))); } });
      chart($("ion-prof"), { x: [xs[0], xs[xs.length - 1]], y: [Math.max(-6, Math.floor(Math.min(...ys))), Math.max(1, Math.ceil(Math.max(...ys)))], xl: "Position in film (nm) · left ETL side, right HTL side", yl: "log₁₀(vacancy/mean)",
        series: [{ xs, ys, color: cssVar("--mid"), w: 2.2, fill: true, base: 0, opacity: 0.15 }, { xs: [xs[0], xs[xs.length - 1]], ys: [0, 0], color: cssVar("--muted"), w: 1, dash: "4 4" }], ny: 4, margin: { b: 30 } });
    } else $("ion-prof").innerHTML = `<text x="320" y="100" text-anchor="middle">Run in the browser to see the ion distribution</text>`;
  }

  // =====================================================================
  // extended backtest table
  // =====================================================================
  const BT2 = window.BACKTEST2 || [];
  $("bt2-score").textContent = BT2.length ? `${BT2.filter((r) => r.ok).length}/${BT2.length} passed` : "Not run";
  $("bt2-table").innerHTML = `<thead><tr><th>Area</th><th>Kind</th><th>Item</th><th class="num">Model</th><th>Reference</th><th></th></tr></thead><tbody>` +
    BT2.map((r) => `<tr><td><span class="badge">${r.area}</span></td><td><span class="badge" style="${r.kind === "predicted" ? "color:var(--accent);border-color:var(--accent)" : ""}">${r.kind}</span></td><td>${r.name}</td><td class="num mono">${(+r.value).toPrecision(3)}${r.unit || ""}</td><td class="hint">${r.ref}<br>Tolerance ${r.lo}~${r.hi}</td><td class="${r.ok ? "ok" : ""}" style="${r.ok ? "" : "color:var(--bad);font-weight:600"}">${r.ok ? "Pass" : "Fail"}</td></tr>`).join("") + "</tbody>";

  const BT3 = window.BACKTEST3 || [];
  $("bt3-score").textContent = BT3.length ? `${BT3.filter((r) => r.ok).length}/${BT3.length} passed` : "Not run";
  $("bt3-table").innerHTML = `<thead><tr><th>Area</th><th>Item</th><th class="num">Model</th><th>Reference · basis</th><th></th></tr></thead><tbody>` +
    BT3.map((r) => `<tr><td><span class="badge">${r.area}</span></td><td>${r.name}</td><td class="num mono">${r.value}</td><td class="hint">${r.ref}</td><td class="${r.ok ? "ok" : ""}" style="${r.ok ? "" : "color:var(--bad);font-weight:600"}">${r.ok ? "Pass" : "Fail"}</td></tr>`).join("") + "</tbody>";

  const BT4 = window.BACKTEST4 || [];
  if ($("bt4-table")) {
    const sc = BT4.filter((r) => r.kind !== "limit");
    $("bt4-score").textContent = BT4.length ? `${sc.filter((r) => r.ok).length}/${sc.length} passed` : "Not run";
    $("bt4-table").innerHTML = `<thead><tr><th>Area</th><th>Kind</th><th>Item</th><th class="num">Result</th><th>Reference</th><th></th></tr></thead><tbody>` +
      BT4.map((r) => `<tr><td><span class="badge">${r.area}</span></td><td><span class="badge" style="${r.kind === "predicted" ? "color:var(--accent);border-color:var(--accent)" : r.kind === "limit" ? "color:var(--warn);border-color:var(--warn)" : ""}">${r.kind}</span></td><td>${r.name}</td><td class="num mono">${r.value}</td><td class="hint">${r.ref}</td><td class="${r.ok ? "ok" : ""}" style="${r.ok ? "" : r.kind === "limit" ? "color:var(--warn);font-weight:600" : "color:var(--bad);font-weight:600"}">${r.ok ? "Pass" : r.kind === "limit" ? "Limit" : "Fail"}</td></tr>`).join("") + "</tbody>";
  }

  // ---------- Start ----------
  resetSim(true);
  fabUpdate();
  if (byHash[hash]) showTab($(byHash[hash]));
  // redraw when the theme changes
  const redraw = () => { drawPL(); cellUpdate(); compUpdate(); envUpdate(); ionUpdate(); };
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
  requestAnimationFrame(loop);
})();
