import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=name=>readFile(resolve(root,name),'utf8');

test('HTML principal tem viewport mobile, manifest, ícone e IDs únicos',async()=>{
  const html=await read('index.html');
  assert.match(html,/name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/);
  assert.match(html,/rel="manifest" href="manifest\.json"/);
  assert.match(html,/rel="icon" href="icon\.svg"/);
  const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]);
  const duplicates=ids.filter((id,index)=>ids.indexOf(id)!==index);
  assert.deepEqual([...new Set(duplicates)],[]);
  assert.ok(ids.length>40);
});

test('manifest PWA possui identidade, start_url, standalone e ícone maskable',async()=>{
  const manifest=JSON.parse(await read('manifest.json'));
  assert.equal(manifest.name,'PepDay');
  assert.equal(manifest.short_name,'PepDay');
  assert.equal(manifest.start_url,'./');
  assert.equal(manifest.display,'standalone');
  assert.match(manifest.theme_color,/^#[0-9a-f]{6}$/i);
  assert.match(manifest.background_color,/^#[0-9a-f]{6}$/i);
  assert.ok(manifest.icons.some(icon=>icon.src==='icon.svg'&&icon.type==='image/svg+xml'&&/maskable/.test(icon.purpose||'')));
  for(const icon of manifest.icons)await access(resolve(root,icon.src));
});

test('Service Worker usa cache V3 isolado, inclui jurídico e não cacheia Auth',async()=>{
  const sw=await read('sw.js');
  assert.match(sw,/pepday-v3-profile-sync-16-/);
  assert.match(sw,/'\.\/termos\.html'/);
  assert.match(sw,/'\.\/privacidade\.html'/);
  assert.match(sw,/request\.headers\.has\('Authorization'\)/);
  assert.match(sw,/url\.search/);
  assert.match(sw,/name\.startsWith\('pepday-v3-'\)/);
  assert.doesNotMatch(sw,/caches\.delete\([^)]*pepday-v2/i);
});

test('todos os assets públicos declarados no Service Worker existem',async()=>{
  const sw=await read('sw.js');
  const array=sw.match(/const ASSETS=\[([^]*?)\];/)?.[1]||'';
  const assets=[...array.matchAll(/'\.\/([^']*)'/g)].map(m=>m[1]||'index.html');
  assert.ok(assets.length>=20);
  for(const asset of assets){
    const file=asset.endsWith('/')?asset+'index.html':asset;
    await access(resolve(root,file));
  }
});

test('Calculadora oferece mg/mcg e seringas U-100 de 30, 50 e 100 UI',async()=>{
  const html=await read('index.html');
  assert.match(html,/id="doseUnit"[^]*?<option value="mg">mg<\/option><option value="mcg">mcg<\/option>/);
  const syringe=html.match(/<select id="syringe">([^]*?)<\/select>/)?.[1]||'';
  for(const size of ['30','50','100'])assert.match(syringe,new RegExp(`value="${size}"`));
  const routineSyringe=html.match(/<select id="rSyringe">([^]*?)<\/select>/)?.[1]||'';
  for(const size of ['30','50','100'])assert.match(routineSyringe,new RegExp(`value="${size}"`));
});

test('fórmula da calculadora mantém conversão mcg→mg e UI U-100',async()=>{
  const source=await read('app.js');
  assert.match(source,/doseMg=\$\('#doseUnit'\)\.value==='mcg'\?dose\/1000:dose/);
  assert.match(source,/conc=mg\/water, ml=doseMg\/conc, ui=ml\*100/);
  const calculate=({mg,water,dose,unit})=>{
    const doseMg=unit==='mcg'?dose/1000:dose;
    const conc=mg/water,ml=doseMg/conc;
    return {ui:ml*100,ml,conc};
  };
  for(const cap of [30,50,100]){
    const mg=calculate({mg:10,water:2,dose:1,unit:'mg'});
    const mcg=calculate({mg:10,water:2,dose:1000,unit:'mcg'});
    assert.equal(mg.ui,20);
    assert.equal(mcg.ui,20);
    assert.ok(mg.ui<=cap);
  }
});

test('frequência 5on2off usa ciclo de sete dias com cinco ON e dois OFF',async()=>{
  const source=await read('app.js');
  assert.match(source,/r\.frequency==='5on2off'\)return diff%7<5/);
  assert.match(source,/5 dias ON \/ 2 dias OFF/);
  const active=Array.from({length:14},(_,diff)=>diff%7<5);
  assert.deepEqual(active,[true,true,true,true,true,false,false,true,true,true,true,true,false,false]);
});

test('forecast e reposição usam saldo, rotina vinculada e calendário da frequência',async()=>{
  const source=await read('app.js');
  assert.match(source,/function vialForecast\(v\)/);
  assert.match(source,/function nextRoutineDates\(r,count/);
  assert.match(source,/PREVISÃO DE TÉRMINO/);
  assert.match(source,/ALERTA DE REPOSIÇÃO/);
  assert.match(source,/Planeje a compra de um novo frasco/);
});

test('fluxo Rotina → novo Frasco preserva draft antes de navegar e restaura depois',async()=>{
  const source=await read('app.js');
  const save=source.indexOf("repository.drafts.put(captureRoutineDraft())");
  const goVials=source.indexOf("go('vials')",save);
  const returnFlag=source.indexOf('vialReturnToRoutine=true',save);
  const draftRead=source.indexOf("repository.drafts.get('routine-form')",goVials);
  assert.ok(save>=0&&returnFlag>save&&goVials>returnFlag&&draftRead>goVials);
  assert.match(source,/fields:\{name:\$\('#rName'\)\.value,vialId:\$\('#rVial'\)\.value,dose:\$\('#rDose'\)\.value/);
});

test('layout principal possui regras responsivas para mobile e desktop',async()=>{
  const [css,account]=await Promise.all([read('style.css'),read('account.css')]);
  assert.match(css,/@media\(max-width:520px\)/);
  assert.match(css,/@media\(max-width:420px\)/);
  assert.match(css,/@media\(min-width:760px\)/);
  assert.match(css,/width:min\(760px,100%\)/);
  assert.match(account,/@media\(max-width:620px\)/);
  assert.doesNotMatch(css,/min-width:\s*[89]\d{2,}px/);
});

test('aplicação registra Service Worker e mantém tutorial/calculadora no frontend',async()=>{
  const [app,html]=await Promise.all([read('app.js'),read('index.html')]);
  assert.match(app,/navigator\.serviceWorker\.register\('\.\/sw\.js'\)/);
  assert.match(html,/id="calculator"/);
  assert.match(html,/id="calculate"/);
  assert.match(html,/id="tutorialOverlay"/);
});
