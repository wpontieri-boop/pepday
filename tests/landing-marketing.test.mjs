import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');

test('landing principal contém a arquitetura comercial aprovada',async()=>{
  const html=await read('site/index.html');
  for(const text of [
    'Usar calculadora grátis',
    'O problema não é só fazer a conta',
    'O PepDay transforma números e rotina em uma visão simples',
    'Como funciona',
    'Por que criamos o PepDay',
    'PEPDAY FREE',
    'PEPDAY PRO ANUAL',
    'Construído para problemas reais',
    'Começar grátis agora'
  ]) assert.match(html,new RegExp(text,'i'));
});

test('landing separa FREE e PRO com preços aprovados',async()=>{
  const html=await read('site/index.html');
  assert.match(html,/R\$ 0/);
  assert.match(html,/R\$ 14,90/);
  assert.match(html,/R\$ 99,90/);
  assert.match(html,/Calculadora mg, mcg, mL e UI/);
  assert.match(html,/Rotinas e frascos/);
});

test('landing não publica depoimento fictício e mantém template para relatos reais',async()=>{
  const html=await read('site/index.html');
  assert.match(html,/sem inventar experiências de clientes/i);
  assert.match(html,/id="testimonialTemplate"/);
  assert.match(html,/Relato publicado com autorização/);
  assert.doesNotMatch(html,/“[^”]{8,}”\s*<small>[^<]*(cliente|usuário)/i);
});

test('landing mantém linguagem de cálculo e organização, sem recomendação de tratamento',async()=>{
  const html=await read('site/index.html');
  assert.match(html,/não recomenda doses, tratamentos ou protocolos/i);
  assert.match(html,/Você informa seus próprios valores/i);
  assert.doesNotMatch(html,/dose ideal|protocolo recomendado|tratamento indicado/i);
});

test('seringa U-100 mostra escala completa e marcador do resultado sem recomendar dose',async()=>{
  const [html,css]=await Promise.all([read('site/index.html'),read('site/site.css')]);
  assert.match(html,/Seringa U-100 com marcação visual em 20 UI/);
  assert.match(html,/left:0%"><b>0<\/b>/);
  assert.match(html,/left:100%"><b>100<\/b>/);
  assert.match(html,/class="ms-target" style="left:20%"><span>20 UI<\/span>/);
  assert.match(html,/valores informados por você/i);
  assert.match(css,/\.marketing-syringe/);
  assert.match(css,/\.ms-target/);
});

test('landing usa tema claro e telas reais do próprio produto',async()=>{
  const [html,css,calculatorShot,homeShot]=await Promise.all([
    read('site/index.html'),
    read('site/site.css'),
    readFile(new URL('../site/assets/calculator-u100-real.png',import.meta.url)),
    readFile(new URL('../site/assets/home-real.png',import.meta.url))
  ]);
  assert.match(html,/class="hero-visual"/);
  assert.match(html,/calculator-u100-real\.png/);
  assert.match(html,/home-real\.png/);
  assert.match(html,/class="phones"/);
  assert.match(css,/background:#fff/);
  assert.match(css,/\.real-app-phone/);
  assert.ok(calculatorShot.length>10000);
  assert.ok(homeShot.length>10000);
});

test('landing não substitui a Home do app durante homologação',async()=>{
  const [server,html]=await Promise.all([read('scripts/dev-server.mjs'),read('index.html')]);
  assert.match(server,/rawPath==='site'\|\|rawPath==='site\/'\?'site\/index\.html'/);
  assert.match(server,/'site\/index\.html','site\/site\.css'/);
  assert.match(html,/id="calculator"/);
  assert.match(html,/id="profile"/);
});


test('landing destaca lembretes no celular e benefícios PRO/Trial',async()=>{
  const html=await read('site/index.html');
  assert.match(html,/Lembretes no celular/i);
  assert.match(html,/mesmo com o PepDay fechado/i);
  assert.match(html,/Teste o PRO por 7 dias/i);
  assert.match(html,/sem anúncios/i);
});
