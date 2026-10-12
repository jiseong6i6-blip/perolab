import pandas as pd, json, subprocess, os
HERE=os.path.dirname(os.path.abspath(__file__))
d=pd.read_csv(os.path.join(HERE,'pdb_clean.csv'))
m=d[d.eg_measured & d.eg.notna()].drop_duplicates(subset=['doi','ma','fa','cs','sn','br','cl','eg']).copy()
json.dump(m[['fa','ma','cs','br','cl','sn']].to_dict('records'),open('/tmp/eg_in.json','w'))
subprocess.run(['node',os.path.join(HERE,'jsmodel.js'),'/tmp/eg_in.json','/tmp/eg_out.json','eg'],check=True)
m['eg_model']=json.load(open('/tmp/eg_out.json')); m['err']=m.eg_model-m.eg
for name,s in [('all',m),('Pb',m[m.sn==0]),('Pb I',m[(m.sn==0)&(m.br==0)]),('Pb I/Br',m[(m.sn==0)&(m.br>0)]),('PbSn',m[m.sn>0])]:
    print(f"{name:8s} n={len(s)} MAE={s.err.abs().mean()*1000:.0f} bias={s.err.mean()*1000:+.0f}")
m.to_csv(os.path.join(HERE,'eg_compare.csv'),index=False)
