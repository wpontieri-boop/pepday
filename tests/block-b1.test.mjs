import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAccountService } from '../src/account.mjs';
import { normalizeEntitlement, proGateDecision, entitlementPresentation } from '../src/entitlement.mjs';

const migration=readFileSync(new URL('../supabase/migrations/202609110003_block_b1_entitlements.sql',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const gateSource=readFileSync(new URL('../src/pro-gate.mjs',import.meta.url),'utf8');
const serviceWorker=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const devServer=readFileSync(new URL('../scripts/dev-server.mjs',import.meta.url),'utf8');

test('FREE sem login mantém calculadora livre e bloqueia somente ação PRO',()=>{
  const access=normalizeEntitlement(null);
  assert.equal(access.status,'free');assert.equal(access.pro,false);assert.equal(access.signedIn,false);
  assert.deepEqual(proGateDecision(access),{allowed:false,reason:'login',canStartTrial:false,needsLogin:true});
  assert.doesNotMatch(html.match(/<button class="primary" id="calculate"[^>]*>/)?.[0]||'',/data-pro-action/);
});

test('FREE logado usa estado do backend e oferece trial sem conceder PRO',()=>{
  const access=normalizeEntitlement({status:'free',pro:false,source:'account',trial_used:false,
    trial_available:true,server_now:'2026-09-11T12:00:00Z'},{signedIn:true});
  assert.equal(access.status,'free');assert.equal(access.pro,false);assert.equal(access.trialAvailable,true);
  assert.deepEqual(proGateDecision(access),{allowed:false,reason:'free',canStartTrial:true,needsLogin:false});
});

test('trial só é solicitado pelo método explícito e nunca ao consultar sessão/entitlement',async()=>{
  const calls=[];
  const client={auth:{getSession:async()=>({data:{session:{user:{id:'u'}}}})},rpc:async name=>{
    calls.push(name);return {data:name==='get_entitlement'?{status:'free',pro:false}:{status:'trial',pro:true}};
  }};
  const account=createAccountService(client);
  await account.session();await account.entitlement();
  assert.deepEqual(calls,['get_entitlement']);
  await account.startTrial();assert.deepEqual(calls,['get_entitlement','start_trial']);
});

test('backend define sete dias, serializa cliques e retorna horário confiável',()=>{
  assert.match(migration,/statement_timestamp\(\)/);
  assert.match(migration,/where user_id=u for update/);
  assert.match(migration,/if t\.trial_used then return public\.get_entitlement\(\)/);
  assert.match(migration,/ends_at=stamp\+interval '7 days'/);
  assert.match(migration,/'server_now',stamp/);
});

test('segundo clique e novo login não renovam o prazo persistido da conta',()=>{
  const first={status:'trial',pro:true,source:'trial',trial_used:true,trial_available:false,
    started_at:'2026-09-11T12:00:00Z',ends_at:'2026-09-18T12:00:00Z',server_now:'2026-09-11T12:00:01Z'};
  const second={...first,server_now:'2026-09-11T12:00:02Z'};
  const afterLogin={...first,server_now:'2026-09-12T12:00:00Z'};
  for(const response of [second,afterLogin]){
    assert.equal(response.started_at,first.started_at);assert.equal(response.ends_at,first.ends_at);
    assert.equal((new Date(response.ends_at)-new Date(response.started_at))/86400000,7);
  }
});

test('trial expirado bloqueia gate e informa preservação',()=>{
  const access=normalizeEntitlement({status:'pro_expired',pro:false,source:'trial',trial_used:true,
    trial_available:false,started_at:'2026-09-01T00:00:00Z',ends_at:'2026-09-08T00:00:00Z'},{signedIn:true});
  assert.deepEqual(proGateDecision(access),{allowed:false,reason:'expired',canStartTrial:false,needsLogin:false});
  assert.match(entitlementPresentation(access).description,/dados continuam salvos/i);
});

test('PRO ativo libera gate; PRO expirado permanece bloqueado',()=>{
  const active=normalizeEntitlement({status:'pro_active',pro:true,source:'subscription'},{signedIn:true});
  const expired=normalizeEntitlement({status:'pro_expired',pro:false,source:'subscription'},{signedIn:true});
  assert.equal(proGateDecision(active).allowed,true);
  assert.equal(proGateDecision(expired).allowed,false);
  assert.equal(proGateDecision(expired).canStartTrial,false);
});

test('bloqueio de acesso não altera nem apaga rotinas, frascos ou histórico',()=>{
  const localData={routines:[{id:'r1',done:['2026-09-10']}],vials:[{id:'v1',history:[{type:'dose'}]}]};
  const before=JSON.stringify(localData);
  proGateDecision(normalizeEntitlement({status:'pro_expired',pro:false,source:'trial',trial_used:true},{signedIn:true}));
  assert.equal(JSON.stringify(localData),before);
  assert.doesNotMatch(migration,/\b(delete|truncate)\s+(from\s+)?public\.(vials|routines|applications|vial_movements)\b/i);
});

test('gate reutilizável protege entradas de Rotinas/Frascos e mantém abas visíveis',()=>{
  assert.match(html,/<button data-go="routines" data-pro-action>/);
  assert.match(html,/<button data-go="vials" data-pro-action>/);
  assert.match(html,/id="saveRoutineFromCalc" data-pro-action/);
  assert.match(gateSource,/\[data-pro-action\]/);
  assert.match(gateSource,/pepday:entitlement/);
  assert.match(gateSource,/pepday:start-trial/);
});

test('interface expõe os quatro estados e ações explícitas sem pagamento',()=>{
  for(const label of ['PEPDAY FREE','PEPDAY PRO — TESTE GRÁTIS','PEPDAY PRO ATIVO','PEPDAY PRO EXPIRADO']){
    assert.match(readFileSync(new URL('../src/entitlement.mjs',import.meta.url),'utf8'),new RegExp(label));
  }
  assert.match(html,/>Começar 7 dias grátis</);
  assert.match(html,/>Agora não</);
  assert.doesNotMatch(html,/Mercado Pago|comprar|pagamento/i);
});

test('módulos B1 estão disponíveis no servidor local e no cache versionado da V3',()=>{
  for(const asset of ['src/entitlement.mjs','src/pro-gate.mjs']){
    assert.match(serviceWorker,new RegExp(asset.replace(/[./]/g,'\\$&')));
    assert.match(devServer,new RegExp(asset.replace(/[./]/g,'\\$&')));
  }
  assert.match(serviceWorker,/pepday-v3-b1-entitlement-gate/);
});
