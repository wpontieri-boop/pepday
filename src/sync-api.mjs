export function parseRetryAfter(value,now=Date.now()){
  if(value==null||String(value).trim()==='')return null;
  const raw=String(value).trim();
  if(/^\d+(?:\.\d+)?$/.test(raw))return Math.max(0,Number(raw)*1000);
  const date=Date.parse(raw);return Number.isFinite(date)?Math.max(0,date-now):null;
}
export class SyncApiError extends Error{
  constructor(message,{status=0,code='SYNC_ERROR',retryAfterMs=null}={}){super(message||'Falha de sincronização.');this.name='SyncApiError';this.status=status;this.code=code;this.retryAfterMs=retryAfterMs}
}
async function safeJson(response){try{return await response.json()}catch{return null}}
export function createSyncApi({client,config,fetchImpl=globalThis.fetch,clock=()=>Date.now()}={}){
  if(!client?.auth?.getSession||!client?.auth?.refreshSession||typeof fetchImpl!=='function')throw new Error('Cliente Auth e transporte HTTP obrigatórios.');
  const origin=new URL(config?.supabaseUrl||'');
  if(origin.protocol!=='https:'||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config?.supabasePublishableKey||''))throw new Error('Configuração pública inválida para sincronização.');
  async function send(operation){
    const p=operation.payload||{};let name,args;
    if(operation.type==='application'){
      name='register_application';args={p_operation_id:operation.operationId,p_expected_user:p.expectedUserId,
        p_routine_id:p.routineId,p_routine_version_id:p.routineVersionId,p_vial_id:p.vialId,
        p_scheduled_date:p.scheduledDate,p_applied_at:p.appliedAt??null};
    }else if(operation.type==='undo'){
      name='undo_application';args={p_operation_id:operation.operationId,p_expected_user:p.expectedUserId,
        p_application_id:p.applicationId,p_undone_at:p.undoneAt??null};
    }else throw new SyncApiError('Tipo ainda não sincronizável.',{status:400,code:'UNSUPPORTED_TYPE'});
    let session;
    try{const result=await client.auth.getSession();if(result.error)throw result.error;session=result.data?.session}catch(error){throw new SyncApiError('Sessão indisponível.',{status:401,code:error?.code||'AUTH_SESSION_ERROR'})}
    if(!session?.access_token)throw new SyncApiError('Sessão ausente.',{status:401,code:'AUTH_SESSION_MISSING'});
    let response;
    try{response=await fetchImpl(new URL(`/rest/v1/rpc/${name}`,origin).href,{method:'POST',cache:'no-store',headers:{
      apikey:config.supabasePublishableKey,Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json',Accept:'application/json'
    },body:JSON.stringify(args)})}catch(error){throw new SyncApiError('Falha de rede.',{status:0,code:error?.code||'NETWORK_ERROR'})}
    const data=await safeJson(response);
    if(!response.ok)throw new SyncApiError(data?.message||`HTTP ${response.status}`,{status:response.status,
      code:data?.code||`HTTP_${response.status}`,retryAfterMs:parseRetryAfter(response.headers.get('Retry-After'),clock())});
    if(!data?.application||!data?.movement||!data?.vial)throw new SyncApiError('Resposta RPC incompleta.',{status:502,code:'INVALID_RPC_RESPONSE'});
    return {replay:Boolean(data.replay),application:data.application,movement:data.movement,vial:data.vial};
  }
  return Object.freeze({send,async refreshSession(){const {error}=await client.auth.refreshSession();if(error)throw new SyncApiError('Sessão expirada.',{status:401,code:error.code||'AUTH_REFRESH_FAILED'})}});
}
