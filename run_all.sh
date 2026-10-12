#!/usr/bin/env bash
# validation + experiments 01-08 (about 6-8 min). 09 (hysteresis) and hysteresis_sweep.py take long, run them separately
set -e
cd "$(dirname "$0")"
python validation/backtest.py
python validation/backtest_extended.py
for f in examples/0[1-8]*.py; do
  echo; echo "=== $f ==="
  python "$f"
done
echo; echo "Done: see the outputs/ folder."
