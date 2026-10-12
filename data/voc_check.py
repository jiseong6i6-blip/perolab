import pandas as pd, os
HERE=os.path.dirname(os.path.abspath(__file__))
d=pd.read_csv(os.path.join(HERE,'pdb_clean.csv')); d=d[d.voc.notna()&d.eg.notna()&d.arch.isin(['nip','pin'])&(d.year>=2018)]
d['egb']=pd.cut(d.eg,[1.2,1.3,1.45,1.55,1.65,1.75,1.85,2.0,2.4])
g=d.groupby('egb',observed=False).apply(lambda s: pd.Series({'n':len(s),'eg':s.eg.median(),'voc50':s.voc.median(),'voc90':s.voc.quantile(0.9),'voc_max':s.voc.quantile(0.99)}))
print(g.round(3)); g.to_csv(os.path.join(HERE,'voc_vs_eg.csv'))
