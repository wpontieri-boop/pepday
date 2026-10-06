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
  'termos.html','privacidade.html','cartao/index.html','site/index.html','site/site.css',
  'site/admin/index.html','site/admin/admin.css','site/admin/admin.mjs','site/admin/parceiros/index.html','site/admin/parceiros/partners.css','site/admin/parceiros/partners.mjs','src/partner-public.mjs',
  'src/import-completion.mjs','src/account-ui.mjs','src/account.mjs','src/cloud.mjs','src/legacy-import.mjs',
  'src/entitlement.mjs','src/access-control.mjs','src/pro-gate.mjs','src/local-db.mjs',
  'src/pepday-repository.mjs','src/local-data-migration.mjs','src/sync-outbox.mjs','src/sync-api.mjs',
  'src/sync-engine.mjs','src/tab-coordinator.mjs','src/sync-status.mjs','src/remote-snapshot.mjs','src/acquisition.mjs','vendor/supabase-2.116.0.js']);
http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost'), rawPath=decodeURIComponent(url.pathname).replace(/^\//,'');
    const alias=rawPath.replace(/^admin(?=\/|$)/,'site/admin');
    const path=alias==='site/admin/parceiros'||alias==='site/admin/parceiros/'?'site/admin/parceiros/index.html':
      alias==='site/admin'||alias==='site/admin/'?'site/admin/index.html':
      alias.startsWith('site/admin/')?alias:
      rawPath==='cartao'||rawPath==='cartao/'?'cartao/index.html':
      rawPath==='site'||rawPath==='site/'?'site/index.html':
      rawPath==='site/admin'||rawPath==='site/admin/'?'site/admin/index.html':rawPath||'index.html';
    if(!permitted.has(path)||!['GET','HEAD'].includes(req.method)){res.writeHead(404);res.end();return;}
    const data=await readFile(resolve(root,path));
    res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(req.method==='HEAD'?undefined:data);
  }catch{res.writeHead(404);res.end();}
}).listen(port,'0.0.0.0',()=>console.log(`PepDay dev server ready on port ${port}`));
