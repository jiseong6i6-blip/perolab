"""Calibrate 'finished cell' degradation with ~1,550 measured T80 values: per-pathway factors + an intrinsic (ion/interface) channel"""
import json, os, subprocess
import numpy as np, pandas as pd
from scipy.optimize import minimize
from scipy.stats import spearmanr
HERE=os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE,'stab_compare.py')).read().split("json.dump(recs,open('/tmp/st_in.json','w'))")[0])
for x in recs: x['cond']['hours']=1e5; x['cond']['calibration']='papers'  # compute with the original (uncalibrated) rates, then fit the factors here
json.dump(recs,open('/tmp/st_in.json','w'))
js=r"""
const fs=require('fs'),path=require('path');const W=path.join(process.argv[2],'..','web');
globalThis.SPECTRA=JSON.parse(fs.readFileSync(path.join(W,'spectra.json')));
require(path.join(W,'perolab_core.js'));require(path.join(W,'perolab_phys.js'));require(path.join(W,'perolab_lab.js'));
const P=globalThis.Perolab;const inp=JSON.parse(fs.readFileSync('/tmp/st_in.json'));const cache={};
const M=["Oxygen + light oxidation","Moisture","Thermal decomposition","Volatilization (iodine escape)","HTL degradation","Metal electrode","Tin oxidation"];
let tg=null;
const out=inp.map(({recipe,cond})=>{const k=JSON.stringify(recipe);const st=cache[k]||(cache[k]=P.buildCell(recipe).stack);
 const r=P.simulateAging(st,cond,200);tg=r.t;return M.map(m=>Array.from(r.dmg[m]).map(v=>+v.toPrecision(4)));});
fs.writeFileSync('/tmp/st_dmg.json',JSON.stringify({t:tg,d:out}));
"""
open('/tmp/st2.js','w').write(js); subprocess.run(['node','/tmp/st2.js',HERE],check=True)
D=json.load(open('/tmp/st_dmg.json')); t=np.array(D['t']); dm=np.array(D['d'])  # (cells, 7, T)
real=s.st_T80.values; TK=s['T'].values+273.15; suns=s.suns.values
LIM=-np.log(0.8); KB=8.617333e-5
def t80(p, ret_all=False):
    m_ox,m_mo,m_th,lk0,a,ea=p
    mult=np.array([10**m_ox,10**m_mo,10**m_th,1,1,1,1])
    tot=np.einsum('ckt,k->ct',dm,mult)
    kint=10**lk0*(1+a*suns)*np.exp(-ea/KB*(1/TK-1/298.15))
    tot=tot+kint[:,None]*t[None,:]
    out=np.empty(len(real))
    for i in range(len(real)):
        j=np.searchsorted(tot[i],LIM)
        out[i]=t[-1] if j>=len(t) else (t[j-1]+(LIM-tot[i][j-1])/(tot[i][j]-tot[i][j-1]+1e-30)*(t[j]-t[j-1]) if j>0 else t[0])
    return out
def loss(p):
    if p[4]<0 or p[5]<0 or p[5]>1.2: return 9
    return np.mean(np.abs(np.log10(t80(p)/real)))
p0=[0,0,0,np.log10(LIM/1e5),0,0.3]
base=np.mean(np.abs(np.log10(t80([0,0,0,-12,0,0])/real)))
print('before calibration: mean |log10 error|', round(base,3))
best=None
for start in [p0,[-1,0,0,-3.2,2,0.3],[-1.5,-0.3,-0.5,-3,3,0.5]]:
    r=minimize(loss,start,method='Nelder-Mead',options=dict(maxiter=1500,xatol=1e-3,fatol=1e-4))
    print(r.fun, np.round(r.x,3))
    if best is None or r.fun<best.fun: best=r
p=best.x; m=t80(p)
print('after calibration: mean |log10 error|', round(best.fun,3))
print('ox ×%.3g  moist ×%.3g  thermal ×%.3g  k_int(25°C dark)=%.3g /h -> T80 %.0f h,  1 sun light factor %.2f,  Ea %.2f eV'%(10**p[0],10**p[1],10**p[2],10**p[3],LIM/10**p[3],1+p[4],p[5]))
lr=np.log10(m/real)
print('ρ', round(spearmanr(m,real).correlation,3), 'within 3x', round(float((abs(lr)<np.log10(3)).mean()),3), 'within 10x', round(float((abs(lr)<1).mean()),3))
# cross-validation: fit on one half, evaluate on the other
rng=np.random.default_rng(0); idx=rng.permutation(len(real)); A,B=idx[:len(idx)//2],idx[len(idx)//2:]
def lossA(p):
    if p[4]<0 or p[5]<0 or p[5]>1.2: return 9
    return np.mean(np.abs(np.log10(t80(p)[A]/real[A])))
rA=minimize(lossA,p,method='Nelder-Mead',options=dict(maxiter=800))
mB=t80(rA.x)[B]; print('cross-validation (held-out half) mean |log10 error|', round(float(np.mean(np.abs(np.log10(mB/real[B])))),3), 'before calibration', round(float(np.mean(np.abs(np.log10(t80([0,0,0,-12,0,0])[B]/real[B])))),3),
      'ρ', round(spearmanr(mB,real[B]).correlation,3))
json.dump(dict(params=dict(m_ox=10**p[0],m_moist=10**p[1],m_thermal=10**p[2],k_int=10**p[3],light_factor=p[4],Ea_int=p[5]),
  before=float(base),after=float(best.fun),cv_after=float(np.mean(np.abs(np.log10(mB/real[B])))),cv_before=float(np.mean(np.abs(np.log10(t80([0,0,0,-12,0,0])[B]/real[B])))),
  rho_after=float(spearmanr(m,real).correlation),rho_cv=float(spearmanr(mB,real[B]).correlation),
  w3=float((abs(lr)<np.log10(3)).mean()),w10=float((abs(lr)<1).mean()),n=int(len(real))),open(os.path.join(HERE,'stab_fit.json'),'w'),indent=1)

# ---- fit to the medians of condition groups (air/N2 x light/dark x room/high temperature x encapsulation): reduces per-cell noise (quality varies between labs)
s['grp']=s.atm.str.replace('_glovebox','').replace({'ar':'n2'})+'/'+np.where(s.suns>0,'light','dark')+'/'+np.where(s['T']>=50,'hot','rt')+'/'+np.where(s.encap,'enc','bare')
grp=s.grp.values; G=[g for g in pd.unique(grp) if (grp==g).sum()>=15]
def gloss(p):
    m_ox,m_mo,m_th,lk0,a,ea=p
    if a<0 or not(0.05<=ea<=0.9) or m_ox<-2.5: return 9
    m=t80(p); e=[]; w=[]
    for g in G:
        k=grp==g; e.append(abs(np.log10(np.median(m[k])/np.median(real[k])))); w.append(np.sqrt(k.sum()))
    return float(np.average(e,weights=w))
bestg=None
for start in [[0,0,0,-3.2,2,0.3],[-1,-0.5,-0.3,-3.2,3,0.4],[-2,0,0,-3,2,0.2]]:
    r=minimize(gloss,start,method='Nelder-Mead',options=dict(maxiter=2000,xatol=1e-3,fatol=1e-5))
    print('g',round(r.fun,3),np.round(r.x,3))
    if bestg is None or r.fun<bestg.fun: bestg=r
pg=bestg.x; mg=t80(pg); lr=np.log10(mg/real)
print('group fit: ox ×%.3g  moist ×%.3g  thermal ×%.3g  k_int=%.3g/h (T80 %.0f h)  light factor %.2f  Ea %.2f'%(10**pg[0],10**pg[1],10**pg[2],10**pg[3],LIM/10**pg[3],1+pg[4],pg[5]))
print('per-cell mean |log10 error|', round(float(np.mean(abs(lr))),3), 'ρ', round(spearmanr(mg,real).correlation,3), 'within 3x', round(float((abs(lr)<np.log10(3)).mean()),3),'within 10x', round(float((abs(lr)<1).mean()),3))
print('group error (weighted)', round(bestg.fun,3), 'before calibration', round(gloss([0,0,0,-12,0,0.3]),3))
for g in G:
    k=grp==g; print(f"  {g:28s} n={k.sum():4d} measured {np.median(real[k]):7.0f}  before {np.median(t80([0,0,0,-12,0,0.3])[k]):7.0f}  after {np.median(mg[k]):7.0f}")
# cross-validation (group fit on half of the cells)
def glossA(p,K):
    m_ox,m_mo,m_th,lk0,a,ea=p
    if a<0 or not(0.05<=ea<=0.9) or m_ox<-2.5: return 9
    m=t80(p); e=[];w=[]
    for g in G:
        k=(grp==g)&K
        if k.sum()<8: continue
        e.append(abs(np.log10(np.median(m[k])/np.median(real[k])))); w.append(np.sqrt(k.sum()))
    return float(np.average(e,weights=w))
KA=np.zeros(len(real),bool); KA[A]=True
rA=minimize(lambda p: glossA(p,KA),pg,method='Nelder-Mead',options=dict(maxiter=800))
print('cross-validation: group error on the other half', round(glossA(rA.x,~KA),3), 'before calibration', round(glossA([0,0,0,-12,0,0.3],~KA),3))
out=json.load(open(os.path.join(HERE,'stab_fit.json')))
out['group_fit']=dict(params=dict(m_ox=10**pg[0],m_moist=10**pg[1],m_thermal=10**pg[2],k_int=10**pg[3],light_factor=pg[4],Ea_int=pg[5]),
   group_err_after=bestg.fun,group_err_before=gloss([0,0,0,-12,0,0.3]),cv_after=glossA(rA.x,~KA),cv_before=glossA([0,0,0,-12,0,0.3],~KA),
   cell_err=float(np.mean(abs(lr))),rho=float(spearmanr(mg,real).correlation),w3=float((abs(lr)<np.log10(3)).mean()),w10=float((abs(lr)<1).mean()),
   groups=[dict(g=g,n=int((grp==g).sum()),real=float(np.median(real[grp==g])),before=float(np.median(t80([0,0,0,-12,0,0.3])[grp==g])),after=float(np.median(mg[grp==g]))) for g in G])
json.dump(out,open(os.path.join(HERE,'stab_fit.json'),'w'),indent=1,ensure_ascii=False)
