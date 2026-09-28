export function parseRetryAfter(value,now=Date.now()){
  if(value==null||String(value).trim()==='')return null;
  const raw=String(value).trim();
  if(/^\d+(?:\.\d+)?$/.test(raw))return Math.max(0,Number(raw)*1000);
  const date=Date.parse(raw);return Number.isFinite(date)?Math.max(0,date-now):null;
}
export class SyncApiError extends Error{
  constructor(message,{status=0,code='SYNC_ERROR',retryAfterMs=null}={}){
    super(message||'Falha de sincronização.');this.name='SyncApiError';this.status=status;this.code=code;this.retryAfterMs=retryAfterMs;
  }
}
async function safeJson(response){try{return await response.json()}catch{return null}}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const ensure=(condition,message,code='INVALID_OPERATION')=>{if(!condition)throw new SyncApiError(message,{status:422,code})};

function vialPatch(entity,base){
  ensure(base&&entity,'Frasco sem base remota.','REMOTE_BASE_REQUIRED');
  if(Number(entity.initialMg)!==Number(base.initial_mg))throw new SyncApiError('Quantidade inicial do frasco exige fluxo próprio.',{status:422,code:'UNSUPPORTED_INITIAL_MG_EDIT'});
  if(Number(entity.remainingMg)!==Number(base.remaining_mg))throw new SyncApiError('Ajuste manual de saldo ainda não é sincronizável.',{status:422,code:'UNSUPPORTED_BALANCE_EDIT'});
  const patch={};
  if(entity.name!==base.name)patch.name=entity.name;
  if(Number(entity.waterMl)!==Number(base.water_ml))patch.water_ml=Number(entity.waterMl);
  if(entity.date!==base.prepared_on)patch.prepared_on=entity.date;
  const localCost=entity.cost==null?null:Number(entity.cost),remoteCost=base.cost==null?null:Number(base.cost);
  if(localCost!==remoteCost)patch.cost=localCost;
  return patch;
}
function routinePatch(entity,base,remoteVialId){
  ensure(base&&entity,'Rotina sem base remota.','REMOTE_BASE_REQUIRED');
  const patch={},fields=[
    ['vial_id',remoteVialId||entity.vialId],['name',entity.name],['dose_value',Number(entity.doseValue)],
    ['dose_unit',entity.doseUnit],['syringe_capacity',Number(entity.syringeCapacity)],['frequency',entity.frequency],
    ['weekdays',entity.weekdays||[]],['start_date',entity.start],['time_of_day',entity.time||null],['refill_at',Number(entity.refillAt||3)]
  ];
  for(const [key,value] of fields)if(!same(value,base[key]))patch[key]=value;
  return patch;
}
function entityRpc(operation){
  const p=operation.payload||{},e=p.entity,user=p.expectedUserId;
  ensure(user,'Conta remota ausente.','REMOTE_USER_REQUIRED');
  if(operation.entityType==='vial'){
    if(operation.type==='create'){
      ensure(e,'Frasco local ausente.');
      return ['create_vial_versioned',{p_operation_id:operation.operationId,p_expected_user:user,p_vial_id:operation.entityId,
        p_name:e.name,p_initial_mg:Number(e.initialMg),p_water_ml:Number(e.waterMl),p_prepared_on:e.date,p_cost:e.cost==null?null:Number(e.cost)}];
    }
    ensure(p.base&&p.expectedVersion,'Versão remota do frasco ausente.','REMOTE_BASE_REQUIRED');
    if(operation.type==='edit')return ['update_vial_versioned',{p_operation_id:operation.operationId,p_expected_user:user,p_vial_id:operation.entityId,
      p_expected_edit_version:Number(p.expectedVersion),p_base:p.base,p_patch:vialPatch(e,p.base)}];
    if(operation.type==='delete')return ['soft_delete_vial_versioned',{p_operation_id:operation.operationId,p_expected_user:user,p_vial_id:operation.entityId,
      p_expected_edit_version:Number(p.expectedVersion),p_base:p.base}];
  }
  if(operation.entityType==='routine'){
    ensure(p.routineVersionId,'Versão nova da rotina ausente.','ROUTINE_VERSION_REQUIRED');
    if(operation.type==='create'){
      ensure(e,'Rotina local ausente.');
      return ['create_routine_versioned',{p_operation_id:operation.operationId,p_expected_user:user,p_routine_id:operation.entityId,
        p_routine_version_id:p.routineVersionId,p_vial_id:p.remoteVialId||e.vialId,p_name:e.name,p_dose_value:Number(e.doseValue),
        p_dose_unit:e.doseUnit,p_syringe_capacity:Number(e.syringeCapacity),p_frequency:e.frequency,p_weekdays:e.weekdays||[],
        p_start_date:e.start,p_time_of_day:e.time||null,p_refill_at:Number(e.refillAt||3)}];
    }
    ensure(p.base&&p.expectedVersion,'Versão remota da rotina ausente.','REMOTE_BASE_REQUIRED');
    if(operation.type==='edit')return ['update_routine_versioned',{p_operation_id:operation.operationId,p_expected_user:user,p_routine_id:operation.entityId,
      p_new_routine_version_id:p.routineVersionId,p_expected_version:Number(p.expectedVersion),p_base:p.base,p_patch:routinePatch(e,p.base,p.remoteVialId)}];
    if(operation.type==='delete')return ['soft_delete_routine_versioned',{p_operation_id:operation.operationId,p_expected_user:user,p_routine_id:operation.entityId,
      p_new_routine_version_id:p.routineVersionId,p_expected_version:Number(p.expectedVersion),p_base:p.base}];
  }
  throw new SyncApiError('Tipo ainda não sincronizável.',{status:400,code:'UNSUPPORTED_TYPE'});
}
export function createSyncApi({client,config,fetchImpl=globalThis.fetch,clock=()=>Date.now()}={}){
  if(!client?.auth?.getSession||!client?.auth?.refreshSession||typeof fetchImpl!=='function')throw new Error('Cliente Auth e transporte HTTP obrigatórios.');
  const origin=new URL(config?.supabaseUrl||'');
  if(origin.protocol!=='https:'||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config?.supabasePublishableKey||''))throw new Error('Configuração pública inválida para sincronização.');
  async function send(operation){
    const p=operation.payload||{};let name,args;
    if(operation.type==='application'){
      name='register_application';args={p_operation_id:operation.operationId,p_expected_user:p.expectedUserId,
        p_routine_id:p.routineId,p_routine_version_id:p.routineVersionId,p_vial_id:p.vialId,p_scheduled_date:p.scheduledDate,p_applied_at:p.appliedAt??null};
    }else if(operation.type==='undo'){
      name='undo_application';args={p_undo_operation_id:operation.operationId,p_expected_user:p.expectedUserId,p_application_id:p.applicationId,p_undone_at:p.undoneAt??null};
    }else [name,args]=entityRpc(operation);
    let session;
    try{const result=await client.auth.getSession();if(result.error)throw result.error;session=result.data?.session}
    catch(error){throw new SyncApiError('Sessão indisponível.',{status:401,code:error?.code||'AUTH_SESSION_ERROR'})}
    if(!session?.access_token)throw new SyncApiError('Sessão ausente.',{status:401,code:'AUTH_SESSION_MISSING'});
    let response;
    try{response=await fetchImpl(new URL(`/rest/v1/rpc/${name}`,origin).href,{method:'POST',cache:'no-store',headers:{
      apikey:config.supabasePublishableKey,Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json',Accept:'application/json'
    },body:JSON.stringify(args)})}catch(error){throw new SyncApiError('Falha de rede.',{status:0,code:error?.code||'NETWORK_ERROR'})}
    const data=await safeJson(response);
    if(!response.ok)throw new SyncApiError(data?.message||`HTTP ${response.status}`,{status:response.status,code:data?.code||`HTTP_${response.status}`,
      retryAfterMs:parseRetryAfter(response.headers.get('Retry-After'),clock())});
    if(data?.outcome==='conflict')throw new SyncApiError('Conflito remoto.',{status:409,code:data.code||'CONFLICT'});
    if(operation.entityType==='vial'){
      if(data?.outcome!=='success'||!data?.vial?.id)throw new SyncApiError('Resposta RPC de frasco incompleta.',{status:502,code:'INVALID_RPC_RESPONSE'});
      return {replay:Boolean(data.replay),vial:data.vial};
    }
    if(operation.entityType==='routine'){
      if(data?.outcome!=='success'||!data?.routine?.id||!data?.routine_version_id)throw new SyncApiError('Resposta RPC de rotina incompleta.',{status:502,code:'INVALID_RPC_RESPONSE'});
      return {replay:Boolean(data.replay),routine:data.routine,routineVersionId:data.routine_version_id};
    }
    if(!data?.application||!data?.movement||!data?.vial)throw new SyncApiError('Resposta RPC incompleta.',{status:502,code:'INVALID_RPC_RESPONSE'});
    return {replay:Boolean(data.replay),application:data.application,movement:data.movement,vial:data.vial};
  }
  return Object.freeze({send,async refreshSession(){const {error}=await client.auth.refreshSession();if(error)throw new SyncApiError('Sessão expirada.',{status:401,code:error.code||'AUTH_REFRESH_FAILED'})}});
}
