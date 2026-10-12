"""Environmental degradation model vs measured T80 (Perovskite Database, about 1,500 cells)"""
import json, os, subprocess
import numpy as np, pandas as pd
from scipy.stats import spearmanr
HERE=os.path.dirname(os.path.abspath(__file__))
d=pd.read_csv(os.path.join(HERE,'pdb_clean.csv'))
s=d[d.st_T80.notna()&(d.st_T80>0)&d.arch.isin(['nip','pin'])].copy()
def tmean(x):
    try: a=[float(v) for v in str(x).split(';')]; a=[v for v in a if np.isfinite(v)]; return np.mean(a) if a else np.nan
    except: return np.nan
s['T']=s.st_temp.map(tmean).fillna(25)
ATM={'Air':'air','Ambient':'air','Ambient air':'air','Inert':'n2_glovebox','Air. Desiccator':'dry_air','Dry air':'dry_air','N2':'n2_glovebox','Ar':'ar_glovebox'}
s=s[s.st_atm.isin(ATM)]
s['atm']=s.st_atm.map(ATM)
s['rh']=s.st_rh.fillna(40)
s['suns']=(s.st_light.fillna(0)/100).clip(0,2)
HTL={'spiro_litfsi':'spiro_litfsi','ptaa':'ptaa','nio':'nio','pedot':'pedot','sam':'sam'}
recs=[]
for _,r in s.iterrows():
    rec=dict(fa=r.fa,ma=r.ma,cs=r.cs,br=r.br,cl=r.cl,sn=r.sn,snf2_pct=5 if r.sn>0 else 0,
             htl=HTL.get(r.htl,'ptaa'),etl={'tio2':'tio2','sno2':'sno2','pcbm':'pcbm','c60':'c60','lif_c60':'lif_c60'}.get(r.etl,'sno2' if r.arch=='nip' else 'c60'),
             electrode='au' if r.arch=='nip' else 'ag',barrier=False,passivation='none',quench=r.quench if r.quench in('none','antisolvent','gas','vacuum') else 'antisolvent')
    cond=dict(atmosphere=r.atm,rh_pct=float(r.rh),temp_C=float(r['T']),suns=float(r.suns),encapsulation='polymer' if r.encap else 'none',hours=float(max(r.st_T80*20,200)))
    recs.append(dict(recipe=rec,cond=cond))
json.dump(recs,open('/tmp/st_in.json','w'))
js=r"""
const fs=require('fs'),path=require('path');const W=path.join(process.argv[2],'..','web');
globalThis.SPECTRA=JSON.parse(fs.readFileSync(path.join(W,'spectra.json')));
require(path.join(W,'perolab_core.js'));require(path.join(W,'perolab_phys.js'));require(path.join(W,'perolab_lab.js'));
const P=globalThis.Perolab;const inp=JSON.parse(fs.readFileSync('/tmp/st_in.json'));const cache={};
const out=inp.map(({recipe,cond})=>{const k=JSON.stringify(recipe);const st=cache[k]||(cache[k]=P.buildCell(recipe).stack);
 const r=P.simulateAging(st,cond,160);const top=Object.entries(r.share).sort((a,b)=>b[1]-a[1])[0][0];return [r.t80,top];});
fs.writeFileSync('/tmp/st_out.json',JSON.stringify(out));
"""
open('/tmp/st.js','w').write(js)
subprocess.run(['node','/tmp/st.js',HERE],check=True)
o=json.load(open('/tmp/st_out.json'))
s['model']=[x[0] if x[0] is not None else np.inf for x in o]; s['mech']=[x[1] for x in o]
s.loc[~np.isfinite(s.model),'model']=s.st_T80*20  # never drops to 80% within the period -> treat as an upper bound
s['lr']=np.log10(s.model/s.st_T80)
res={}
def summary(g,name):
    rho=spearmanr(g.model,g.st_T80).correlation if len(g)>5 else np.nan
    w3=float((g.lr.abs()<np.log10(3)).mean()); w10=float((g.lr.abs()<1).mean())
    print(f"{name:26s} n={len(g):5d} rank corr ρ={rho:+.2f}  median log error {g.lr.median():+.2f} (×{10**g.lr.median():.2g})  within 3x {w3*100:4.0f}%  within 10x {w10*100:4.0f}%")
    res[name]=dict(n=int(len(g)),rho=None if not np.isfinite(rho) else round(float(rho),3),bias=round(float(10**g.lr.median()),3),w3=round(w3,3),w10=round(w10,3))
summary(s,'All')
summary(s[s.suns==0],'Dark storage (ISOS-D)')
summary(s[s.suns>0],'Under light (ISOS-L)')
summary(s[s.atm=='air'],'Air')
summary(s[s.atm.isin(['n2_glovebox','ar_glovebox'])],'N2 / Ar')
summary(s[s['T']>=60],'60 °C and above')
summary(s[s.encap],'Encapsulated')
summary(s[s.ma>=0.9],'MAPbI3-type')
summary(s[s.ma<0.9],'FA/Cs mixed')
# compare medians per condition group (does the model get 'which condition is worse' right?)
s['grp']=s.atm+'/'+np.where(s.suns>0,'light','dark')+'/'+np.where(s['T']>=50,'hot','rt')+'/'+np.where(s.encap,'enc','bare')
g=s.groupby('grp').agg(n=('st_T80','size'),real=('st_T80','median'),model=('model','median')).query('n>=15')
print(g.round(0))
rho_g=spearmanr(g.real,g.model).correlation
print('condition-group rank correlation', round(rho_g,2), len(g))
res['groups']=dict(rho=round(float(rho_g),3),n=int(len(g)),table=g.reset_index().round(1).to_dict('records'))
json.dump(res,open(os.path.join(HERE,'stab_compare.json'),'w'),ensure_ascii=False,indent=1)
