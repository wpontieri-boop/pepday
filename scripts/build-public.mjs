import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const outArg=process.argv.indexOf('--out');
const out=outArg>=0&&process.argv[outArg+1]
  ?path.resolve(process.argv[outArg+1])
  :path.join(root,'public');

const copy=async(src,dst)=>cp(path.join(root,src),path.join(out,dst),{recursive:true});

await rm(out,{recursive:true,force:true});
await mkdir(out,{recursive:true});

for(const file of ['icon.svg','termos.html','privacidade.html']){
  await copy(file,file);
}
await copy('config.production.js','config.js');
await copy('vendor','vendor');
await copy('src','src');

let landing=await readFile(path.join(root,'site','index.html'),'utf8');
landing=landing
  .replaceAll('../?from=site','/app/?from=site')
  .replaceAll('./site.css','/site.css')
  .replaceAll('./assets/','/assets/')
  .replaceAll('../icon.svg','/icon.svg')
  .replaceAll('../termos.html','/termos.html')
  .replaceAll('../privacidade.html','/privacidade.html');
await writeFile(path.join(out,'index.html'),landing,'utf8');
await copy('site/site.css','site.css');
await copy('site/assets','assets');

await mkdir(path.join(out,'admin'),{recursive:true});
await copy('site/admin/index.html','admin/index.html');
await copy('site/admin/admin.css','admin/admin.css');
await copy('site/admin/admin.mjs','admin/admin.mjs');

await mkdir(path.join(out,'cartao'),{recursive:true});
let card=await readFile(path.join(root,'cartao','index.html'),'utf8');
card=card.replace('../?from=cartao','/app/?from=cartao');
await writeFile(path.join(out,'cartao','index.html'),card,'utf8');

await mkdir(path.join(out,'app'),{recursive:true});
let app=await readFile(path.join(root,'index.html'),'utf8');
app=app.replace('PEPDAY • V3.0 — TESTES','PEPDAY • V3.0');
await writeFile(path.join(out,'app','index.html'),app,'utf8');
for(const file of [
  'app.js','style.css','account.css','manifest.json','icon.svg',
  'sw.js','termos.html','privacidade.html'
]){
  await copy(file,path.posix.join('app',file));
}
await copy('config.production.js','app/config.js');
await copy('src','app/src');
await copy('vendor','app/vendor');
await copy('cartao','app/cartao');

console.log('PepDay public build pronto:',out);
