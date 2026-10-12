"""Measured contrasts: how much efficiency changes when only one recipe item changes (compared within the same architecture/composition stratum) vs the model"""
import json, subprocess, os
import numpy as np, pandas as pd
HERE=os.path.dirname(os.path.abspath(__file__))
d=pd.read_csv(os.path.join(HERE,'pdb_clean.csv')); d=d[d.arch.isin(['nip','pin'])&d.pce.notna()]
exec(open(os.path.join(HERE,'build_lookup.py')).read().split('KEYS =')[0].split('d = pd.read_csv')[0])  # helper funcs only
def acat(r):
    ma,fa,cs=r.ma,r.fa,r.cs
    if ma>=0.9: return 'MA'
    if fa>=0.9: return 'FA'
    if cs>=0.9: return 'Cs'
    if cs<0.03: return 'FAMA'
    if ma<0.03: return 'CsFA'
    if fa<0.03: return 'CsMA'
    return 'CsFAMA'
d['acat']=d.apply(acat,axis=1); d['brb']=pd.cut(d.br,[-1,0.02,0.1,0.25,0.45,0.7,1.1],labels=False); d['snb']=(d.sn>0.02).astype(int)
d['onestep']=d.proc.eq('Spin-coating')
d['yb']=pd.cut(d.year,[0,2015,2017,2018,2019,2030],labels=False)
Q=float(os.environ.get('Q','0.5'))
def contrast(sub,col,a,b,strata=('arch','acat','brb','snb','yb')):
    """Median ratio (b/a) within each stratum, log-averaged with stratum size as weight"""
    s=sub[sub[col].isin([a,b])]
    ws,ls=[],[]
    for _,g in s.groupby(list(strata)):
        ga,gb=g[g[col]==a].pce,g[g[col]==b].pce
        if len(ga)>=5 and len(gb)>=5:
            w=min(len(ga),len(gb)); ws.append(w); ls.append(np.log(gb.quantile(Q)/ga.quantile(Q)))
    if not ws: return None,0
    return float(np.exp(np.average(ls,weights=ws))), int(sum(ws))
# model: change only the same item in the default recipe
def model(recipes):
    json.dump(recipes,open('/tmp/m_in.json','w'))
    subprocess.run(['node',os.path.join(HERE,'jsmodel.js'),'/tmp/m_in.json','/tmp/m_out.json','cell'],check=True)
    return [x['pce'] for x in json.load(open('/tmp/m_out.json'))]
NIP=dict(htl='spiro_litfsi',etl='sno2',electrode='au',barrier=False)
PIN=dict(htl='ptaa',etl='c60')
CASES=[
 ('No quench / antisolvent (one-step spin)', d[d.onestep], 'quench','antisolvent','none', [dict(),dict(quench='none')]),
 ('Gas quench / antisolvent', d, 'quench','antisolvent','gas', [dict(),dict(quench='gas')]),
 ('Vacuum quench / antisolvent', d, 'quench','antisolvent','vacuum', [dict(),dict(quench='vacuum')]),
 ('n-i-p: SnO2 / TiO2 electron layer', d[d.arch=='nip'], 'etl','tio2','sno2', [dict(NIP,etl='tio2'),dict(NIP)]),
 ('p-i-n: PEDOT / PTAA hole layer', d[d.arch=='pin'], 'htl','ptaa','pedot', [dict(PIN),dict(PIN,htl='pedot')]),
 ('p-i-n: NiOx / PTAA hole layer', d[d.arch=='pin'], 'htl','ptaa','nio', [dict(PIN),dict(PIN,htl='nio')]),
 ('n-i-p: P3HT / Spiro hole layer', d[d.arch=='nip'], 'htl','spiro_litfsi','p3ht', [dict(NIP),dict(NIP,htl='p3ht')]),
 ('p-i-n: PCBM / C60 electron layer', d[d.arch=='pin'], 'etl','c60','pcbm', [dict(PIN),dict(PIN,etl='pcbm')]),
 ('Composition: triple-cation CsFAMA / MAPbI3', d[d.br<0.25], 'acat','MA','CsFAMA', [dict(fa=0,ma=1,cs=0,br=0),dict(fa=0.79,ma=0.16,cs=0.05,br=0.17)], ('arch','snb','yb')),
 ('Composition: FA-Cs / MAPbI3', d[d.br<0.25], 'acat','MA','CsFA', [dict(fa=0,ma=1,cs=0,br=0),dict(fa=0.8,ma=0,cs=0.2,br=0.17)], ('arch','snb','yb')),
 ('Composition: inorganic CsPb(I,Br)3 / MAPbI3', d, 'acat','MA','Cs', [dict(fa=0,ma=1,cs=0,br=0),dict(fa=0,ma=0,cs=1,br=0.33)], ('arch','snb','yb')),
]
rows=[]
for name,sub,col,a,b,recs,*st in CASES:
    r,n=contrast(sub,col,a,b,*(st or [('arch','acat','brb','snb','yb')]))
    mp=model(recs); mr=mp[1]/mp[0]
    agree = r is not None and (np.sign(np.log(r))==np.sign(np.log(mr)) or abs(np.log(r))<0.05 and abs(np.log(mr))<0.05)
    close = r is not None and abs(np.log(mr/r))<np.log(1.25)
    rows.append(dict(name=name,real=r,n=n,model=mr,agree=bool(agree),close=bool(close)))
    print(f"{name:44s} measured ×{r:.2f} (n={n:5d})  model ×{mr:.2f}  direction {'O' if agree else 'X'} size {'O' if close else 'X'}")
json.dump(rows,open(os.path.join(HERE,f'contrasts_q{Q}.json'),'w'),ensure_ascii=False,indent=1)
