// Dedicated TEST package: preserve /site/admin/ and add canonical aliases.
import {cp,mkdir,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const out=path.join(root,'preview');
if(path.dirname(out)!==root||path.basename(out)!=='preview')throw new Error('Invalid TEST output');
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
for(const name of ['index.html','app.js','style.css','account.css','manifest.json','icon.svg','sw.js','config.js','termos.html','privacidade.html','src','vendor','site','cartao'])await cp(path.join(root,name),path.join(out,name),{recursive:true});
await cp(path.join(root,'site/admin'),path.join(out,'admin'),{recursive:true});
console.log('PepDay TEST build ready: preview');
