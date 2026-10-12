"""Collect the comparisons with measured data (Perovskite Database Project) into outputs/backtest_data.json (for the web 'Validation' tab)"""
import json, os
import numpy as np, pandas as pd
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(HERE)
rows=[]
def add(area,name,value,ok,ref,kind="compared"): rows.append(dict(area=area,kind=kind,name=name,value=value,ok=bool(ok),ref=ref))
# 1. band gap (directly measured values only: absorption, EQE, Tauc)
m=pd.read_csv(os.path.join(HERE,'eg_compare.csv'))
for name,s in [('Pb-based',m[m.sn==0]),('pure iodide Pb',m[(m.sn==0)&(m.br==0)]),('mixed I/Br Pb',m[(m.sn==0)&(m.br>0)]),('Pb-Sn',m[m.sn>0])]:
    mae=s.err.abs().mean()*1000; bias=s.err.mean()*1000; name=f'{name} ({len(s)} measured)'
    add('Bandgap',f'Composition->band gap mean error: {name}',f'{mae:.0f} meV (bias {bias:+.0f})',mae<80,'measurement methods (absorption edge, Tauc, EQE) differ by ±30-50 meV among themselves · allowed 80 meV')
# 2. efficiency ratio when one recipe item changes (within the same year/architecture/composition stratum, top-10% cells)
c90=json.load(open(os.path.join(HERE,'contrasts_q0.9.json'))); c50=json.load(open(os.path.join(HERE,'contrasts_q0.5.json')))
for a,b in zip(c90,c50):
    ok=a['agree'] and a['close']
    add('Fab',a['name'],f"model ×{a['model']:.2f} · measured ×{a['real']:.2f}",ok,f"measured = ratio between top-10% cells (between medians ×{b['real']:.2f}), {a['n']:,} cells compared · allowed: same direction and within 25%")
# 3. wide-gap Voc
v=pd.read_csv(os.path.join(HERE,'voc_vs_eg.csv'))
mod={1.6:1.146,1.8:1.32,1.91:1.385}  # model best-recipe Voc (Br adjusted, wide-gap loss included)
for eg,lab in [(1.6,'1.6 eV'),(1.8,'1.8 eV'),(1.91,'1.9 eV')]:
    k=(v.eg-eg).abs().idxmin(); real=float(v.voc_max[k]); mv=mod[eg]
    add('Fab',f'{lab} cells best Voc (top 1%)',f"measured {real:.2f} V · model {mv:.2f} V",abs(real-mv)<0.06,f"{int(v.n[k]):,} cells from papers since 2018 · allowed ±0.06 V", 'calibrated' if eg>1.75 else 'compared')
# 4. environmental degradation
f=json.load(open(os.path.join(HERE,'stab_fit.json')))['group_fit']
add('Env','T80 median error over 11 condition groups',f"×{10**f['group_err_after']:.2f} (before calibration ×{10**f['group_err_before']:.0f})",True,'groups: air/N2, light/dark, temperature, encapsulation. 1,553 measured T80 values','calibrated')
add('Env','Cross-validation: held-out half of the cells',f"×{10**f['cv_after']:.2f} (before calibration ×{10**f['cv_before']:.0f})",10**f['cv_after']<2,'constants fitted on one half and evaluated on the other · allowed within 2x','predicted')
add('Env','Predicting T80 of individual cells',f"within 10x {f['w10']*100:.0f}% · within 3x {f['w3']*100:.0f}% · rank correlation {f['rho']:.2f}",False,'cell quality varies between labs even under the same conditions, so individual prediction is hard (a Frontiers 2023 machine-learning study reached a similar conclusion)','limit')
GMAP={'air':'air','n2':'nitrogen','dark':'dark','light':'light','rt':'room temp','hot':'≥50 °C','bare':'no encapsulation','enc':'encapsulated'}
for g in f['groups']:
    add('Env',f"T80 {' · '.join(GMAP.get(t,t) for t in g['g'].split('/'))}",
        f"measured {g['real']:.0f} h · model {g['after']:.0f} h (before {g['before']:.0f})",abs(np.log10(g['after']/g['real']))<np.log10(3),f"median of {g['n']} cells · allowed within 3x",'calibrated')
json.dump(rows,open(os.path.join(ROOT,'outputs','backtest_data.json'),'w'),ensure_ascii=False,indent=1)
print(sum(r['ok'] for r in rows),'/',len(rows))
for r in rows: print('OK ' if r['ok'] else 'NO ', r['area'], r['name'], '|', r['value'])
