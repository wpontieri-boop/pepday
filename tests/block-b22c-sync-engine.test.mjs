import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {indexedDB} from 'fake-indexeddb';
import {openPepDayRepository} from '../src/pepday-repository.mjs';
import {createSyncEngine} from '../src/sync-engine.mjs';
import {createSyncApi,SyncApiError,parseRetryAfter} from '../src/sync-api.mjs';
import {createTabCoordinator} from '../src/tab-coordinator.mjs';

let serial=0;const uuid=()=>`90000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`;
const publicConfig={supabaseUrl:'https://fixture.supabase.co',supabasePublishableKey:'sb_publishable_fixture'};
const authClient=()=>({auth:{getSession:async()=>({data:{session:{access_token:'test-token'}}}),refreshSession:async()=>({error:null})}});
const appSource=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const dbName=label=>`pepday-b22c-${label}-${Date.now()}-${++serial}`;
const remove=name=>new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=resolve;r.onerror=()=>reject(r.error)});
const application=(overrides={})=>({operationId:uuid(),type:'application',entityType:'application',entityId:'planned',dependencies:[],baseVersion:null,
  payload:{expectedUserId:'user-a',routineId:'routine-1',routineVersionId:'rv-1',vialId:'vial-1',scheduledDate:'2026-09-16',appliedAt:null},...overrides});
const undo=(applicationId,dependency,overrides={})=>({operationId:uuid(),type:'undo',entityType:'application',entityId:applicationId,
  dependencies:[dependency],baseVersion:null,payload:{expectedUserId:'user-a',applicationId,undoneAt:null},...overrides});
const confirmation=(op,{replay=false,balance=9,kind='application'}={})=>({replay,application:{id:op.payload.applicationId||'app-1',operation_id:op.operationId,
  vial_id:'vial-1',balance_after:balance},movement:{id:kind==='undo'?'mov-undo':'mov-app',operation_id:op.operationId,kind,balance_after:balance},
  vial:{id:'vial-1',remaining_mg:balance}});
async function fixture(label,{scope='user:user-a'}={}){
  const name=dbName(label),time={value:Date.parse('2026-09-16T12:00:00Z')};
  const open=s=>openPepDayRepository({accountScope:s||scope,indexedDBFactory:indexedDB,databaseName:name,outboxOptions:{clock:()=>time.value,leaseMs:100}});
  const repository=await open();await repository.vials.put({id:'vial-1',name:'V',initialMg:10,remainingMg:10});
  const coordinator=createTabCoordinator({repository,locks:null,ownerId:`worker-${serial}`,clock:()=>time.value,leaseMs:1000,
    setIntervalFn:()=>1,clearIntervalFn:()=>{}});
  const engine=api=>createSyncEngine({repository,api,coordinator,clock:()=>time.value,online:()=>true,random:()=>0,
    windowTarget:null,documentTarget:null,setTimer:()=>1,clearTimer:()=>{}});
  return {name,time,repository,open,engine,async close(...extra){repository.close();extra.forEach(x=>x.close());await remove(name)}};
}

test('Application online confirma snapshots e saldo atomicamente; Undo dependente restaura saldo',async()=>{
  const f=await fixture('online'),a=application();await f.repository.outbox.enqueue(a);
  const api={send:async op=>confirmation(op),refreshSession:async()=>{}};await f.engine(api).start();
  assert.equal((await f.repository.outbox.get(a.operationId)).status,'synced');assert.equal((await f.repository.applications.list()).length,1);
  assert.equal((await f.repository.vialMovements.list()).length,1);assert.equal((await f.repository.vials.get('vial-1')).remainingMg,9);
  const u=undo('app-1',a.operationId);await f.repository.outbox.enqueue(u);
  api.send=async op=>confirmation(op,{balance:10,kind:'undo'});await f.engine(api).start();
  assert.equal((await f.repository.outbox.get(u.operationId)).status,'synced');assert.equal((await f.repository.vialMovements.list()).length,2);
  assert.equal((await f.repository.vials.get('vial-1')).remainingMg,10);await f.close();
});

test('UI cria intenções Application/Undo sem saldo otimista e mantém pré-requisitos recuperáveis',()=>{
  assert.match(appSource,/repository\.enqueueApplicationIntent\(\{operationId:crypto\.randomUUID\(\),routine,vial,scheduledDate\}\)/);
  assert.match(appSource,/repository\.enqueueUndoIntent\(\{operationId:crypto\.randomUUID\(\),application/);
  assert.match(appSource,/repository\.outbox\.resolvePrerequisites\(operation\.operationId/);
  assert.doesNotMatch(appSource,/Aplicações e Undo serão conectados/);
  const toggle=appSource.slice(appSource.indexOf('async function toggleDone'),appSource.indexOf('window.toggleDone'));
  assert.ok(toggle.indexOf('applicationIntentInFlight.add(key)')<toggle.indexOf('await requireLocalRepository()'));
  assert.doesNotMatch(toggle,/remainingMg\s*=|vialMovements\.put|applications\.put/);
});

test('repository cria uma única intenção funcional e Undo depende da Application confirmada',async()=>{
  const f=await fixture('functional-intent'),routine={id:'local-r',remoteRef:{status:'synced',id:'routine-1',versionId:'rv-1'}},
    vial=await f.repository.vials.get('vial-1');vial.remoteRef={status:'synced',id:'vial-1'};
  const applicationOperation=uuid();await f.repository.enqueueApplicationIntent({operationId:applicationOperation,routine,vial,scheduledDate:'2026-09-16'});
  assert.equal((await f.repository.outbox.list()).length,1);assert.deepEqual(await f.repository.confirmedCounts(),{applications:0,vialMovements:0});assert.equal((await f.repository.vials.get('vial-1')).remainingMg,10);
  await f.engine({send:async x=>confirmation(x),refreshSession:async()=>{}}).start();const confirmed=(await f.repository.applications.list())[0],undoOperation=uuid();
  await f.repository.enqueueUndoIntent({operationId:undoOperation,application:confirmed,localRoutineId:routine.id,localVialId:vial.id,scheduledDate:'2026-09-16'});
  const queued=await f.repository.outbox.get(undoOperation);assert.deepEqual(queued.dependencies,[applicationOperation]);assert.equal(queued.status,'pending');assert.equal((await f.repository.vials.get('vial-1')).remainingMg,9);await f.close();
});

test('offline antes do claim não incrementa tentativa nem altera saldo; reconexão dispara envio',async()=>{
  const f=await fixture('offline'),op=application();await f.repository.outbox.enqueue(op);let online=false,sends=0;
  const listeners={},target={addEventListener:(n,fn)=>listeners[n]=fn,removeEventListener:()=>{}};
  const engine=createSyncEngine({repository:f.repository,api:{send:async x=>{sends++;return confirmation(x)},refreshSession:async()=>{}},coordinator:createTabCoordinator({repository:f.repository,locks:null,ownerId:'w',setIntervalFn:()=>1,clearIntervalFn:()=>{}}),
    online:()=>online,windowTarget:target,documentTarget:null,setTimer:()=>1,clearTimer:()=>{}});
  await engine.start();assert.equal((await f.repository.outbox.get(op.operationId)).attemptCount,0);assert.equal(sends,0);
  online=true;await listeners.online();await new Promise(r=>setTimeout(r,0));assert.equal(sends,1);assert.equal((await f.repository.outbox.get(op.operationId)).status,'synced');await f.close();
});

test('falha de rede, 5xx e 429 preservam UUID e retry; Retry-After prevalece',async()=>{
  for(const [label,error,delay] of [['network',new SyncApiError('off',{status:0,code:'NETWORK'}),750],['server',new SyncApiError('x',{status:503,code:'HTTP_503'}),750],['rate',new SyncApiError('x',{status:429,code:'RATE',retryAfterMs:42000}),42000]]){
    const f=await fixture(label),op=application();await f.repository.outbox.enqueue(op);await f.engine({send:async()=>{throw error},refreshSession:async()=>{}}).start();
    const row=await f.repository.outbox.get(op.operationId);assert.equal(row.status,'pending');assert.equal(row.operationId,op.operationId);
    assert.equal(Date.parse(row.nextAttemptAt)-f.time.value,delay);await f.close();
  }
});

test('backoff exponencial com jitter nunca ultrapassa cinco minutos',async()=>{
  const f=await fixture('backoff-cap'),op=application();await f.repository.outbox.enqueue(op);
  for(let attempt=0;attempt<12;attempt++){
    const coordinator=createTabCoordinator({repository:f.repository,locks:null,ownerId:`cap-${attempt}`,clock:()=>f.time.value,setIntervalFn:()=>1,clearIntervalFn:()=>{}});
    await createSyncEngine({repository:f.repository,api:{send:async()=>{throw new SyncApiError('5xx',{status:503})},refreshSession:async()=>{}},coordinator,
      clock:()=>f.time.value,online:()=>true,random:()=>1,windowTarget:null,documentTarget:null,setTimer:()=>1,clearTimer:()=>{}}).start();
    const row=await f.repository.outbox.get(op.operationId),delay=Date.parse(row.nextAttemptAt)-f.time.value;assert.ok(delay<=300000);f.time.value=Date.parse(row.nextAttemptAt);
  }
  await f.close();
});

test('401 renova uma vez e reenvia mesmo UUID; falha de refresh pausa preservando operação',async()=>{
  const f=await fixture('auth'),op=application();await f.repository.outbox.enqueue(op);let sends=0,refreshes=0;
  await f.engine({send:async x=>{if(++sends===1)throw new SyncApiError('401',{status:401});return confirmation(x)},refreshSession:async()=>{refreshes++}}).start();
  assert.equal(refreshes,1);assert.equal(sends,2);assert.equal((await f.repository.outbox.get(op.operationId)).status,'synced');
  const second=application();await f.repository.outbox.enqueue(second);const engine=f.engine({send:async()=>{throw new SyncApiError('401',{status:401})},refreshSession:async()=>{throw new SyncApiError('expired',{status:401})}});
  await engine.start();assert.equal(engine.paused,true);assert.equal((await f.repository.outbox.get(second.operationId)).status,'pending');await f.close();
});

test('403 pausa sem apagar; conflito e validação 4xx tornam estados terminais corretos',async()=>{
  for(const [label,error,status,paused] of [['forbidden',new SyncApiError('pro',{status:403,code:'ENTITLEMENT'}),'pending',true],['conflict',new SyncApiError('conflito',{status:409,code:'P0001'}),'conflict',false],['invalid',new SyncApiError('inválido',{status:422,code:'VALIDATION'}),'failed',false]]){
    const f=await fixture(label),op=application();await f.repository.outbox.enqueue(op);const engine=f.engine({send:async()=>{throw error},refreshSession:async()=>{}});await engine.start();
    assert.equal((await f.repository.outbox.get(op.operationId)).status,status);assert.equal(engine.paused,paused);await f.close();
  }
});

test('resposta perdida e replay com mesmo UUID convergem sem duplicar snapshots',async()=>{
  const f=await fixture('replay'),op=application();await f.repository.outbox.enqueue(op);let calls=0;
  const api={send:async x=>{if(++calls===1)throw new SyncApiError('lost',{status:0,code:'LOST'});return confirmation(x,{replay:true})},refreshSession:async()=>{}};
  await f.engine(api).start();f.time.value+=1000;await f.engine(api).start();
  assert.equal((await f.repository.outbox.get(op.operationId)).transportReplay,true);assert.equal((await f.repository.applications.list()).length,1);assert.equal((await f.repository.vialMovements.list()).length,1);await f.close();
});

test('Undo offline permanece pending sem saldo otimista; replay é sucesso e outro UUID vira conflict',async()=>{
  const f=await fixture('undo-offline'),a=application();await f.repository.outbox.enqueue(a);await f.engine({send:async x=>confirmation(x),refreshSession:async()=>{}}).start();
  const u=undo('app-1',a.operationId);await f.repository.outbox.enqueue(u);
  const offline=createSyncEngine({repository:f.repository,api:{send:async()=>{throw new Error('não envia')},refreshSession:async()=>{}},coordinator:createTabCoordinator({repository:f.repository,locks:null,ownerId:'undo-offline',setIntervalFn:()=>1,clearIntervalFn:()=>{}}),online:()=>false,windowTarget:null,documentTarget:null,setTimer:()=>1,clearTimer:()=>{}});
  await offline.start();assert.equal((await f.repository.outbox.get(u.operationId)).status,'pending');assert.equal((await f.repository.vials.get('vial-1')).remainingMg,9);
  await f.engine({send:async x=>confirmation(x,{replay:true,balance:10,kind:'undo'}),refreshSession:async()=>{}}).start();assert.equal((await f.repository.outbox.get(u.operationId)).transportReplay,true);
  const second=undo('app-1',u.operationId);await f.repository.outbox.enqueue(second);await f.engine({send:async()=>{throw new SyncApiError('já foi desfeita',{status:409,code:'P0001'})},refreshSession:async()=>{}}).start();
  assert.equal((await f.repository.outbox.get(second.operationId)).status,'conflict');assert.equal((await f.repository.vials.get('vial-1')).remainingMg,10);await f.close();
});

test('Undo com resposta perdida converge por replay para exatamente dois movimentos',async()=>{
  const f=await fixture('undo-cardinality'),a=application();await f.repository.outbox.enqueue(a);await f.engine({send:async x=>confirmation(x),refreshSession:async()=>{}}).start();
  const u=undo('app-1',a.operationId);await f.repository.outbox.enqueue(u);let calls=0;
  const api={send:async x=>{if(++calls===1)throw new SyncApiError('lost',{status:0,code:'LOST'});return confirmation(x,{replay:true,balance:10,kind:'undo'})},refreshSession:async()=>{}};
  await f.engine(api).start();f.time.value+=1000;await f.engine(api).start();
  const applications=await f.repository.applications.list(),movements=await f.repository.vialMovements.list();
  assert.equal(applications.length,1);assert.equal(movements.filter(x=>x.kind==='application').length,1);assert.equal(movements.filter(x=>x.kind==='undo').length,1);
  assert.equal((await f.repository.vials.get('vial-1')).remainingMg,10);await f.engine(api).start();assert.equal((await f.repository.vialMovements.list()).length,2);await f.close();
});

test('intenção aguarda pré-requisitos remotos e depois prossegue com o mesmo UUID',async()=>{
  const f=await fixture('prerequisites'),operationId=uuid(),routine={id:'local-r'},vial={id:'vial-1'};
  await f.repository.enqueueApplicationIntent({operationId,routine,vial,scheduledDate:'2026-09-16'});let sends=0;await f.engine({send:async x=>{sends++;return confirmation(x)},refreshSession:async()=>{}}).start();
  let row=await f.repository.outbox.get(operationId);assert.equal(sends,0);assert.equal(row.status,'pending');assert.equal(row.attemptCount,0);
  row=await f.repository.outbox.resolvePrerequisites(operationId,{payload:{...row.payload,routineId:'routine-1',routineVersionId:'rv-1',vialId:'vial-1'}});
  await f.engine({send:async x=>{sends++;assert.equal(x.operationId,operationId);return confirmation(x)},refreshSession:async()=>{}}).start();
  assert.equal(sends,1);assert.equal((await f.repository.outbox.get(operationId)).status,'synced');await f.close();
});

test('confirmação remota atualiza IDs locais sem fabricar Rotina ou Frasco duplicado',async()=>{
  const f=await fixture('local-remote-map'),op=application({payload:{...application().payload,localRoutineId:'local-routine',localVialId:'vial-1',routineId:'remote-routine',routineVersionId:'remote-version',vialId:'remote-vial'}});
  await f.repository.outbox.enqueue(op);await f.engine({send:async x=>{const result=confirmation(x);result.application.routine_id='remote-routine';result.application.scheduled_date='2026-09-16';result.vial.id='remote-vial';return result},refreshSession:async()=>{}}).start();
  const apps=await f.repository.applications.list(),vials=await f.repository.vials.list();assert.equal(apps[0].localRoutineId,'local-routine');assert.equal(vials.length,1);
  assert.equal(vials[0].id,'vial-1');assert.deepEqual(vials[0].remoteRef,{status:'synced',id:'remote-vial'});assert.equal(vials[0].remainingMg,9);await f.close();
});

test('antes da resposta remota não há saldo, Application ou movimento otimista',async()=>{
  const f=await fixture('no-optimism'),op=application();await f.repository.outbox.enqueue(op);let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  const running=f.engine({send:async x=>{entered();await gate;return confirmation(x)},refreshSession:async()=>{}}).start();await started;
  assert.equal((await f.repository.vials.get('vial-1')).remainingMg,10);assert.deepEqual(await f.repository.confirmedCounts(),{applications:0,vialMovements:0});
  release();await running;assert.deepEqual(await f.repository.confirmedCounts(),{applications:1,vialMovements:1});await f.close();
});

test('confirmação local é atômica: DataCloneError intermediário não deixa snapshot parcial',async()=>{
  const f=await fixture('atomic'),op=application();await f.repository.outbox.enqueue(op);const claimed=await f.repository.outbox.claimNext({workerId:'atomic',allowedTypes:['application']});
  const bad=confirmation(claimed);bad.movement.invalid=()=>{};
  await assert.rejects(f.repository.persistRemoteConfirmation({accountScope:f.repository.accountScope,operationId:op.operationId,workerId:'atomic',response:bad}),error=>error.name==='DataCloneError');
  assert.deepEqual(await f.repository.confirmedCounts(),{applications:0,vialMovements:0});assert.equal((await f.repository.vials.get('vial-1')).remainingMg,10);assert.equal((await f.repository.outbox.get(op.operationId)).status,'syncing');await f.close();
});

test('resposta após lease expirado não grava; novo worker repara por replay sem duplicação',async()=>{
  const f=await fixture('expired-confirmation'),op=application();await f.repository.outbox.enqueue(op);
  const claimed=await f.repository.outbox.claimNext({workerId:'old',leaseDurationMs:10});f.time.value+=11;
  await assert.rejects(f.repository.persistRemoteConfirmation({accountScope:f.repository.accountScope,operationId:op.operationId,workerId:'old',response:confirmation(claimed)}),error=>error.code==='LEASE_EXPIRED');
  assert.deepEqual(await f.repository.confirmedCounts(),{applications:0,vialMovements:0});assert.equal((await f.repository.vials.get('vial-1')).remainingMg,10);
  const coordinator=createTabCoordinator({repository:f.repository,locks:null,ownerId:'new',clock:()=>f.time.value,setIntervalFn:()=>1,clearIntervalFn:()=>{}});
  await createSyncEngine({repository:f.repository,api:{send:async x=>confirmation(x,{replay:true}),refreshSession:async()=>{}},coordinator,clock:()=>f.time.value,online:()=>true,windowTarget:null,documentTarget:null,setTimer:()=>1,clearTimer:()=>{}}).start();
  assert.equal((await f.repository.outbox.get(op.operationId)).transportReplay,true);assert.deepEqual(await f.repository.confirmedCounts(),{applications:1,vialMovements:1});assert.equal((await f.repository.vials.get('vial-1')).remainingMg,9);await f.close();
});

test('reload durante syncing recupera lease e reenvia exatamente o mesmo UUID',async()=>{
  const f=await fixture('reload-syncing'),op=application();await f.repository.outbox.enqueue(op);await f.repository.outbox.claimNext({workerId:'dead',leaseDurationMs:10});
  const reload=await f.open();f.time.value+=11;let seen;
  const coordinator=createTabCoordinator({repository:reload,locks:null,ownerId:'reload',clock:()=>f.time.value,setIntervalFn:()=>1,clearIntervalFn:()=>{}});
  await createSyncEngine({repository:reload,api:{send:async x=>{seen=x.operationId;return confirmation(x,{replay:true})},refreshSession:async()=>{}},coordinator,clock:()=>f.time.value,online:()=>true,windowTarget:null,documentTarget:null,setTimer:()=>1,clearTimer:()=>{}}).start();
  assert.equal(seen,op.operationId);assert.equal((await reload.outbox.get(op.operationId)).status,'synced');await f.close(reload);
});

test('falha local após sucesso remoto deixa syncing; lease expirado repara por replay atomicamente',async()=>{
  const f=await fixture('local-fail'),op=application();await f.repository.outbox.enqueue(op);let persist=f.repository.persistRemoteConfirmation,calls=0;
  const proxy={...f.repository,get accountScope(){return f.repository.accountScope},persistRemoteConfirmation:async args=>{if(++calls===1)throw Object.assign(new Error('quota'),{name:'QuotaExceededError'});return persist.call(f.repository,args)}};
  const coordinator=createTabCoordinator({repository:proxy,locks:null,ownerId:'repair',clock:()=>f.time.value,leaseMs:100,setIntervalFn:()=>1,clearIntervalFn:()=>{}});
  const engine=()=>createSyncEngine({repository:proxy,api:{send:async x=>confirmation(x,{replay:calls>0}),refreshSession:async()=>{}},coordinator,clock:()=>f.time.value,online:()=>true,windowTarget:null,documentTarget:null,setTimer:()=>1,clearTimer:()=>{}});
  const failed=await engine().start();assert.match(failed.error.message,/quota/);assert.equal((await f.repository.outbox.get(op.operationId)).status,'syncing');
  const reload=await f.open();f.time.value+=101;
  const reloadCoordinator=createTabCoordinator({repository:reload,locks:null,ownerId:'repair-reload',clock:()=>f.time.value,leaseMs:100,setIntervalFn:()=>1,clearIntervalFn:()=>{}});
  await createSyncEngine({repository:reload,api:{send:async x=>confirmation(x,{replay:true}),refreshSession:async()=>{}},coordinator:reloadCoordinator,clock:()=>f.time.value,online:()=>true,windowTarget:null,documentTarget:null,setTimer:()=>1,clearTimer:()=>{}}).start();
  assert.equal((await reload.outbox.get(op.operationId)).status,'synced');assert.equal((await reload.applications.list()).length,1);await f.close(reload);
});

test('duas abas elegem um líder e não enviam a mesma operação duas vezes',async()=>{
  const f=await fixture('leader'),other=await f.open(),op=application();await f.repository.outbox.enqueue(op);let sends=0;
  const api={send:async x=>{sends++;await new Promise(r=>setTimeout(r,5));return confirmation(x)},refreshSession:async()=>{}};
  const make=(repo,id)=>createSyncEngine({repository:repo,api,coordinator:createTabCoordinator({repository:repo,locks:null,ownerId:id,leaseMs:1000,setIntervalFn:()=>1,clearIntervalFn:()=>{}}),online:()=>true,windowTarget:null,documentTarget:null,setTimer:()=>1,clearTimer:()=>{}});
  await Promise.all([make(f.repository,'a').start(),make(other,'b').start()]);assert.equal(sends,1);assert.equal((await f.repository.outbox.get(op.operationId)).status,'synced');await f.close(other);
});

test('Web Locks elege um líder, impede envio simultâneo e libera o próximo',async()=>{
  const f=await fixture('web-locks'),other=await f.open(),first=application(),second=application({entityId:'planned-2',payload:{...application().payload,scheduledDate:'2026-09-17'}});await f.repository.outbox.enqueue(first);
  let locked=false,sends=0,simultaneous=0,maxSimultaneous=0;
  const locks={async request(name,options,callback){if(locked)return callback(null);locked=true;try{return await callback({name})}finally{locked=false}}};
  const api={send:async x=>{sends++;simultaneous++;maxSimultaneous=Math.max(maxSimultaneous,simultaneous);await new Promise(r=>setTimeout(r,5));simultaneous--;return confirmation(x)},refreshSession:async()=>{}};
  const make=(repo,id)=>createSyncEngine({repository:repo,api,coordinator:createTabCoordinator({repository:repo,locks,ownerId:id}),online:()=>true,windowTarget:null,documentTarget:null,setTimer:()=>1,clearTimer:()=>{}});
  const a=make(f.repository,'web-a'),b=make(other,'web-b');await Promise.all([a.start(),b.start()]);assert.equal(sends,1);assert.equal(maxSimultaneous,1);
  await f.repository.outbox.enqueue(second);await b.trigger();assert.equal(sends,2);assert.equal((await f.repository.outbox.get(second.operationId)).status,'synced');await f.close(other);
});

test('logout/troca de conta invalida resposta tardia e mantém isolamento',async()=>{
  const f=await fixture('scope'),op=application();await f.repository.outbox.enqueue(op);let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  const engine=f.engine({send:async x=>{entered();await gate;return confirmation(x)},refreshSession:async()=>{}}),running=engine.start();await started;
  f.repository.setAccountScope('user:user-b');engine.stop();release();await running;
  assert.equal((await f.repository.applications.list()).length,0);f.repository.setAccountScope('user:user-a');assert.equal((await f.repository.outbox.get(op.operationId)).status,'syncing');await f.close();
});

test('logout durante envio não grava em device e login posterior repara a conta original',async()=>{
  const f=await fixture('logout'),op=application();await f.repository.outbox.enqueue(op);let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  const engine=f.engine({send:async x=>{entered();await gate;return confirmation(x)},refreshSession:async()=>{}}),running=engine.start();await started;
  engine.stop();f.repository.setAccountScope('device:installation');release();await running;
  assert.deepEqual(await f.repository.confirmedCounts(),{applications:0,vialMovements:0});assert.equal((await f.repository.outbox.list()).length,0);
  f.repository.setAccountScope('user:user-a');assert.equal((await f.repository.outbox.get(op.operationId)).status,'syncing');f.time.value+=101;
  const coordinator=createTabCoordinator({repository:f.repository,locks:null,ownerId:'after-login',clock:()=>f.time.value,setIntervalFn:()=>1,clearIntervalFn:()=>{}});
  await createSyncEngine({repository:f.repository,api:{send:async x=>confirmation(x,{replay:true}),refreshSession:async()=>{}},coordinator,clock:()=>f.time.value,online:()=>true,windowTarget:null,documentTarget:null,setTimer:()=>1,clearTimer:()=>{}}).start();
  assert.equal((await f.repository.outbox.get(op.operationId)).status,'synced');assert.deepEqual(await f.repository.confirmedCounts(),{applications:1,vialMovements:1});await f.close();
});

test('tipos Rotina/Frasco permanecem pending no B2.2-C',async()=>{
  const f=await fixture('types');for(const type of ['create','edit'])await f.repository.outbox.enqueue({operationId:uuid(),type,entityType:type==='create'?'routine':'vial',entityId:type,payload:{},dependencies:[]});
  await f.engine({send:async()=>{throw new Error('não deve enviar')},refreshSession:async()=>{}}).start();assert.deepEqual((await f.repository.outbox.list()).map(x=>x.status),['pending','pending']);await f.close();
});

test('sync-api usa HTTP bruto, JWT da sessão e mesmo operationId sem expor credenciais',async()=>{
  const calls=[],fetchImpl=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({replay:false,application:{id:'a'},movement:{id:'m'},vial:{id:'v',remaining_mg:1}}),{status:200,headers:{'Content-Type':'application/json'}})};
  const api=createSyncApi({client:authClient(),config:publicConfig,fetchImpl}),a=application();await api.send(a);const u=undo('a',a.operationId);await api.send(u);
  assert.match(calls[0].url,/\/rpc\/register_application$/);assert.equal(JSON.parse(calls[0].options.body).p_operation_id,a.operationId);
  assert.match(calls[1].url,/\/rpc\/undo_application$/);assert.equal(JSON.parse(calls[1].options.body).p_operation_id,u.operationId);
  assert.equal(calls[0].options.headers.Authorization,'Bearer test-token');assert.equal(calls[0].options.headers.apikey,publicConfig.supabasePublishableKey);
  const bad=createSyncApi({client:authClient(),config:publicConfig,fetchImpl:async()=>new Response('{}',{status:200,headers:{'Content-Type':'application/json'}})});
  await assert.rejects(bad.send(a),error=>error.code==='INVALID_RPC_RESPONSE');
});

test('429 realista respeita Retry-After em segundos e data HTTP; inválido usa backoff local',async()=>{
  const now=Date.parse('2026-09-16T12:00:00Z'),op=application();
  for(const [header,expected] of [['42',42000],[new Date(now+60000).toUTCString(),60000],['inválido',null]]){
    const api=createSyncApi({client:authClient(),config:publicConfig,clock:()=>now,fetchImpl:async()=>new Response(JSON.stringify({code:'RATE',message:'limite'}),{status:429,headers:{'Content-Type':'application/json','Retry-After':header}})});
    await assert.rejects(api.send(op),error=>error.status===429&&error.retryAfterMs===expected);
  }
  assert.equal(parseRetryAfter('2',now),2000);assert.equal(parseRetryAfter('inválido',now),null);
});

test('visibilidade e foco disparam retomada sem usar online como confirmação',async()=>{
  const f=await fixture('events'),op=application();await f.repository.outbox.enqueue(op);let online=false,sends=0;const w={},d={visibilityState:'hidden'};
  const wt={addEventListener:(n,fn)=>w[n]=fn,removeEventListener:()=>{}},dt={addEventListener:(n,fn)=>d[n]=fn,removeEventListener:()=>{},visibilityState:'hidden'};
  const engine=createSyncEngine({repository:f.repository,api:{send:async x=>{sends++;return confirmation(x)},refreshSession:async()=>{}},coordinator:createTabCoordinator({repository:f.repository,locks:null,ownerId:'events',setIntervalFn:()=>1,clearIntervalFn:()=>{}}),online:()=>online,windowTarget:wt,documentTarget:dt,setTimer:()=>1,clearTimer:()=>{}});
  await engine.start();online=true;await w.focus();await new Promise(r=>setTimeout(r,0));assert.equal(sends,1);await f.close();
});
