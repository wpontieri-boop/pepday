import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');

test('Rotina oferece cadastro de frasco sem substituir o seletor',async()=>{
  const html=await read('index.html');
  assert.match(html,/select id="rVial"/);
  assert.match(html,/id="routineAddVial"[^>]*>＋ Cadastrar novo frasco</);
});

test('tooltip da quantidade segue texto e acessibilidade aprovados',async()=>{
  const html=await read('index.html');
  assert.match(html,/Informe a quantidade usada em cada aplicação, em mg ou mcg\. Ex.: 1 mg ou 250 mcg\. O PepDay apenas calcula e organiza o valor informado por você\./);
  assert.match(html,/id="rDose"[^>]+aria-describedby="rDoseHelp"/);
  assert.match(html,/aria-label="Ajuda sobre quantidade por aplicação"[^>]+aria-expanded="false"[^>]+aria-controls="rDoseHelp"/);
  assert.match(html,/id="rDoseHelp" role="tooltip"/);
});

test('salvar e cancelar frasco retornam à rotina; somente salvar seleciona um ID',async()=>{
  const js=await read('app.js');
  assert.match(js,/routineAddVial[^]*vialReturnToRoutine=true;[^]*go\('vials'\);[^]*openVial\(\)/);
  assert.match(js,/cancelVial[^]*returnToRoutineFromVial\(\)/);
  assert.match(js,/savedVialId=crypto\.randomUUID\(\)[^]*returnToRoutineFromVial\(savedVialId\)/);
  assert.match(js,/if\(vialId\)fillRoutineVials\(vialId\)/);
});

test('tooltip de Rotinas reutiliza interação visual responsiva',async()=>{
  const css=await read('style.css');
  assert.match(css,/:is\(#routineForm,#vialForm\) \.field-help:hover \.field-tooltip/);
  assert.match(css,/:is\(#routineForm,#vialForm\) \.field-help\[data-open="true"\] \.field-tooltip/);
  assert.match(css,/@media\(max-width:520px\).*#routineForm,#vialForm/s);
});
