// PREPARATION ONLY. Nothing here deploys production or enables ads.
// pepday-public Render auto-deploy remains off until explicit owner authorization.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {renderCalculatorGuide} from './discovery-guide.mjs';

const origin='https://pepday.com.br';
function canonical(html,route){
  if(!html.includes('</head>'))throw new Error('Missing HTML head');
  return html.replace('</head>','<link rel="canonical" href="'+origin+route+'">\n</head>');
}
export async function preparePublicDiscovery(out){
  let landing=await readFile(path.join(out,'index.html'),'utf8');
  const cta='href="/app/?from=site">Usar calculadora grátis';
  if(!landing.includes(cta))throw new Error('Public FREE CTA changed: needs review');
  landing=landing.replace(cta,'href="/calculadora/">Usar calculadora grátis');
  const faq='A calculadora de peptídeos em mg, mcg, mL e UI';
  if(!landing.includes(faq))throw new Error('Guide anchor changed: needs review');
  landing=landing.replace(faq,'A <a href="/guia-calculadora/">calculadora de peptídeos em mg, mcg, mL e UI</a>');
  await writeFile(path.join(out,'index.html'),canonical(landing,'/'),'utf8');

  const app=await readFile(path.join(out,'app','index.html'),'utf8');
  const home='id="home" class="screen active"', calc='id="calculator" class="screen"';
  if(!app.includes(home)||!app.includes(calc))throw new Error('Calculator HTML changed: needs review');
  let alias=app.replace('<head>','<head>\n  <base href="/app/">\n  <meta name="pepday-entry-screen" content="calculator">')
    .replace(home,'id="home" class="screen"')
    .replace(calc,'id="calculator" class="screen active"')
    .replace('data-go="home" class="active"','data-go="home"')
    .replace('<button data-go="calculator">','<button data-go="calculator" class="active">')
    .replace('<title>PepDay</title>','<title>Calculadora FREE de mg, mcg, mL e UI — PepDay</title>');
  alias=canonical(alias,'/calculadora/');
  await mkdir(path.join(out,'calculadora'),{recursive:true});
  await writeFile(path.join(out,'calculadora','index.html'),alias,'utf8');

  let guide=renderCalculatorGuide({cssPath:'/site.css',landingPath:'/'});
  guide=canonical(guide,'/guia-calculadora/');
  await mkdir(path.join(out,'guia-calculadora'),{recursive:true});
  await writeFile(path.join(out,'guia-calculadora','index.html'),guide,'utf8');

  const routes=['/','/calculadora/','/guia-calculadora/','/termos.html','/privacidade.html'];
  const sitemap='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+
    routes.map(route=>'<url><loc>'+origin+route+'</loc></url>').join('')+'</urlset>\n';
  await writeFile(path.join(out,'sitemap.xml'),sitemap,'utf8');
  await writeFile(path.join(out,'robots.txt'),[
    '# Public pages crawlable; access to private areas is enforced by auth.',
    'User-agent: *',
    'Disallow: /admin/',
    'Disallow: /parceiros/',
    'Disallow: /cartao/',
    'Sitemap: '+origin+'/sitemap.xml',
    ''
  ].join('\n'),'utf8');
}
