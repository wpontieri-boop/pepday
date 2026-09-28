import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {indexedDB} from 'fake-indexeddb';
import {openPepDayRepository} from '../src/pepday-repository.mjs';
import {createSyncApi} from '../src/sync-api.mjs';
import {createSyncEngine} from '../src/sync-engine.mjs';
import {createTabCoordinator} from '../src/tab-coordinator.mjs';

const migration=()=>readFile(new URL('../supabase/migrations/20260928152114_block_b22d3_vial_adjustment.sql',import.meta.url),'utf8');
let serial=0;const uuid=()=>`d3a00000-0000-4000-8000-${String(++serial).padStart(12,'0')}`;
const user='22222222-2222-4222-8222-222222222222';
const config={supabaseUrl:'https://fixture.supabase.co',supabasePublishableKey:'sb_publishable_fixture'};
const client={auth:{getSession:async()=>({data:{session:{access_token:'token'}},error:null}),refreshSession:async()=>({error:null})}};
const remove=name=>new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=resolve;r.onerror=()=>reject(r.error)});
async function fixture(label){
  const name=`pepday-adjust-${label}-${Date.now()}-${++serial}`,time={value:Date.parse('2026-09-28T16:00:00Z')};
  const repository=await openPepDayRepository({accountScope:`user:${user}`,indexedDBFactory:indexedDB,databaseName:name,
    outboxOptions:{clock:()=>time.value,leaseMs:100}});
  const coordinator=createTabCoordinator({repository,locks:null,ownerId:`adjust-${serial}`,clock:()=>time.value,leaseMs:1000,
    setIntervalFn:()=>1,clearIntervalFn:()=>{}});
  const engine=api=>createSyncEngine({repository,api,coordinator,clock:()=>time.value,online:()=>true,random:()=>0,
    windowTarget:null,documentTarget:null,setTimer:()=>1,clearTimer:()=>{}});
  return {repository,engine,async close(){repository.close();await remove(name)}};
}
const remoteVial=(id,balance,version=2)=>({id,user_id:user,name:'Vial',initial_mg:10,remaining_mg:balance,water_ml:2,
  prepared_on:'2026-09-28',cost:0,active:true,version,edit_version:1,deleted_at:null});
const movement=(id,op,vial,before,after)=>({id,user_id:user,operation_id:op,vial_id:vial,application_id:null,kind:'adjustment',
  delta_mg:after-before,balance_before:before,balance_after:after,created_at:'2026-09-28T16:00:01Z'});
test('migration cria ajuste histórico idempotente com lock e grant mínimo',async()=>{
  const sql=await migration();
  assert.match(sql,/mutation_type in \('create','update','soft_delete','adjustment'\)/);
  assert.match(sql,/create function public\.adjust_vial_balance_versioned/);
  assert.match(sql,/perform 1 from public\.profiles where id=u for update;[^]*domain_mutation_operations[^]*public\.vials[^]*for update;/);
  assert.match(sql,/code','STALE_BALANCE'/);
  assert.match(sql,/kind,[^]*'adjustment'/);
  assert.match(sql,/remaining_mg=p_new_balance,[^]*version=version\+1/);
  assert.doesNotMatch(sql,/edit_version=edit_version\+1/);
  assert.match(sql,/revoke all on function public\.adjust_vial_balance_versioned[^]*from public,anon,authenticated;[^]*grant execute[^]*to authenticated;/);
});

test('sync-api envia adjustment e trata conflito funcional',async()=>{
  const id=uuid(),op=uuid(),calls=[],api=createSyncApi({client,config,fetchImpl:async(url,options)=>{
    calls.push({url,body:JSON.parse(options.body)});
    return Response.json({outcome:'success',replay:false,vial:remoteVial(id,7),movement:movement(uuid(),op,id,10,7)});
  }});
  const result=await api.send({operationId:op,type:'adjustment',entityType:'vial',entityId:id,
    payload:{expectedUserId:user,expectedBalance:10,newBalance:7}});
  assert.match(calls[0].url,/adjust_vial_balance_versioned$/);
  assert.equal(calls[0].body.p_expected_balance,10);assert.equal(calls[0].body.p_new_balance,7);
  assert.equal(result.movement.kind,'adjustment');
  const conflict=createSyncApi({client,config,fetchImpl:async()=>Response.json({outcome:'conflict',replay:false,code:'STALE_BALANCE'})});
  await assert.rejects(conflict.send({operationId:uuid(),type:'adjustment',entityType:'vial',entityId:id,
    payload:{expectedUserId:user,expectedBalance:10,newBalance:6}}),error=>error.status===409&&error.code==='STALE_BALANCE');
});
test('repository grava ajuste local e outbox sem fabricar movimento confirmado',async()=>{
  const f=await fixture('local'),id=uuid(),op=uuid();
  await f.repository.vials.put({id,name:'Vial',initialMg:10,remainingMg:10,waterMl:2,date:'2026-09-28',cost:0,history:[],
    remoteRef:{status:'synced',id,version:1,editVersion:1,snapshot:remoteVial(id,10,1)}});
  const saved=await f.repository.adjustVialBalanceWithOutbox(id,7,{operationId:op});
  assert.equal(saved.entity.remainingMg,7);assert.equal(saved.entity.remoteRef.status,'pending');
  assert.equal(saved.entity.history[0].type,'adjust');assert.equal(saved.entity.history[0].before,10);assert.equal(saved.entity.history[0].after,7);
  const queued=await f.repository.outbox.get(op);assert.equal(queued.type,'adjustment');assert.equal(queued.payload.expectedBalance,10);assert.equal(queued.payload.newBalance,7);
  assert.deepEqual(await f.repository.confirmedCounts(),{applications:0,vialMovements:0});await f.close();
});

test('confirmação adjustment persiste movement e volta remoteRef para synced',async()=>{
  const f=await fixture('confirm'),id=uuid(),op=uuid(),move=uuid();
  await f.repository.vials.put({id,name:'Vial',initialMg:10,remainingMg:10,waterMl:2,date:'2026-09-28',cost:0,history:[],
    remoteRef:{status:'synced',id,version:1,editVersion:1,snapshot:remoteVial(id,10,1)}});
  await f.repository.adjustVialBalanceWithOutbox(id,7,{operationId:op});
  await f.engine({refreshSession:async()=>{},send:async()=>({replay:false,vial:remoteVial(id,7,2),movement:movement(move,op,id,10,7)})}).start();
  const vial=await f.repository.vials.get(id),rows=await f.repository.vialMovements.list(),queued=await f.repository.outbox.get(op);
  assert.equal(vial.remainingMg,7);assert.equal(vial.remoteRef.status,'synced');assert.equal(vial.remoteRef.version,2);
  assert.equal(rows.length,1);assert.equal(rows[0].kind,'adjustment');assert.equal(queued.status,'synced');await f.close();
});
test('Application criada durante ajuste espera confirmação do Frasco',async()=>{
  const f=await fixture('application-waits'),id=uuid(),routineId=uuid(),versionId=uuid(),adjustOp=uuid();
  await f.repository.vials.put({id,name:'Vial',initialMg:10,remainingMg:10,waterMl:2,date:'2026-09-28',cost:0,history:[],
    remoteRef:{status:'synced',id,version:1,editVersion:1,snapshot:remoteVial(id,10,1)}});
  await f.repository.routines.put({id:routineId,vialId:id,name:'Rotina',remoteRef:{status:'synced',id:routineId,versionId,version:1}});
  await f.repository.adjustVialBalanceWithOutbox(id,8,{operationId:adjustOp});
  const routine=await f.repository.routines.get(routineId),vial=await f.repository.vials.get(id),applicationOp=uuid();
  await f.repository.enqueueApplicationIntent({operationId:applicationOp,routine,vial,scheduledDate:'2026-09-28'});
  const queued=await f.repository.outbox.get(applicationOp);
  assert.equal(queued.blockedReason,'remote-prerequisites');assert.equal(queued.payload.vialId,null);await f.close();
});

test('dois adjustments não compactam e o segundo depende do primeiro pendente',async()=>{
  const f=await fixture('chain'),id=uuid(),a=uuid(),b=uuid();
  await f.repository.vials.put({id,name:'Vial',initialMg:10,remainingMg:10,waterMl:2,date:'2026-09-28',cost:0,history:[],
    remoteRef:{status:'synced',id,version:1,editVersion:1,snapshot:remoteVial(id,10,1)}});
  await f.repository.adjustVialBalanceWithOutbox(id,9,{operationId:a});
  await f.repository.adjustVialBalanceWithOutbox(id,8,{operationId:b});
  const rows=await f.repository.outbox.list();assert.equal(rows.length,2);assert.deepEqual((await f.repository.outbox.get(b)).dependencies,[a]);await f.close();
});
