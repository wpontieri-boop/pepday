import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { openPepDayRepository } from '../src/pepday-repository.mjs';
import { createMockTransport, OUTBOX_STATUSES } from '../src/sync-outbox.mjs';

let serial=0;
const op=()=>`00000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`;
const dbName=label=>`pepday-b22b-${label}-${Date.now()}-${++serial}`;
const intent=(overrides={})=>({operationId:op(),type:'edit',entityType:'vial',entityId:'vial-1',
  payload:{name:'Frasco'},baseVersion:1,dependencies:[],...overrides});
const removeDb=name=>new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(name);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error)});
async function fixture(label,{scope='user:alpha',now=Date.parse('2026-09-15T12:00:00Z')}={}){
  const name=dbName(label),time={value:now};
  const open=accountScope=>openPepDayRepository({accountScope,indexedDBFactory:indexedDB,databaseName:name,
    outboxOptions:{clock:()=>time.value,leaseMs:1000,baseBackoffMs:100}});
  const repository=await open(scope);
  return {name,time,repository,open,async close(...repositories){for(const item of [repository,...repositories])item?.close();await removeDb(name)}};
}

test('cria pending completo e preserva UUID, payload, sequência e tentativas após reload',async()=>{
  const f=await fixture('pending'),input=intent(),created=await f.repository.outbox.enqueue(input);
  assert.equal(created.operation.status,'pending');assert.equal(created.operation.operationId,input.operationId);
  assert.equal(created.operation.sequence,1);assert.equal(created.operation.attemptCount,0);
  assert.deepEqual(OUTBOX_STATUSES,['pending','syncing','synced','failed','conflict']);
  const reload=await f.open('user:alpha'),rows=await reload.outbox.list();
  assert.equal(rows.length,1);assert.equal(rows[0].operationId,input.operationId);assert.deepEqual(rows[0].payload,input.payload);
  await f.close(reload);
});

test('mesmo operationId deduplica, retry reutiliza entrada e intenção diferente conflita',async()=>{
  const f=await fixture('dedupe'),input=intent();await f.repository.outbox.enqueue(input);
  const replay=await f.repository.outbox.enqueue(input);assert.equal(replay.deduplicated,true);assert.equal((await f.repository.outbox.list()).length,1);
  await assert.rejects(f.repository.outbox.enqueue({...input,payload:{name:'outra'}}),error=>error.code==='OPERATION_ID_CONFLICT');
  await f.close();
});

test('FIFO é preservado entre operações elegíveis do mesmo escopo',async()=>{
  const f=await fixture('fifo'),a=intent({entityId:'a'}),b=intent({entityId:'b'});await f.repository.outbox.enqueue(a);await f.repository.outbox.enqueue(b);
  const first=await f.repository.outbox.claimNext({workerId:'w'});assert.equal(first.operationId,a.operationId);
  await f.repository.outbox.settle(a.operationId,{workerId:'w',outcome:'success',transportConfirmed:true});
  assert.equal((await f.repository.outbox.claimNext({workerId:'w'})).operationId,b.operationId);await f.close();
});

test('dependência bloqueia até confirmação e operação independente não fica presa',async()=>{
  const f=await fixture('dependency'),parent=intent({entityId:'parent'}),child=intent({entityId:'child'}),free=intent({entityId:'free'});
  await f.repository.outbox.enqueue(parent);await f.repository.outbox.enqueue({...child,dependencies:[parent.operationId]});await f.repository.outbox.enqueue(free);
  const claimed=await f.repository.outbox.claimNext({workerId:'w'});assert.equal(claimed.operationId,parent.operationId);
  const independent=await f.repository.outbox.claimNext({workerId:'w2'});assert.equal(independent.operationId,free.operationId);
  await f.repository.outbox.settle(parent.operationId,{workerId:'w',outcome:'success',transportConfirmed:true});
  await f.repository.outbox.settle(free.operationId,{workerId:'w2',outcome:'permanent'});
  assert.equal((await f.repository.outbox.claimNext({workerId:'w3'})).operationId,child.operationId);await f.close();
});

test('lease impede dois workers e duas abas de possuírem a mesma operação',async()=>{
  const f=await fixture('lease'),second=await f.open('user:alpha'),input=intent();await f.repository.outbox.enqueue(input);
  const claims=await Promise.all([f.repository.outbox.claimNext({workerId:'a'}),second.outbox.claimNext({workerId:'b'})]);
  assert.equal(claims.filter(Boolean).length,1);assert.equal(claims.find(Boolean).operationId,input.operationId);await f.close(second);
});

test('lease expirado recupera syncing e reload mantém tentativa/UUID',async()=>{
  const f=await fixture('expired'),input=intent();await f.repository.outbox.enqueue(input);
  await f.repository.outbox.claimNext({workerId:'old',leaseDurationMs:50});
  const reload=await f.open('user:alpha');assert.equal((await reload.outbox.get(input.operationId)).status,'syncing');
  f.time.value+=51;const recovered=await reload.outbox.claimNext({workerId:'new'});
  assert.equal(recovered.operationId,input.operationId);assert.equal(recovered.attemptCount,2);assert.equal(recovered.leaseOwner,'new');await f.close(reload);
});

test('worker antigo não conclui operação depois de seu lease expirar',async()=>{
  const f=await fixture('stale-worker'),input=intent();await f.repository.outbox.enqueue(input);
  await f.repository.outbox.claimNext({workerId:'old',leaseDurationMs:10});f.time.value+=11;
  await assert.rejects(f.repository.outbox.settle(input.operationId,{workerId:'old',outcome:'success',transportConfirmed:true}),error=>error.code==='LEASE_EXPIRED');
  const recovered=await f.repository.outbox.claimNext({workerId:'new'});assert.equal(recovered.leaseOwner,'new');await f.close();
});

test('falha temporária preserva pending; conflito e erro definitivo são terminais visíveis',async()=>{
  const f=await fixture('failures');
  for(const [outcome,status] of [['temporary','pending'],['conflict','conflict'],['permanent','failed']]){
    const input=intent({entityId:outcome});await f.repository.outbox.enqueue(input);await f.repository.outbox.claimNext({workerId:outcome});
    const row=await f.repository.outbox.settle(input.operationId,{workerId:outcome,outcome,retryAfterMs:1000});assert.equal(row.status,status);
  }
  assert.equal((await f.repository.outbox.list()).length,3);await f.close();
});

test('synced exige confirmação explícita do transporte',async()=>{
  const f=await fixture('confirm'),input=intent();await f.repository.outbox.enqueue(input);await f.repository.outbox.claimNext({workerId:'w'});
  await assert.rejects(f.repository.outbox.settle(input.operationId,{workerId:'w',outcome:'success'}),error=>error.code==='TRANSPORT_CONFIRMATION_REQUIRED');
  assert.equal((await f.repository.outbox.get(input.operationId)).status,'syncing');
  assert.equal((await f.repository.outbox.settle(input.operationId,{workerId:'w',outcome:'success',transportConfirmed:true})).status,'synced');await f.close();
});

test('resposta perdida retorna pending e replay usa o mesmo UUID sem duplicar',async()=>{
  const f=await fixture('lost'),input=intent(),transport=createMockTransport({behaviors:{[input.operationId]:'lost-response'}});await f.repository.outbox.enqueue(input);
  const lost=await f.repository.outbox.processNext({workerId:'w',transport});assert.equal(lost.operation.status,'pending');assert.equal(lost.operation.operationId,input.operationId);
  f.time.value+=100;const replay=await f.repository.outbox.processNext({workerId:'w',transport});
  assert.equal(replay.operation.status,'synced');assert.equal(replay.response.replay,true);assert.equal((await f.repository.outbox.list()).length,1);await f.close();
});

test('outbox fica isolada entre duas contas no mesmo banco',async()=>{
  const f=await fixture('scope'),other=await f.open('user:beta');await f.repository.outbox.enqueue(intent({entityId:'alpha'}));
  assert.equal((await other.outbox.list()).length,0);await other.outbox.enqueue(intent({entityId:'beta'}));
  assert.equal((await f.repository.outbox.list()).length,1);assert.equal((await other.outbox.list()).length,1);await f.close(other);
});

test('create + edit pendentes consolidam com dedupe durável; sincronizada nunca compacta',async()=>{
  const f=await fixture('compact'),create=intent({type:'create',entityId:'new',payload:{name:'A'},baseVersion:null}),edit=intent({type:'edit',entityId:'new',payload:{name:'B'}});
  await f.repository.outbox.enqueue(create);const compacted=await f.repository.outbox.enqueue(edit);
  assert.equal(compacted.compacted,true);assert.equal(compacted.operation.operationId,create.operationId);assert.deepEqual(compacted.operation.payload,{name:'B'});
  assert.equal((await f.repository.outbox.enqueue(edit)).deduplicated,true);assert.equal((await f.repository.outbox.list()).length,1);
  await f.repository.outbox.claimNext({workerId:'w'});await f.repository.outbox.settle(create.operationId,{workerId:'w',outcome:'success',transportConfirmed:true});
  await f.repository.outbox.enqueue(intent({type:'edit',entityId:'new',payload:{name:'C'}}));assert.equal((await f.repository.outbox.list()).length,2);await f.close();
});

test('create + delete só cancela sem dependentes e cancellation receipt deduplica reload',async()=>{
  const f=await fixture('cancel'),create=intent({type:'create',entityId:'new',baseVersion:null}),remove=intent({type:'delete',entityId:'new',payload:null});
  await f.repository.outbox.enqueue(create);const canceled=await f.repository.outbox.enqueue(remove);assert.equal(canceled.canceled,true);assert.equal((await f.repository.outbox.list()).length,0);
  const reload=await f.open('user:alpha'),retry=await reload.outbox.enqueue(remove);assert.equal(retry.canceled,true);assert.equal(retry.deduplicated,true);await f.close(reload);
});

test('dependente impede cancelamento create + delete',async()=>{
  const f=await fixture('cancel-block'),create=intent({type:'create',entityId:'new',baseVersion:null});await f.repository.outbox.enqueue(create);
  const application=intent({type:'application',entityType:'application',entityId:'app',dependencies:[create.operationId]});await f.repository.outbox.enqueue(application);
  await f.repository.outbox.enqueue(intent({type:'delete',entityId:'new',payload:null,dependencies:[create.operationId]}));
  assert.equal((await f.repository.outbox.list()).length,3);await f.close();
});

test('Application e Undo não compactam, preservam ordem/dependência e não fabricam eventos ou saldo',async()=>{
  const f=await fixture('clinical');const vial={id:'vial-1',initialMg:10,remainingMg:8};await f.repository.vials.put(vial);
  const application=intent({type:'application',entityType:'application',entityId:'app-1',payload:{doseMg:1},baseVersion:null});
  const undo=intent({type:'undo',entityType:'application',entityId:'app-1',payload:{applicationOperationId:application.operationId},baseVersion:null,dependencies:[application.operationId]});
  await f.repository.outbox.enqueue(application);await f.repository.outbox.enqueue(undo);
  assert.deepEqual((await f.repository.outbox.list()).map(row=>row.type),['application','undo']);
  const transport=createMockTransport();await f.repository.outbox.processNext({workerId:'w',transport});await f.repository.outbox.processNext({workerId:'w',transport});
  assert.deepEqual(await f.repository.confirmedCounts(),{applications:0,vialMovements:0});assert.equal((await f.repository.vials.get(vial.id)).remainingMg,8);await f.close();
});

test('dependência própria/circular e dependência ausente são recusadas sem perder operações',async()=>{
  const f=await fixture('cycles'),id=op();
  await assert.rejects(f.repository.outbox.enqueue(intent({operationId:id,dependencies:[id]})),error=>error.code==='CIRCULAR_DEPENDENCY');
  await assert.rejects(f.repository.outbox.enqueue(intent({dependencies:[op()]})),error=>error.code==='MISSING_DEPENDENCY');
  assert.equal((await f.repository.outbox.list()).length,0);await f.close();
});

test('gravação de entidade + outbox é atômica e rollback remove escrita parcial',async()=>{
  const f=await fixture('atomic'),vial={id:'vial-atomic',initialMg:10,remainingMg:10};
  const saved=await f.repository.saveVialWithOutbox(vial,{operationId:op(),type:'create'});
  assert.deepEqual(saved.entity,vial);assert.equal((await f.repository.outbox.list()).length,1);
  await assert.rejects(f.repository.saveVialWithOutbox({...vial,name:'não deve persistir'},{operationId:'uuid-inválido',type:'edit'}),error=>error.code==='INVALID_OPERATION_ID');
  assert.equal((await f.repository.vials.get(vial.id)).name,undefined);assert.equal((await f.repository.outbox.list()).length,1);await f.close();
});

test('UI repository cria intenção atômica sem mudar saldo por processamento da fila',async()=>{
  const f=await fixture('entity-flow'),vial={id:'vial-ui',initialMg:10,remainingMg:6};
  await f.repository.saveVialWithOutbox(vial,{operationId:op(),type:'create'});const before=(await f.repository.vials.get(vial.id)).remainingMg;
  const queued=(await f.repository.outbox.list())[0],transport=createMockTransport();await f.repository.outbox.processNext({workerId:'w',transport});
  assert.equal((await f.repository.vials.get(vial.id)).remainingMg,before);assert.equal((await f.repository.outbox.get(queued.operationId)).status,'synced');
  assert.deepEqual(await f.repository.confirmedCounts(),{applications:0,vialMovements:0});await f.close();
});

test('Application isolada altera somente a outbox, sem evento confirmado, movimento ou saldo',async()=>{
  const f=await fixture('application-only'),vial={id:'vial-application',initialMg:10,remainingMg:7};
  await f.repository.vials.put(vial);
  const application=intent({type:'application',entityType:'application',entityId:'app-only',
    payload:{vialId:vial.id,doseMg:1},baseVersion:null});
  await f.repository.outbox.enqueue(application);
  assert.deepEqual(await f.repository.confirmedCounts(),{applications:0,vialMovements:0});
  const before=await f.repository.vials.get(vial.id);
  await f.repository.outbox.processNext({workerId:'application-worker',transport:createMockTransport()});
  assert.equal((await f.repository.outbox.get(application.operationId)).status,'synced');
  assert.deepEqual(await f.repository.confirmedCounts(),{applications:0,vialMovements:0});
  assert.equal((await f.repository.vials.get(vial.id)).remainingMg,before.remainingMg);
  await f.close();
});

test('Undo isolado altera somente a outbox, sem movimento inverso, aplicação ou saldo',async()=>{
  const f=await fixture('undo-only'),vial={id:'vial-undo',initialMg:10,remainingMg:6};
  await f.repository.vials.put(vial);
  const transport=createMockTransport();
  const application=intent({type:'application',entityType:'application',entityId:'app-for-undo',
    payload:{vialId:vial.id,doseMg:1},baseVersion:null});
  await f.repository.outbox.enqueue(application);
  await f.repository.outbox.processNext({workerId:'prepare-worker',transport});
  const beforeCounts=await f.repository.confirmedCounts(),beforeVial=await f.repository.vials.get(vial.id);
  const undo=intent({type:'undo',entityType:'application',entityId:'app-for-undo',payload:{applicationOperationId:application.operationId},
    baseVersion:null,dependencies:[application.operationId]});
  await f.repository.outbox.enqueue(undo);
  await f.repository.outbox.processNext({workerId:'undo-worker',transport});
  assert.equal((await f.repository.outbox.get(undo.operationId)).status,'synced');
  assert.deepEqual(await f.repository.confirmedCounts(),beforeCounts);
  assert.deepEqual(beforeCounts,{applications:0,vialMovements:0});
  assert.equal((await f.repository.vials.get(vial.id)).remainingMg,beforeVial.remainingMg);
  await f.close();
});

test('conflict é terminal e não volta a ser reclamado',async()=>{
  const f=await fixture('conflict-terminal'),input=intent();
  await f.repository.outbox.enqueue(input);await f.repository.outbox.claimNext({workerId:'first'});
  await f.repository.outbox.settle(input.operationId,{workerId:'first',outcome:'conflict'});
  f.time.value+=60000;
  assert.equal(await f.repository.outbox.claimNext({workerId:'second'}),null);
  assert.equal((await f.repository.outbox.get(input.operationId)).status,'conflict');
  await f.close();
});

test('synced permanece terminal após recovery, novo claim e reload',async()=>{
  const f=await fixture('synced-terminal'),input=intent();
  await f.repository.outbox.enqueue(input);await f.repository.outbox.claimNext({workerId:'first'});
  await f.repository.outbox.settle(input.operationId,{workerId:'first',outcome:'success',transportConfirmed:true});
  f.time.value+=60000;assert.equal(await f.repository.outbox.claimNext({workerId:'second'}),null);
  const reload=await f.open('user:alpha');assert.equal(await reload.outbox.claimNext({workerId:'reload'}),null);
  const persisted=await reload.outbox.get(input.operationId);assert.equal(persisted.status,'synced');assert.equal(persisted.leaseOwner,null);
  await f.close(reload);
});

test('duas abas enfileirando simultaneamente o mesmo UUID mantêm uma única entrada consistente',async()=>{
  const f=await fixture('concurrent-uuid'),second=await f.open('user:alpha'),input=intent();
  const results=await Promise.all([f.repository.outbox.enqueue(input),second.outbox.enqueue(input)]);
  const rows=await f.repository.outbox.list();assert.equal(rows.length,1);assert.equal(rows[0].operationId,input.operationId);
  assert.equal(rows[0].status,'pending');assert.equal(rows[0].sequence,1);
  assert.equal(results.filter(result=>result.deduplicated===true).length,1);
  await f.close(second);
});
