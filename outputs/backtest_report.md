# Backtest result: 20/20 passed

| Area | Check | Model | Allowed range | Reference (paper, record) | Result |
|---|---|---|---|---|---|
| Light | AM1.5G total power | 1000.377 W/m² | 990~1010 | ASTM G-173: 1000 W/m² | ✅ |
| Light | AM0 total power | 1347.656 W/m² | 1330~1370 | G-173 extraterrestrial 1348 / ASTM E-490 1366 W/m² | ✅ |
| Material | MAPb(I,Br)3 vs Noh 2013 max error | 0.000 eV | 0~0.005 | Noh et al. Nano Lett. 2013 | ✅ |
| Material | Pb0.5Sn0.5 band gap | 1.250 eV | 1.22~1.28 | standard all-perovskite bottom cell ~1.25 eV | ✅ |
| Material | FA-Cs Br 40% band gap | 1.771 eV | 1.72~1.8 | I:Br=60:40 → ~1.75 eV (Fraunhofer 2025) | ✅ |
| Device | SQ limit @1.34 eV | 33.680% | 33.4~34.0 | Rühle 2016: 33.7% | ✅ |
| Device | SQ optimum band gap | 1.335 eV | 1.32~1.36 | 1.34 eV | ✅ |
| Device | 2T 2-junction max efficiency (free gaps) | 45.693% | 45.0~46.5 | detailed-balance literature ~45.7% (≈1.63/0.96 eV) | ✅ |
| Device | All-perovskite 2J limit (bottom 1.25 eV) | 42.672% | 41.5~44.5 | literature ~43-44% | ✅ |
| Device | Single 1.55 eV (ERE 1e-3) efficiency | 25.426% | 24.5~28.0 | certified record ~26-27% | ✅ |
| Device | Single 1.55 eV Voc | 1.078 V | 1.05~1.22 | record cells 1.15-1.20 V | ✅ |
| Device | All-perovskite 2J efficiency (no segregation) | 32.405% | 28.0~34.0 | record 30.3% (CAS) - extra losses not in model | ✅ |
| Segregation | Br 10%: PL shift (should not occur) | -0.218 meV | -10~10 | Hoke 2015: stable for x<0.2 | ✅ |
| Segregation | Br 40%: PL shift (should occur) | 156.610 meV | 50~250 | experiments ~80-200 meV red shift | ✅ |
| Segregation | Br 60%: PL shift (should occur) | 295.957 meV | 50~300 | Hoke 2015: 1.88->~1.68 eV | ✅ |
| Segregation | Br 40%: I-rich domain composition | 0.112 | 0.05~0.25 | I-rich phase near x≈0.2 | ✅ |
| Segregation | 1.77 eV cell Voc loss | 102.251 mV | 30~200 | reported tens to 150 mV | ✅ |
| Segregation | segregation left after 30 min dark (std) | 0.000 | 0~0.01 | experiment: reversible recovery in the dark | ✅ |
| Segregation | segregation after 30 min dark at -100°C (std) | 0.118 | 0.08~1 | ions frozen at low temperature, recovery stops | ✅ |
| Segregation | PL shift at 0.1 sun smaller than at 1 sun | 1.000 | 1~1 | intensity dependence (threshold intensity exists) | ✅ |
