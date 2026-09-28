import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {indexedDB} from 'fake-indexeddb';
import {openPepDayRepository} from '../src/pepday-repository.mjs';
import {readConfirmedSnapshot} from '../src/remote-snapshot.mjs';

const user='11111111-1111-4111-8111-111111111111';
const vialId='22222222-2222-4222-8222-222222222222';
const routineId='33333333-3333-4333-8333-333333333333';
const versionId='44444444-4444-4444-8444-444444444444';
const appId='55555555-5555-4555-8555-555555555555';
const moveId='66666666-6666-4666-8666-666666666666';

function clientFixture(){
  const tables={
    vials:[{id:vialId,user_id:user,name:'Frasco remoto',initial_mg:'10',remaining_mg:'8',water_ml:'2',prepared_on:'2026-09-28',
      cost:'50',active:true,version:2,edit_version:2,deleted_at:null}],
    routines:[{id:routineId,user_id:user,vial_id:vialId,name:'Rotina remota',dose_value:'1',dose_unit:'mg',syringe_capacity:100,
      frequency:'daily',weekdays:[],start_date:'2026-09-28',time_of_day:'08:30:00',refill_at:3,status:'active',version:1,deleted_at:null}],
    routine_versions:[{id:versionId,user_id:user,routine_id:routineId,version:1,snapshot:{id:routineId,name:'Rotina remota'}}],
    applications:[{id:appId,user_id:user,operation_id:'77777777-7777-4777-8777-777777777777',routine_id:routineId,
      routine_version_id:versionId,vial_id:vialId,scheduled_date:'2026-09-28',applied_at:'2026-09-28T11:30:00Z',
      dose_value:'1',dose_unit:'mg',dose_mg:'1',volume_ml:'.2',ui:'20',concentration:'5',balance_before:'9',balance_after:'8',undone_at:null}],
    vial_movements:[{id:moveId,user_id:user,operation_id:'77777777-7777-4777-8777-777777777777',vial_id:vialId,application_id:appId,
      kind:'application',delta_mg:'-1',balance_before:'9',balance_after:'8',created_at:'2026-09-28T11:30:00Z'}]
  };
  return {from(name){return {select(){return {eq:async(column,value)=>{
    assert.equal(column,'user_id');assert.equal(value,user);return {data:structuredClone(tables[name]),error:null};
  }}}}}};
}
test('snapshot remoto converte Frasco, Rotina e histórico confirmado para o formato local',async()=>{
  const snapshot=await readConfirmedSnapshot(clientFixture(),user);
  assert.equal(snapshot.vials[0].data.remainingMg,8);
  assert.equal(snapshot.vials[0].data.remoteRef.editVersion,2);
  assert.equal(snapshot.vials[0].data.history[0].type,'application');
  assert.equal(snapshot.routines[0].data.vialId,vialId);
  assert.equal(snapshot.routines[0].data.remoteRef.versionId,versionId);
  assert.equal(snapshot.routines[0].data.ui,20);
  assert.equal(snapshot.applications[0].data.localRoutineId,routineId);
  assert.equal(snapshot.routineVersions[0].data.version,1);
});

test('hidratação preserva histórico local e não sobrescreve entidade com operação pendente',async()=>{
  const databaseName=`pepday-hydrate-${webcrypto.randomUUID()}`;
  const repository=await openPepDayRepository({accountScope:`user:${user}`,indexedDBFactory:indexedDB,databaseName});
  await repository.vials.put({id:vialId,name:'Local',initialMg:10,remainingMg:10,waterMl:2,date:'2026-09-28',cost:0,
    history:[{id:'legacy-1',type:'legacy',date:'2026-09-20'}]});
  await repository.routines.put({id:routineId,vialId,name:'Rotina local',doseValue:1,doseUnit:'mg',doseMg:1,ui:20,ml:.2,
    syringeCapacity:100,refillAt:3,frequency:'daily',weekdays:[],start:'2026-09-28',time:'08:00',done:['2026-09-27'],doseHistory:[]});
  await repository.saveRoutineWithOutbox({id:routineId,vialId,name:'Rotina local editada',doseValue:1,doseUnit:'mg',doseMg:1,ui:20,ml:.2,
    syringeCapacity:100,refillAt:3,frequency:'daily',weekdays:[],start:'2026-09-28',time:'08:00',done:['2026-09-27'],doseHistory:[]},
    {operationId:'88888888-8888-4888-8888-888888888888',type:'edit'});
  const result=await repository.hydrateConfirmedSnapshot(await readConfirmedSnapshot(clientFixture(),user));
  const vial=await repository.vials.get(vialId),routine=await repository.routines.get(routineId);
  assert.equal(vial.name,'Frasco remoto');
  assert.deepEqual(vial.history.map(item=>item.id).sort(),['legacy-1',moveId].sort());
  assert.equal(routine.name,'Rotina local editada');
  assert.equal(result.skipped,1);
  assert.equal((await repository.applications.get(appId)).scheduled_date,'2026-09-28');
  repository.close();
});
