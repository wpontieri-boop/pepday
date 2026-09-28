import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizeSync} from '../src/sync-status.mjs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../src/account-ui.mjs',import.meta.url),'utf8');
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const dev=readFileSync(new URL('../scripts/dev-server.mjs',import.meta.url),'utf8');

test('Perfil mostra estado sincronizado quando não há pendências',()=>{
  const result=summarizeSync([],{online:true,paused:false,running:false});
  assert.equal(result.state,'synced');
  assert.match(result.description,/sem alterações pendentes/i);
});

test('offline preserva fila local e informa quantidade aguardando conexão',()=>{
  const result=summarizeSync([{status:'pending'},{status:'syncing'}],{online:false});
  assert.equal(result.state,'offline');
  assert.match(result.description,/2 alterações aguardando conexão/i);
});

test('conflito ou falha permanente têm precedência e nunca aparecem como sincronizados',()=>{
  const conflict=summarizeSync([{status:'conflict'},{status:'pending'}],{online:true});
  assert.equal(conflict.state,'attention');assert.equal(conflict.counts.conflict,1);
  const failed=summarizeSync([{status:'failed'}],{online:true});
  assert.equal(failed.state,'attention');assert.equal(failed.counts.failed,1);
  assert.match(failed.description,/dados locais foram preservados/i);
});

test('pausa por sessão ou entitlement mantém alterações aguardando',()=>{
  const result=summarizeSync([{status:'pending'}],{online:true,paused:true});
  assert.equal(result.state,'paused');
  assert.match(result.description,/sessão ou acesso PRO/i);
});

test('Perfil e cache incluem o estado de sincronização e removem promessa antiga',()=>{
  assert.match(html,/id="syncState"/);
  assert.match(html,/id="syncLabel"/);
  assert.match(html,/id="syncDescription"/);
  assert.match(ui,/summarizeSync/);
  assert.doesNotMatch(ui,/sincronização (das telas|contínua) será disponibilizada no próximo bloco/i);
  assert.match(sw,/src\/sync-status\.mjs/);
  assert.match(dev,/src\/sync-status\.mjs/);
  for(const asset of ['src/sync-api.mjs','src/sync-engine.mjs','src/tab-coordinator.mjs'])assert.match(dev,new RegExp(asset.replace(/[./]/g,'\\$&')));
});
