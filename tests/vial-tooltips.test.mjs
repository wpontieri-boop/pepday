import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');

test('formulário exibe os novos rótulos e textos de ajuda',async()=>{
  const html=await read('index.html');
  assert.match(html,/Quantidade do frasco \(mg\)/);
  assert.match(html,/Diluente \(mL\)/);
  assert.match(html,/Informe a quantidade total de peptídeo que veio no frasco, em mg, antes da reconstituição\. Ex.: se o frasco é de 10 mg, informe 10\./);
  assert.match(html,/Informe o volume total adicionado ao frasco para reconstituição\./);
  assert.match(html,/Informe a data em que o diluente foi adicionado ao frasco\./);
});

test('ajudas são botões acessíveis associados aos campos',async()=>{
  const html=await read('index.html');
  for(const [field,help] of [['vMg','vMgHelp'],['vWater','vWaterHelp'],['vDate','vDateHelp']]){
    assert.match(html,new RegExp(`id="${field}"[^>]+aria-describedby="${help}"`));
    assert.match(html,new RegExp(`aria-expanded="false"[^>]+aria-controls="${help}"`));
    assert.match(html,new RegExp(`id="${help}" role="tooltip"`));
  }
});

test('interação cobre hover, clique, toque e fechamento por Escape',async()=>{
  const [css,js,sw]=await Promise.all([read('style.css'),read('app.js'),read('sw.js')]);
  assert.match(css,/\.field-help:hover \.field-tooltip/);
  assert.match(css,/\.field-help\[data-open="true"\] \.field-tooltip/);
  assert.match(css,/\.field-tooltip\{[^}]*left:0;right:0;/);
  assert.match(css,/@media\(max-width:520px\).*\.field-info/s);
  assert.match(js,/closest\('\.field-info'\)/);
  assert.match(js,/event\.key==='Escape'/);
  assert.match(js,/aria-expanded/);
  assert.match(sw,/pepday-v3-b1-gate-hardening/);
});

test('IDs e tipos usados pela lógica do formulário permanecem intactos',async()=>{
  const html=await read('index.html');
  for(const id of ['vName','vMg','vWater','vDate','vCost','cancelVial','saveVial']) assert.match(html,new RegExp(`id="${id}"`));
  for(const id of ['vMg','vWater','vCost']) assert.match(html,new RegExp(`id="${id}"[^>]+type="number"|type="number"[^>]+id="${id}"`));
  assert.match(html,/id="vDate" type="date"/);
});
