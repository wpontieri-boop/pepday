import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');

test('formulários de nova Rotina e novo Frasco ficam antes das listas',async()=>{
  const html=await read('index.html');
  const routines=html.slice(html.indexOf('<section id="routines"'),html.indexOf('<section id="vials"'));
  const vials=html.slice(html.indexOf('<section id="vials"'),html.indexOf('<section id="profile"'));
  assert.ok(routines.indexOf('id="routineForm"')<routines.indexOf('id="routineList"'));
  assert.ok(vials.indexOf('id="vialForm"')<vials.indexOf('id="vialList"'));
});

test('abrir, cancelar e editar continuam usando os formulários existentes',async()=>{
  const js=await read('app.js');
  assert.match(js,/newRoutine'\)\.onclick=\(\)=>openRoutine\(\)/);
  assert.match(js,/cancelRoutine'\)\.onclick=async\(\)=>[^]*drafts\.delete\('routine-form'\)[^]*routineForm'\)\.classList\.add\('hidden'\)/);
  assert.match(js,/window\.editR=id=>openRoutine/);
  assert.match(js,/newVial'\)\.onclick=\(\)=>\{vialReturnToRoutine=false;openVial\(\)\}/);
  assert.match(js,/cancelVial'\)\.onclick=.*classList\.add\('hidden'\).*returnToRoutineFromVial\(\)/);
  assert.match(js,/window\.editVial=id=>openVial/);
  assert.match(js,/function openRoutine[^]*requirePro/);
  assert.match(js,/function openVial[^]*requirePro/);
});

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
  assert.match(js,/savedVialId=crypto\.randomUUID\(\)[^]*await returnToRoutineFromVial\(savedVialId\)/);
  assert.match(js,/saveVialWithDraftAndOutbox\(savedVial,draft,operation\)/);
});

test('tooltip de Rotinas reutiliza interação visual responsiva',async()=>{
  const css=await read('style.css');
  assert.match(css,/:is\(#routineForm,#vialForm\) \.field-help:hover \.field-tooltip/);
  assert.match(css,/:is\(#routineForm,#vialForm\) \.field-help\[data-open="true"\] \.field-tooltip/);
  assert.match(css,/@media\(max-width:520px\).*#routineForm,#vialForm/s);
});

test('Calculadora pré-preenche Rotina e novo Frasco sem perder os valores informados',async()=>{
  const js=await read('app.js');
  assert.match(js,/lastCalc=\{name:[^}]*doseUnit:\$\('#doseUnit'\)\.value[^}]*syringeCapacity/);
  assert.match(js,/rDose'\)\.value=r\?\.doseValue\?\?calc\?\.dose\?\?''/);
  assert.match(js,/rDoseUnit'\)\.value=r\?\.doseUnit\|\|calc\?\.doseUnit\|\|'mg'/);
  assert.match(js,/rSyringe'\)\.value=String\(r\?\.syringeCapacity\|\|calc\?\.syringeCapacity\|\|100\)/);
  assert.match(js,/let calc=!v&&vialReturnToRoutine\?lastCalc:null/);
  assert.match(js,/vName'\)\.value=v\?\.name\|\|calc\?\.name\|\|''/);
  assert.match(js,/vMg'\)\.value=v\?\.initialMg\?\?calc\?\.mg\?\?''/);
  assert.match(js,/vWater'\)\.value=v\?\.waterMl\?\?calc\?\.water\?\?''/);
});

test('Rotina e Frasco disparam sync e confirmação remota recarrega Rotinas e destrava Application',async()=>{
  const js=await read('app.js');
  assert.match(js,/saveRoutineWithOutbox[^]*pepday:outbox-ready/);
  assert.match(js,/saveVialWithDraftAndOutbox[^]*pepday:outbox-ready/);
  const confirmed=js.slice(js.indexOf("window.addEventListener('pepday:sync-confirmed'"),js.indexOf("$('#calculate').onclick"));
  assert.match(confirmed,/repository\.routines\.list\(\)/);
  assert.match(confirmed,/item\.type==='application'&&item\.blockedReason==='remote-prerequisites'/);
  assert.match(confirmed,/repository\.outbox\.resolvePrerequisites/);
  assert.match(confirmed,/routines=nextRoutines/);
  assert.match(confirmed,/if\(unblocked\)window\.dispatchEvent\(new CustomEvent\('pepday:outbox-ready'/);
});