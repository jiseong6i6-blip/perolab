// node jsmodel.js in.json out.json  - compute band gap / cells with the lab's web model (JS)
const fs=require('fs'),path=require('path');const W=path.join(__dirname,'..','web');
globalThis.SPECTRA=JSON.parse(fs.readFileSync(path.join(W,'spectra.json')));
require(path.join(W,'perolab_core.js'));require(path.join(W,'perolab_phys.js'));require(path.join(W,'perolab_lab.js'));
const P=globalThis.Perolab;const inp=JSON.parse(fs.readFileSync(process.argv[2]));const mode=process.argv[4]||'eg';
const out=inp.map(r=>{const rr=Object.assign({},P.RECIPE_DEFAULT,r);if(mode==='eg')return P.bandgapRecipe(rr);
 const c=P.buildCell(rr);return {eg:c.eg,pce:c.pce,voc:c.voc,jsc:c.jsc,ff:c.ff};});
fs.writeFileSync(process.argv[3],JSON.stringify(out));
