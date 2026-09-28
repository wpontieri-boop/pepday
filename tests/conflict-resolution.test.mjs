import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {indexedDB} from 'fake-indexeddb';
import {openPepDayRepository} from '../src/pepday-repository.mjs';
import {createSyncApi,SyncApiError} from '../src/sync-api.mjs';
import {createSyncEngine} from '../src/sync-engine.mjs';

const user='11111111-1111-4111-8111-111111111111';
const vialId='22222222-2222-4222-8222-222222222222';
const routineId='33333333-3333-4333-8333-333333333333';
let serial=0;
const uuid=()=>`c1000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`;
const config={supabaseUrl:'https://fixture.supabase.co',supabasePublishableKey:'sb_publishable_fixture'};
const authClient=()=>({auth:{getSession:async()=>({data:{session:{access_token:'token'}}}),refreshSession:async()=>({error:null})}});
const remove=name=>new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=resolve;r.onerror=()=>reject(r.error)});

async function fixture(label){
  const name=`pepday-conflict-${label}-${Date.now()}-${++serial}`;
  const repository=await openPepDayRepository({accountScope:`user:${user}`,indexedDBFactory:indexedDB,databaseName:name,
    outboxOptions:{clock:()=>Date.parse('2026-09-28T18:00:00Z')}});
  return {name,repository,async close(){repository.close();await remove(name)}};
}
function vial(remoteVersion=1){
  const snapshot={id:vialId,user_id:user,name:'Remoto',initial_mg:10,remaining_mg:10,water_ml:2,prepared_on:'2026-09-28',
    cost:0,active:true,version:remoteVersion,edit_version:remoteVersion,deleted_at:null};
  return {id:vialId,name:'Local',initialMg:10,remainingMg:10,waterMl:2,date:'2026-09-28',cost:0,history:[],
    remoteRef:{status:'synced',id:vialId,version:remoteVersion,editVersion:remoteVersion,snapshot}};
}
test('sync-api preserva payload estruturado do conflito sem alterar o código',async()=>{
  const remote={id:vialId,edit_version:2},api=createSyncApi({client:authClient(),config,fetchImpl:async()=>Response.json(
    {outcome:'conflict',code:'STALE_VERSION',remote_version:2,remote},{status:200})});
  await assert.rejects(api.send({operationId:uuid(),type:'edit',entityType:'vial',entityId:vialId,
    payload:{expectedUserId:user,base:vial().remoteRef.snapshot,expectedVersion:1,entity:vial()}}),
  error=>error instanceof SyncApiError&&error.code==='STALE_VERSION'&&error.details.remote.id===vialId);
});

test('engine grava dados do conflito na outbox',async()=>{
  let settled,claimed=false;
  const op={operationId:uuid(),attemptCount:1,type:'edit'},repository={accountScope:`user:${user}`,outbox:{
    claimNext:async()=>claimed?null:(claimed=true,op),settle:async(id,data)=>{settled={id,data};return data},list:async()=>[]},
    persistRemoteConfirmation:async()=>{throw new Error('não deveria confirmar')}};
  const error=new SyncApiError('Conflito remoto.',{status:409,code:'STALE_VERSION',details:{remote:{id:vialId},remote_version:2}});
  const engine=createSyncEngine({repository,api:{send:async()=>{throw error},refreshSession:async()=>{}},
    coordinator:{ownerId:'worker',runExclusive:async(scope,work)=>({acquired:true,value:await work()})},
    online:()=>true,windowTarget:null,documentTarget:null,setTimer:()=>1,clearTimer:()=>{}});
  await engine.start();
  assert.equal(settled.data.outcome,'conflict');assert.equal(settled.data.conflictData.remote.id,vialId);engine.stop();
});
test('usar versão da conta resolve sem recriar mutação',async()=>{
  serial=0;const f=await fixture('remote'),operationId=uuid();
  await f.repository.vials.put(vial());
  await f.repository.saveVialWithOutbox({...vial(),name:'Alterado localmente'},{operationId,type:'edit'});
  const claimed=await f.repository.outbox.claimNext({workerId:'w'});
  await f.repository.outbox.settle(operationId,{workerId:'w',outcome:'conflict',errorCode:'STALE_VERSION',
    conflictData:{remote_version:2,remote:{...vial().remoteRef.snapshot,name:'Conta',version:2,edit_version:2}}});
  const result=await f.repository.resolveEntityConflict(operationId,{choice:'remote'});
  const row=await f.repository.outbox.get(operationId);
  assert.equal(result.replacement,null);assert.equal(row.status,'synced');assert.equal(row.resolution,'remote');assert.equal(row.conflictData,null);
  await f.close();
});

test('manter este aparelho cria nova intenção sobre a versão remota',async()=>{
  serial=0;const f=await fixture('local'),operationId=uuid(),replacementId=uuid();
  await f.repository.vials.put(vial());
  await f.repository.saveVialWithOutbox({...vial(),name:'Alterado localmente'},{operationId,type:'edit'});
  await f.repository.outbox.claimNext({workerId:'w'});
  const remote={...vial().remoteRef.snapshot,name:'Conta',version:2,edit_version:2};
  await f.repository.outbox.settle(operationId,{workerId:'w',outcome:'conflict',errorCode:'STALE_VERSION',
    conflictData:{remote_version:2,remote}});
  const result=await f.repository.resolveEntityConflict(operationId,{choice:'local',newOperationId:replacementId});
  const old=await f.repository.outbox.get(operationId),next=await f.repository.outbox.get(replacementId);
  assert.equal(old.status,'synced');assert.equal(old.resolution,'local');assert.equal(next.status,'pending');
  assert.equal(next.payload.expectedVersion,2);assert.deepEqual(next.payload.base,remote);
  assert.equal(next.payload.entity.name,'Alterado localmente');assert.equal(result.replacement.operation.operationId,replacementId);
  await f.close();
});
test('Rotina exige novo versionId ao manter versão local',async()=>{
  serial=0;const f=await fixture('routine'),operationId=uuid(),replacementId=uuid(),newVersionId=uuid();
  await f.repository.vials.put(vial());
  const remote={id:routineId,user_id:user,vial_id:vialId,name:'Remota',dose_value:1,dose_unit:'mg',syringe_capacity:100,
    frequency:'daily',weekdays:[],start_date:'2026-09-28',time_of_day:null,refill_at:3,status:'active',version:1,deleted_at:null};
  const local={id:routineId,vialId,name:'Local',doseValue:1,doseUnit:'mg',doseMg:1,ui:20,ml:.2,syringeCapacity:100,refillAt:3,
    frequency:'daily',weekdays:[],start:'2026-09-28',time:'',done:[],doseHistory:[],
    remoteRef:{status:'synced',id:routineId,versionId:uuid(),version:1,snapshot:remote}};
  await f.repository.routines.put(local);
  await f.repository.saveRoutineWithOutbox({...local,name:'Local 2'},{operationId,type:'edit'});
  await f.repository.outbox.claimNext({workerId:'w'});
  await f.repository.outbox.settle(operationId,{workerId:'w',outcome:'conflict',errorCode:'STALE_VERSION',
    conflictData:{remote_version:2,remote:{...remote,name:'Conta',version:2}}});
  await f.repository.resolveEntityConflict(operationId,{choice:'local',newOperationId:replacementId,newRoutineVersionId:newVersionId});
  const next=await f.repository.outbox.get(replacementId);
  assert.equal(next.payload.routineVersionId,newVersionId);assert.equal(next.payload.expectedVersion,2);await f.close();
});
test('Perfil expõe revisão e duas decisões sem sobrescrita automática',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const ui=await readFile(new URL('../src/account-ui.mjs',import.meta.url),'utf8');
  assert.match(html,/id="syncConflictReview"/);assert.match(html,/Nada será sobrescrito automaticamente/);
  assert.match(ui,/Usar versão da conta/);assert.match(ui,/Manter deste aparelho/);
  assert.match(ui,/resolveEntityConflict/);
});
