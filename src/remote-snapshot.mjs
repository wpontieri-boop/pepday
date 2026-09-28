const num=value=>value==null?null:Number(value);
const cleanTime=value=>value==null?'':String(value).slice(0,5);
const assertRows=(name,result)=>{
  if(result?.error)throw result.error;
  if(!Array.isArray(result?.data))throw new Error(`Snapshot remoto inválido: ${name}.`);
  return result.data;
};

export async function readConfirmedSnapshot(client,userId){
  if(!client?.from||typeof userId!=='string'||!userId)throw new Error('Conta remota inválida.');
  const query=(table,columns)=>client.from(table).select(columns).eq('user_id',userId);
  const [vialsResult,routinesResult,versionsResult,applicationsResult,movementsResult]=await Promise.all([
    query('vials','*'),query('routines','*'),query('routine_versions','*'),
    query('applications','*'),query('vial_movements','*')
  ]);
  const vialRows=assertRows('vials',vialsResult),routineRows=assertRows('routines',routinesResult),
    versionRows=assertRows('routine_versions',versionsResult),applications=assertRows('applications',applicationsResult),
    movements=assertRows('vial_movements',movementsResult);
  const versionsByRoutine=new Map();
  for(const row of versionRows){
    const current=versionsByRoutine.get(row.routine_id);
    if(!current||Number(row.version)>Number(current.version))versionsByRoutine.set(row.routine_id,row);
  }
  const movementsByVial=new Map();
  for(const row of movements){
    const list=movementsByVial.get(row.vial_id)||[];list.push(row);movementsByVial.set(row.vial_id,list);
  }
  const vials=vialRows.map(row=>{
    const history=(movementsByVial.get(row.id)||[]).map(move=>({
      id:move.id,type:move.kind,date:move.created_at,amountMg:num(move.delta_mg),
      balanceBefore:num(move.balance_before),balanceAfter:num(move.balance_after),
      operationId:move.operation_id,applicationId:move.application_id||null
    }));
    return {id:row.id,deleted:Boolean(row.deleted_at),data:{
      id:row.id,name:row.name,initialMg:num(row.initial_mg),remainingMg:num(row.remaining_mg),
      waterMl:num(row.water_ml),date:row.prepared_on,cost:row.cost==null?0:num(row.cost),
      active:Boolean(row.active),history,
      remoteRef:{status:'synced',id:row.id,version:Number(row.version),
        editVersion:Number(row.edit_version??row.version),snapshot:structuredClone(row)}
    }};
  });
  const vialById=new Map(vialRows.map(row=>[row.id,row]));
  const routines=routineRows.map(row=>{
    const vial=vialById.get(row.vial_id),doseValue=num(row.dose_value);
    const doseMg=row.dose_unit==='mcg'?doseValue/1000:doseValue;
    const concentration=vial&&Number(vial.water_ml)>0?Number(vial.initial_mg)/Number(vial.water_ml):null;
    const ml=concentration>0?doseMg/concentration:null,ui=ml==null?null:ml*100;
    const currentVersion=versionsByRoutine.get(row.id);
    return {id:row.id,deleted:Boolean(row.deleted_at),data:{
      id:row.id,vialId:row.vial_id,name:row.name,doseValue,doseUnit:row.dose_unit,doseMg,
      ui,ml,syringeCapacity:Number(row.syringe_capacity),refillAt:Number(row.refill_at??3),
      frequency:row.frequency,weekdays:Array.isArray(row.weekdays)?row.weekdays:[],
      start:row.start_date,time:cleanTime(row.time_of_day),done:[],doseHistory:[],
      remoteRef:{status:'synced',id:row.id,versionId:currentVersion?.id||null,
        version:Number(row.version),snapshot:structuredClone(row)}
    }};
  });
  const routineVersions=versionRows.map(row=>({id:row.id,data:{
    id:row.id,routineId:row.routine_id,remoteRoutineId:row.routine_id,
    version:Number(row.version),snapshot:structuredClone(row.snapshot)
  }}));
  const applicationItems=applications.map(row=>({id:row.id,data:{
    ...structuredClone(row),localRoutineId:row.routine_id,localVialId:row.vial_id
  }}));
  const movementItems=movements.map(row=>({id:row.id,data:structuredClone(row)}));
  return {vials,routines,routineVersions,applications:applicationItems,vialMovements:movementItems};
}
