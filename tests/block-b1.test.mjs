import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createAccountService } from '../src/account.mjs';
import { normalizeEntitlement, proGateDecision, entitlementPresentation } from '../src/entitlement.mjs';
import { createAccessController } from '../src/access-control.mjs';

const migration=readFileSync(new URL('../supabase/migrations/202609110003_block_b1_entitlements.sql',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const gateSource=readFileSync(new URL('../src/pro-gate.mjs',import.meta.url),'utf8');
const accountUiSource=readFileSync(new URL('../src/account-ui.mjs',import.meta.url),'utf8');
const appSource=readFileSync(new URL('../app.js',import.meta.url),'utf8');
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
  assert.doesNotMatch(gateSource,/event\.detail/);
  assert.match(appSource,/proScreens\.has\(id\).*requirePro/);
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
  for(const asset of ['src/entitlement.mjs','src/access-control.mjs','src/pro-gate.mjs']){
    assert.match(serviceWorker,new RegExp(asset.replace(/[./]/g,'\\$&')));
    assert.match(devServer,new RegExp(asset.replace(/[./]/g,'\\$&')));
  }
  assert.match(serviceWorker,/pepday-v3-b1-gate-hardening/);
});

class TestCustomEvent extends Event {constructor(type,options={}){super(type);this.detail=options.detail}}
test('evento DOM forjado não concede PRO ao estado controlado',()=>{
  const target=new EventTarget();target.defaultView={CustomEvent:TestCustomEvent};
  const {view,authority}=createAccessController(target);
  authority.authenticated({status:'free',pro:false,trial_available:true});
  target.dispatchEvent(new TestCustomEvent('pepday:entitlement',{detail:{status:'pro_active',pro:true,signedIn:true}}));
  assert.equal(view.snapshot().status,'free');assert.equal(view.canUsePro(),false);
  authority.authenticated({status:'trial',pro:true,trial_used:true});assert.equal(view.canUsePro(),true);
});

test('trial não pode ser iniciado por evento sintético do documento',()=>{
  assert.doesNotMatch(accountUiSource,/pepday:start-trial/);
  assert.match(accountUiSource,/event\.isTrusted/);
  assert.match(accountUiSource,/cloud\.account\.startTrial\(\)/);
});

function appHarness(status='free',routineDone=false){
  class ClassList {constructor(){this.values=new Set()}add(...v){v.forEach(x=>this.values.add(x))}remove(...v){v.forEach(x=>this.values.delete(x))}contains(v){return this.values.has(v)}toggle(v,force){const on=force===undefined?!this.values.has(v):force;on?this.values.add(v):this.values.delete(v);return on}}
  class Element {
    constructor(id=''){this.id=id;this.dataset={};this.classList=new ClassList();this.style={};this.value='';this.checked=false;this.innerHTML='';this.textContent='';this.listeners={};this.options=[];this.selectedIndex=0}
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn)}
    fire(type,event={}){for(const fn of this.listeners[type]||[])fn({preventDefault(){},stopPropagation(){},target:this,...event})}
    setAttribute(){} querySelector(){return null} closest(){return null} matches(){return false}
    append(){} appendChild(){} scrollIntoView(){} focus(){} getBoundingClientRect(){return {top:10,bottom:30,left:10,width:20}}
  }
  const ids=new Map(), element=id=>{if(!ids.has(id))ids.set(id,new Element(id));return ids.get(id)};
  const screens=['home','calculator','routines','vials','profile'].map(id=>element(id));screens[0].classList.add('active');
  const nav=screens.map(screen=>{const node=new Element();node.dataset.go=screen.id;return node});
  const docListeners={};
  const document={body:new Element('body'),defaultView:{CustomEvent:TestCustomEvent},
    querySelector(selector){
      if(selector.startsWith('#'))return element(selector.slice(1));
      const match=selector.match(/data-go="([^"]+)"/);if(match)return nav.find(x=>x.dataset.go===match[1])||null;
      return null;
    },
    querySelectorAll(selector){if(selector==='.screen')return screens;if(selector==='nav button'||selector==='[data-go]')return nav;return []},
    getElementById:id=>element(id),createElement:()=>new Element(),
    addEventListener(type,fn){(docListeners[type]??=[]).push(fn)},dispatchEvent(){return true}
  };
  const now=new Date(),today=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
  const seed={
    pepday_v1_routines:JSON.stringify([{id:'r1',name:'R1',vialId:'v1',doseValue:1,doseUnit:'mg',doseMg:1,ui:20,ml:.2,syringeCapacity:100,frequency:'daily',start:'2026-01-01',done:routineDone?['2099-01-01']:[]}]),
    pepday_v2_vials:JSON.stringify([{id:'v1',name:'V1',initialMg:10,remainingMg:8,waterMl:2,date:'2026-01-01',history:routineDone?[{date:new Date().toISOString(),type:'dose',routineId:'r1',day:today,mg:1}]:[]}]),
    pepday_tutorial_v29_seen:'1'
  };
  if(routineDone)seed.pepday_v1_routines=JSON.stringify([{id:'r1',name:'R1',vialId:'v1',doseValue:1,doseUnit:'mg',doseMg:1,ui:20,ml:.2,syringeCapacity:100,frequency:'daily',start:'2026-01-01',done:[today]}]);
  const store=new Map(Object.entries(seed));
  const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
  const allowed=status==='trial'||status==='pro_active';
  const windowListeners={};
  const context={document,localStorage,console,Intl,Date,JSON,Math,Set,Object,Number,String,
    globalThis:null,navigator:{},location:{},crypto:{randomUUID:()=>`new-${Math.random()}`},
    alert(){},confirm:()=>true,prompt:()=> '7',CustomEvent:TestCustomEvent,
    setTimeout:fn=>{fn();return 1},clearTimeout(){},
    PepDayAccess:Object.freeze({requirePro:()=>allowed}),
    addEventListener(type,fn){(windowListeners[type]??=[]).push(fn)},scrollTo(){},innerHeight:800,innerWidth:400
  };
  context.window=context;context.globalThis=context;
  vm.runInNewContext(appSource,context,{filename:'app.js'});
  return {context,element,screens,nav,store,windowListeners};
}

test('navegação programática e tutorial passam pelo gate central em FREE',()=>{
  const h=appHarness('free');
  assert.equal(h.context.PepDayNavigation.go('routines'),false);
  assert.equal(h.context.PepDayNavigation.go('vials'),false);
  assert.equal(h.screens.find(x=>x.id==='home').classList.contains('active'),true);
  h.element('replayTutorial').fire('click');
  h.element('tutorialNext').fire('click'); // calculadora FREE
  h.element('tutorialNext').fire('click'); // tentativa de Frascos
  assert.equal(h.screens.find(x=>x.id==='calculator').classList.contains('active'),true);
  assert.equal(h.screens.find(x=>x.id==='vials').classList.contains('active'),false);
});

test('mutadores diretos de rotina, frasco e aplicação não alteram dados no FREE',()=>{
  for(const done of [false,true]){
    const h=appHarness('free',done),beforeR=h.store.get('pepday_v1_routines'),beforeV=h.store.get('pepday_v2_vials');
    h.context.toggleDone('r1');h.context.delR('r1');h.context.deleteVial('v1');h.context.adjustVial('v1');
    h.element('saveRoutine').onclick();h.element('saveVial').onclick();
    assert.equal(h.store.get('pepday_v1_routines'),beforeR);
    assert.equal(h.store.get('pepday_v2_vials'),beforeV);
  }
});

test('mutações representativas são liberadas em trial e PRO ativo',()=>{
  for(const status of ['trial','pro_active']){
    const h=appHarness(status);
    h.context.toggleDone('r1');
    assert.notEqual(h.store.get('pepday_v1_routines'),undefined);
    assert.equal(JSON.parse(h.store.get('pepday_v1_routines'))[0].done.length,1);
    assert.equal(JSON.parse(h.store.get('pepday_v2_vials'))[0].remainingMg,7);
    h.context.adjustVial('v1');
    assert.equal(JSON.parse(h.store.get('pepday_v2_vials'))[0].remainingMg,7);
    h.element('newRoutine').onclick();
    Object.assign(h.element('rName'),{value:'R2'});Object.assign(h.element('rVial'),{value:'v1'});
    Object.assign(h.element('rDose'),{value:'1'});Object.assign(h.element('rDoseUnit'),{value:'mg'});
    Object.assign(h.element('rSyringe'),{value:'100'});Object.assign(h.element('rRefillAt'),{value:'3'});
    Object.assign(h.element('frequency'),{value:'daily'});Object.assign(h.element('startDate'),{value:'2026-09-11'});
    h.element('saveRoutine').onclick();
    assert.equal(JSON.parse(h.store.get('pepday_v1_routines')).length,2);
    h.element('newVial').onclick();
    Object.assign(h.element('vName'),{value:'Novo'});Object.assign(h.element('vMg'),{value:'5'});
    Object.assign(h.element('vWater'),{value:'1'});Object.assign(h.element('vDate'),{value:'2026-09-11'});
    h.element('saveVial').onclick();
    assert.equal(JSON.parse(h.store.get('pepday_v2_vials')).length,2);
    const undo=appHarness(status,true);undo.context.toggleDone('r1');
    assert.equal(JSON.parse(undo.store.get('pepday_v1_routines'))[0].done.length,0);
    assert.equal(JSON.parse(undo.store.get('pepday_v2_vials'))[0].remainingMg,9);
  }
});

test('ex-assinante expirado sem trial usado não recebe trial',()=>{
  assert.match(migration,/s\.status in \('pro_active','pro_expired'\)/);
  assert.match(migration,/if current_access->>'status'<>'free' then return current_access/);
  assert.match(readFileSync(new URL('../supabase/tests/block_b1_entitlements.sql',import.meta.url),'utf8'),/FAIL expired subscriber trial/);
});
