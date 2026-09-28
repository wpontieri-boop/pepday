import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {openPepDayRepository} from '../src/pepday-repository.mjs';
import {createSyncEngine} from '../src/sync-engine.mjs';
import {createSyncApi,SyncApiError} from '../src/sync-api.mjs';
import {createTabCoordinator} from '../src/tab-coordinator.mjs';

let serial=0;
const uuid=()=>`d3000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`;
const user='11111111-1111-4111-8111-111111111111';
const config={supabaseUrl:'https://fixture.supabase.co',supabasePublishableKey:'sb_publishable_fixture'};
const authClient=()=>({auth:{getSession:async()=>({data:{session:{access_token:'token'}}}),refreshSession:async()=>({error:null})}});
const remove=name=>new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=resolve;r.onerror=()=>reject(r.error)});

function vialSnapshot(id,version=1,overrides={}){
  return {id,user_id:user,name:'Vial',initial_mg:10,remaining_mg:10,water_ml:2,prepared_on:'2026-09-28',cost:0,
    active:true,version,edit_version:version,deleted_at:null,...overrides};
}
function routineSnapshot(id,vialId,version=1,overrides={}){
  return {id,user_id:user,vial_id:vialId,name:'Rotina',dose_value:1,dose_unit:'mg',syringe_capacity:100,
    frequency:'daily',weekdays:[],start_date:'2026-09-28',time_of_day:null,refill_at:3,status:'active',version,deleted_at:null,...overrides};
}
async function fixture(label){
  const name=`pepday-d3-${label}-${Date.now()}-${++serial}`,time={value:Date.parse('2026-09-28T15:00:00Z')};
  const repository=await openPepDayRepository({accountScope:`user:${user}`,indexedDBFactory:indexedDB,databaseName:name,
    outboxOptions:{clock:()=>time.value,leaseMs:100}});
  const coordinator=createTabCoordinator({repository,locks:null,ownerId:`d3-${serial}`,clock:()=>time.value,leaseMs:1000,
    setIntervalFn:()=>1,clearIntervalFn:()=>{}});
  const engine=api=>createSyncEngine({repository,api,coordinator,clock:()=>time.value,online:()=>true,random:()=>0,
    windowTarget:null,documentTarget:null,setTimer:()=>1,clearTimer:()=>{}});
  return {name,time,repository,engine,async close(){repository.close();await remove(name)}};
}

test('sync-api envia criação versionada de Frasco e Rotina com o mesmo operationId',async()=>{
  const calls=[],fetchImpl=async(url,options)=>{
    const body=JSON.parse(options.body);calls.push({url,body});
    if(url.endsWith('/create_vial_versioned'))return Response.json({outcome:'success',replay:false,vial:vialSnapshot(body.p_vial_id)});
    return Response.json({outcome:'success',replay:false,routine:routineSnapshot(body.p_routine_id,body.p_vial_id),routine_version_id:body.p_routine_version_id});
  };
  const api=createSyncApi({client:authClient(),config,fetchImpl}),vialId=uuid(),routineId=uuid(),versionId=uuid();
  await api.send({operationId:uuid(),type:'create',entityType:'vial',entityId:vialId,payload:{expectedUserId:user,entity:{id:vialId,name:'Vial',initialMg:10,remainingMg:10,waterMl:2,date:'2026-09-28',cost:0}}});
  await api.send({operationId:uuid(),type:'create',entityType:'routine',entityId:routineId,payload:{expectedUserId:user,routineVersionId:versionId,remoteVialId:vialId,
    entity:{id:routineId,vialId,name:'Rotina',doseValue:1,doseUnit:'mg',syringeCapacity:100,frequency:'daily',weekdays:[],start:'2026-09-28',time:'',refillAt:3}}});
  assert.match(calls[0].url,/create_vial_versioned$/);assert.equal(calls[0].body.p_vial_id,vialId);
  assert.match(calls[1].url,/create_routine_versioned$/);assert.equal(calls[1].body.p_routine_version_id,versionId);assert.equal(calls[1].body.p_vial_id,vialId);
});
test('sync-api monta patch permitido e recusa ajuste manual de saldo',async()=>{
  let body;const id=uuid(),base=vialSnapshot(id),api=createSyncApi({client:authClient(),config,fetchImpl:async(url,options)=>{
    body=JSON.parse(options.body);return Response.json({outcome:'success',replay:false,vial:vialSnapshot(id,2,{name:'Novo'})});
  }});
  await api.send({operationId:uuid(),type:'edit',entityType:'vial',entityId:id,payload:{expectedUserId:user,base,expectedVersion:1,
    entity:{id,name:'Novo',initialMg:10,remainingMg:10,waterMl:2,date:'2026-09-28',cost:0}}});
  assert.deepEqual(body.p_patch,{name:'Novo'});assert.equal(body.p_expected_edit_version,1);
  await assert.rejects(api.send({operationId:uuid(),type:'edit',entityType:'vial',entityId:id,payload:{expectedUserId:user,base,expectedVersion:1,
    entity:{id,name:'Vial',initialMg:10,remainingMg:9,waterMl:2,date:'2026-09-28',cost:0}}}),error=>error.code==='UNSUPPORTED_BALANCE_EDIT');
});

test('conflito funcional retornado com HTTP 200 vira conflito terminal',async()=>{
  const api=createSyncApi({client:authClient(),config,fetchImpl:async()=>Response.json({outcome:'conflict',replay:false,code:'STALE_VERSION'})});
  const id=uuid(),base=vialSnapshot(id);
  await assert.rejects(api.send({operationId:uuid(),type:'delete',entityType:'vial',entityId:id,payload:{expectedUserId:user,base,expectedVersion:1}}),
    error=>error instanceof SyncApiError&&error.status===409&&error.code==='STALE_VERSION');
});
test('Frasco criado sincroniza antes da Rotina dependente e ambos ganham remoteRef',async()=>{
  const f=await fixture('vial-routine'),vialId=uuid(),routineId=uuid(),vialOp=uuid(),routineOp=uuid();
  await f.repository.saveVialWithOutbox({id:vialId,name:'Vial',initialMg:10,remainingMg:10,waterMl:2,date:'2026-09-28',cost:0,history:[]},{operationId:vialOp,type:'create'});
  await f.repository.saveRoutineWithOutbox({id:routineId,vialId,name:'Rotina',doseValue:1,doseUnit:'mg',doseMg:1,ui:20,ml:.2,
    syringeCapacity:100,refillAt:3,frequency:'daily',weekdays:[],start:'2026-09-28',time:'',done:[],doseHistory:[]},{operationId:routineOp,type:'create'});
  const before=await f.repository.outbox.get(routineOp);assert.deepEqual(before.dependencies,[vialOp]);
  const order=[],api={refreshSession:async()=>{},send:async op=>{
    order.push(op.entityType);
    if(op.entityType==='vial')return {replay:false,vial:vialSnapshot(vialId)};
    return {replay:false,routine:routineSnapshot(routineId,vialId),routineVersionId:op.payload.routineVersionId};
  }};
  await f.engine(api).start();assert.deepEqual(order,['vial','routine']);
  const vial=await f.repository.vials.get(vialId),routine=await f.repository.routines.get(routineId);
  assert.equal(vial.remoteRef.status,'synced');assert.equal(vial.remoteRef.editVersion,1);
  assert.equal(routine.remoteRef.status,'synced');assert.equal(routine.remoteRef.version,1);
  assert.equal((await f.repository.routineVersions.list()).length,1);await f.close();
});
test('edição feita enquanto create está em voo aguarda confirmação e recebe nova base',async()=>{
  const f=await fixture('chain'),id=uuid(),createOp=uuid(),editOp=uuid();
  await f.repository.saveVialWithOutbox({id,name:'Vial',initialMg:10,remainingMg:10,waterMl:2,date:'2026-09-28',cost:0},{operationId:createOp,type:'create'});
  const claimed=await f.repository.outbox.claimNext({workerId:'first',allowedTypes:['create']});assert.equal(claimed.operationId,createOp);
  await f.repository.saveVialWithOutbox({id,name:'Vial 2',initialMg:10,remainingMg:10,waterMl:2,date:'2026-09-28',cost:0},{operationId:editOp,type:'edit'});
  let edit=await f.repository.outbox.get(editOp);assert.equal(edit.blockedReason,'remote-prerequisites');assert.deepEqual(edit.dependencies,[createOp]);
  await f.repository.persistRemoteConfirmation({accountScope:f.repository.accountScope,operationId:createOp,workerId:'first',response:{replay:false,vial:vialSnapshot(id)}});
  edit=await f.repository.outbox.get(editOp);assert.equal(edit.blockedReason,null);assert.equal(edit.payload.expectedVersion,1);assert.equal(edit.payload.base.id,id);
  await f.engine({refreshSession:async()=>{},send:async op=>({replay:false,vial:vialSnapshot(id,2,{name:op.payload.entity.name})})}).start();
  assert.equal((await f.repository.vials.get(id)).remoteRef.editVersion,2);assert.equal((await f.repository.outbox.get(editOp)).status,'synced');await f.close();
});