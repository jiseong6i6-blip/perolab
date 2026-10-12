# Checking the model against measured data (Perovskite Database Project)

Source: T. J. Jacobsson *et al.*, "An open-access database and analysis tool for perovskite solar cells based on the FAIR data principles", *Nature Energy* **7**, 107–115 (2022), [doi:10.1038/s41560-021-00941-3](https://doi.org/10.1038/s41560-021-00941-3). Data archive on Zenodo: [doi:10.5281/zenodo.5834698](https://doi.org/10.5281/zenodo.5834698), CC BY 4.0.

The analysis uses the latest NOMAD release (downloaded with `fetch_perovskite_db.py`: 51,659 cells from papers published 2009–2026). Put it at `data/raw/nomad/perovskite_db.csv` and the scripts use it automatically; otherwise they fall back to the 2022 Zenodo archive at `data/raw/Perovskite_database_content_all_data.csv`. The raw CSVs (about 160 MB) are not included in this repository because of their size.

| File | What it does |
|---|---|
| `fetch_perovskite_db.py` | Downloads the latest release from the NOMAD API as a CSV |
| `pdbtools.py` | Raw table -> lab recipe fields (composition, HTL, ETL, quench, anneal, efficiency, stability conditions) -> `pdb_clean.csv` |
| `build_lookup.py` | Efficiency distributions of similar real cells -> `web/realcells.json` (the "compare with real cells" panel) |
| `contrasts.py` | Efficiency ratio when one recipe item changes, measured vs model, within the same year / architecture / composition stratum. Run with `Q=0.5` (medians) and `Q=0.9` (top 10%) |
| `stab_compare.py`, `stab_fit.py` | Degradation model vs ~1,550 measured T80 values; fits the finished-cell calibration constants (with cross-validation) |
| `backtest_data.py` | Collects the results above into `outputs/backtest_data.json` (the web lab's Validation tab) |
| `eg_check.py`, `voc_check.py` | Band gap (directly measured values only) and Voc-vs-band-gap comparisons |
| `jsmodel.js` | Runs the browser model from Node so the scripts can compare it with the data |

Run order: `pdbtools.py` (via the other scripts) -> `build_lookup.py`, `Q=0.5 python contrasts.py`, `Q=0.9 python contrasts.py`, `stab_fit.py` -> `backtest_data.py`.

Model constants changed because of this data:
- Coverage without quenching 0.78 -> 0.88 (measured efficiency ratio 0.83–0.92)
- Shunt-resistance floor of 30 Ω·cm²
- Extra Voc loss of 0.3 V/eV for band gaps above 1.75 eV
- Finished-cell degradation: oxygen + light ×0.020, moisture ×0.30, thermal ×0.45, plus an intrinsic channel (dark 25 °C T80 ≈ 334 h, 3.4x faster at 1 sun). This applies only in the "real data" calibration mode; the "individual paper experiments" mode keeps the original rates.
