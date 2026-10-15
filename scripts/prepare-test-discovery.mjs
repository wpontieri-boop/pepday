// TEST-only discovery rehearsal. Never called by build:public.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import path from 'node:path';
import {renderCalculatorGuide} from './discovery-guide.mjs';
export async function prepareTestDiscovery(out){
  const origin='https://homologacao.pepday.com.br';
  const app=await readFile(path.join(out,'index.html'),'utf8');
  // Same approved calculator, inputs, handlers and assets; no second implementation.
  const calculator=app.replace('<head>','<head>\n  <base href="/">')
    .replace('</head>','<meta name="pepday-entry-screen" content="calculator"></head>')
    .replace('id="home" class="screen active"','id="home" class="screen"')
    .replace('id="calculator" class="screen"','id="calculator" class="screen active"')
    .replace('data-go="home" class="active"','data-go="home"')
    .replace('<button data-go="calculator">','<button data-go="calculator" class="active">')
    .replace('<title>PepDay</title>','<title>Calculadora FREE de mg, mcg, mL e UI — PepDay</title>');
  await mkdir(path.join(out,'calculadora'),{recursive:true});
  await writeFile(path.join(out,'calculadora/index.html'),calculator);
  let landing=await readFile(path.join(out,'site/index.html'),'utf8');
  landing=landing.replace('href="../?from=site">Usar calculadora grátis','href="/calculadora/">Usar calculadora grátis')
    .replace('A calculadora de peptídeos em mg, mcg, mL e UI','A <a href="/guia-calculadora/">calculadora de peptídeos em mg, mcg, mL e UI</a>');
  await writeFile(path.join(out,'site/index.html'),landing);
  const guide=renderCalculatorGuide();
  await mkdir(path.join(out,'guia-calculadora'),{recursive:true});
  await writeFile(path.join(out,'guia-calculadora/index.html'),guide);
  const routes=['/','/site/','/calculadora/','/guia-calculadora/','/termos.html','/privacidade.html'];
  async function visit(dir){
    for(const entry of await readdir(dir,{withFileTypes:true})){
      const file=path.join(dir,entry.name);
      if(entry.isDirectory()){await visit(file);continue}
      if(!entry.name.endsWith('.html'))continue;
      let html=await readFile(file,'utf8');
      // Allow the noindex directive to be seen; robots is not an access control.
      if(!/name=["']robots["']/.test(html))html=html.replace(/<head>/i,'<head>\n<meta name="robots" content="noindex, nofollow">');
      const route='/'+path.relative(out,file).split(path.sep).join('/').replace(/index\.html$/,'');
      if(routes.includes(route))html=html.replace(/<\/head>/i,`<link rel="canonical" href="${origin}${route}">\n</head>`);
      html=html.replace('src="src/ads.mjs"','src="src/ads.mjs?v=2"');
      await writeFile(file,html);
    }
  }
  await visit(out);
  await writeFile(path.join(out,'robots.txt'),`# Homologacao: HTML noindex; QA only. Never submit this sitemap.\nUser-agent: *\nDisallow: /admin/\nDisallow: /site/admin/\nDisallow: /parceiros/\nDisallow: /site/parceiros/\nDisallow: /cartao/\nSitemap: ${origin}/sitemap.xml\n`);
  await writeFile(path.join(out,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routes.map(route=>`<url><loc>${origin}${route}</loc></url>`).join('')}</urlset>\n`);
  // Force only the TEST SW to refresh its cached ad policy. PROD source untouched.
  const sw=path.join(out,'sw.js');await writeFile(sw,(await readFile(sw,'utf8')).replace("profile-sync-33-","profile-sync-33-ads-audit-test-"));
}
