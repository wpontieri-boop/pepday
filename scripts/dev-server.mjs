// Servidor estático de desenvolvimento, sem dependências e sem publicação.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const args=process.argv.slice(2), portIndex=args.indexOf('--port');
const port=Number(portIndex>=0?args[portIndex+1]:process.env.PORT||4173);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.json':'application/json','.svg':'image/svg+xml'};
const permitted=new Set(['index.html','app.js','style.css','account.css','manifest.json','icon.svg','sw.js','config.js',
  'src/import-completion.mjs','src/account-ui.mjs','src/account.mjs','src/cloud.mjs','src/legacy-import.mjs','vendor/supabase-2.116.0.js']);
http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost'), path=decodeURIComponent(url.pathname).replace(/^\//,'')||'index.html';
    if(!permitted.has(path)||!['GET','HEAD'].includes(req.method)){res.writeHead(404);res.end();return;}
    const data=await readFile(resolve(root,path));
    res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(req.method==='HEAD'?undefined:data);
  }catch{res.writeHead(404);res.end();}
}).listen(port,'0.0.0.0',()=>console.log(`PepDay dev server ready on port ${port}`));
