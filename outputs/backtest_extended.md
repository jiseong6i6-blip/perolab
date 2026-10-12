# Extended backtest: 31/32 passed (predicted 24/25)

| Area | Kind | Check | Model | Allowed | Reference | Result |
|---|---|---|---|---|---|---|
| Fab | predicted | Tolerance factor MAPbI3 | 0.9115 | 0.9~0.92 | literature 0.91 | ✅ |
| Fab | predicted | Tolerance factor FAPbI3 | 0.9866 | 0.97~1.01 | literature ~0.99 (δ-phase edge) | ✅ |
| Fab | predicted | Tolerance factor CsPbI3 | 0.851 | 0.8~0.87 | literature 0.81-0.85 (δ phase at room temperature) | ✅ |
| Fab | predicted | Triple-cation PTAA/C60 p-i-n Voc | 1.118 V | 1.1~1.18 | Stolterfoht EES 2019: 1.14 V | ✅ |
| Fab | predicted | Same cell with LiF/C60: Voc | 1.146 V | 1.13~1.21 | same paper: 1.17 V | ✅ |
| Fab | predicted | Voc gain from LiF interlayer | 28.04 mV | 10~50 | same paper: about +30 mV | ✅ |
| Fab | calibrated | Pb-Sn lifetime SnF2 0% | 4.839 ns | 3~30 | TRMC ~10 ns | ✅ |
| Fab | calibrated | Pb-Sn lifetime SnF2 10% | 145.7 ns | 50~400 | TRMC ~130 ns | ✅ |
| Fab | predicted | MAPbI3 150 °C 30 min decomposed fraction | 0.9955 | 0.5~1.0 | Eperon: MA films discolour within ~30 min at 150 °C | ✅ |
| Fab | predicted | FA-Cs 150 °C 30 min decomposed fraction | 0.0004544 | 0.0~0.05 | FAPbI3-based films withstand 150 °C | ✅ |
| Fab | predicted | Record p-i-n 1.63 eV efficiency | 22.99% | 21~26.5 | certified record ~26-27% (small cells) | ✅ |
| Env | calibrated | MAPbI3 dry air + light 4 h retention | 0.1917 | 0.12~0.3 | Aristidou 2017: 80% loss | ✅ |
| Env | predicted | MAI-treated cell 2.5 h retention | 0.8564 | 0.8~0.95 | same paper: 10% loss | ✅ |
| Env | calibrated | Bare MAPbI3 vacuum + light 30 min | 0.6 | 0.5~0.7 | Ruess 2020: 40% iodine loss | ✅ |
| Env | predicted | Bare MAPbI3 N2 + light 300 min | 0.9498 | 0.93~1.0 | same paper: no change | ✅ |
| Env | calibrated | MAPbI3 N2 dark 85 °C T80 | 35.36 h | 25~50 | Abdelmageed: decomposition starts after a day | ✅ |
| Env | predicted | MAPbI3 N2 dark 75 °C 3-day retention | 0.8921 | 0.85~1.0 | same study: no change at 75 °C | ✅ |
| Env | predicted | MAPbI3 N2 dark 95 °C 2-day retention | 0.3246 | 0.0~0.5 | same study: full decomposition at 95 °C | ✅ |
| Env | predicted | FA-Cs glass-encapsulated 85/85 1000 h | 0.9509 | 0.95~1.0 | cells passing IEC 61215 (Shi 2020, Microquanta) | ✅ |
| Env | predicted | Same cell unencapsulated T80 | 6.219 h | 0~100 | unencapsulated cells do not survive damp heat | ✅ |
| Env | predicted | No Ag barrier, 85/85 1000 h | 0.8553 | 0.7~0.94 | Cheacharoen 2018: yellowing near the metal | ✅ |
| Env | calibrated | Spiro (Li-TFSI+tBP) 85 °C T80 | 143.7 h | 80~200 | Song et al.: sharp drop within 200 h | ✅ |
| Env | calibrated | Radiation 1e14 p/cm² retention | 0.8902 | 0.86~0.92 | 10 MeV test: 89% | ✅ |
| Env | predicted | Radiation 1e13 p/cm² retention | 0.98 | 0.96~1.0 | same test: 98% | ✅ |
| Env | predicted | LEO satellite data (SSPD-1) ~100-day retention | 0.9634 | 0.7~0.9 | Caltech SSPD-1: about 80% - cover-glass yellowing and pre-launch exposure not in model | ❌ |
| Ion | predicted | Short-circuit current = q·Φ·(1-e^-αb) | 1 | 0.98~1.01 | analytic 22.30 mA/cm² | ✅ |
| Ion | predicted | Scan rate of maximum hysteresis (298 K) | 300 mV/s | 30~1000 | Soton JAP 2020: 'hundreds of mV/s', simulation ~320 mV/s | ✅ |
| Ion | predicted | Very slow scan (3 mV/s) HI | 0.02082 | 0~0.05 | ions keep up, almost no hysteresis | ✅ |
| Ion | predicted | Very fast scan HI | 0.001173 | -0.02~0.05 | ions cannot move, hysteresis disappears | ✅ |
| Ion | predicted | Peak-rate shift on cooling (273/298) | 0.1 | 0.0~0.99 | same paper: cooling moves it towards ~100 mV/s | ✅ |
| Ion | predicted | 1/10 ions -> peak-rate shift (ratio) | 0.1 | 0.0~0.99 | ion time constant τ ∝ b·L_D/D, L_D ∝ N0^-1/2 -> fewer ions shift it slower | ✅ |
| Ion | predicted | 10x ions -> peak-rate shift (ratio) | 10 | 1.01~100 | for the same reason more ions shift it faster | ✅ |
