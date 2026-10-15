// TEST-only discovery rehearsal. Never called by build:public.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import path from 'node:path';
export async function prepareTestDiscovery(out){
  const origin='https://homologacao.pepday.com.br';
  const app=await readFile(path.join(out,'index.html'),'utf8');
  // Same approved calculator, inputs, handlers and assets; no second implementation.
  const calculator=app.replace('<head>','<head>\n  <base href="/">')
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
  const guide=`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Como conferir os cálculos do PepDay — Guia da calculadora FREE</title>
<meta name="description" content="Entenda entradas, fórmulas, unidades e limites da calculadora FREE do PepDay, sem cadastro e sem recomendações de doses.">
<link rel="stylesheet" href="/site/site.css"><link rel="icon" href="/icon.svg" type="image/svg+xml"></head>
<body><header class="topbar"><a class="brand" href="/site/">PepDay</a><nav aria-label="Guia"><a href="/calculadora/">Calculadora FREE</a><a href="/site/#faq">Dúvidas</a></nav></header>
<main><article class="section"><div class="section-heading narrow"><h1>Como conferir os cálculos do PepDay</h1><p>Guia da equipe PepDay · Revisado em 15/10/2026</p><p>A calculadora FREE transforma valores informados por você em concentração e volume. Funciona sem login. Rotinas, frascos, histórico, sincronização e lembretes pertencem ao PRO.</p></div>
<h2>O que cada campo representa</h2><p>Quantidade no frasco é a massa total em mg. Diluente adicionado é o volume em mL. Quantidade informada é a massa que você quer converter, em mg ou mcg. O nome é apenas uma identificação opcional; ele não escolhe uma fórmula nem sugere valores.</p>
<h2>Fórmulas usadas pelo aplicativo</h2><p>1 mg = 1.000 mcg. Para converter mcg para mg, divida por 1.000. Concentração (mg/mL) = massa total (mg) ÷ volume informado (mL). Volume calculado (mL) = massa informada (mg) ÷ concentração (mg/mL).</p><p>Na escala volumétrica U-100, 1 mL corresponde a 100 marcações UI. O PepDay calcula a marcação como volume (mL) × 100. Essa relação pertence à escala U-100; não converte a atividade biológica de uma substância nem se aplica automaticamente a outras escalas.</p>
<h2>Como ler o resultado</h2><p>O aplicativo mostra marcação UI, volume, concentração e quantidade teórica de porções. A quantidade teórica é massa total ÷ massa informada. É uma divisão matemática: não considera perdas, estabilidade, validade ou condições físicas do conteúdo.</p><p>As opções 30, 50 e 100 UI correspondem a capacidades U-100 de 0,3, 0,5 e 1 mL. Mudar a capacidade altera a representação visual, não a concentração ou o volume calculado. Se o volume ultrapassa a capacidade escolhida, o app apresenta um aviso.</p>
<h2>Conferência e limites</h2><p>Confira unidades, separador decimal, massa total e volume antes de calcular. Os resultados exibidos são arredondados; a ilustração da seringa é aproximada e não substitui a leitura do instrumento. O cálculo adota o volume informado no campo de diluente como volume da solução e não modela deslocamento de volume ou perdas.</p><p>O PepDay não determina qual substância usar, quanto usar, frequência, modo de preparo ou administração. Não valida um protocolo nem garante segurança clínica. Use somente parâmetros previamente definidos com orientação profissional. Este guia descreve o software; não contém prescrição.</p>
<h2>Privacidade e acesso</h2><p>Você pode usar a calculadora sem criar uma conta. Os recursos de conta e seus direitos estão descritos na <a href="/privacidade.html">Política de Privacidade</a> e nos <a href="/termos.html">Termos de Uso</a>. Suporte: <a href="mailto:wagnerpontieri@gmail.com">wagnerpontieri@gmail.com</a>.</p>
<p><a class="btn primary" href="/calculadora/">Usar calculadora FREE</a> <a href="/site/">Conhecer o PepDay</a></p></article></main></body></html>`;
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
