function retryAfter(error){
  const raw=error?.context?.headers?.get?.('retry-after')??error?.retryAfter;
  if(raw==null)return null;const seconds=Number(raw);if(Number.isFinite(seconds))return Math.max(0,seconds*1000);
  const date=Date.parse(raw);return Number.isFinite(date)?Math.max(0,date-Date.now()):null;
}
export class SyncApiError extends Error{
  constructor(message,{status=0,code='SYNC_ERROR',retryAfterMs=null}={}){super(message||'Falha de sincronização.');this.name='SyncApiError';this.status=status;this.code=code;this.retryAfterMs=retryAfterMs}
}
export function createSyncApi({client}={}){
  if(!client?.rpc)throw new Error('Cliente Supabase obrigatório.');
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
    const {data,error,status}=await client.rpc(name,args);
    if(error)throw new SyncApiError(error.message,{status:status||error.status||0,code:error.code||'RPC_ERROR',retryAfterMs:retryAfter(error)});
    if(!data?.application||!data?.movement||!data?.vial)throw new SyncApiError('Resposta RPC incompleta.',{status:502,code:'INVALID_RPC_RESPONSE'});
    return {replay:Boolean(data.replay),application:data.application,movement:data.movement,vial:data.vial};
  }
  return Object.freeze({send,async refreshSession(){const {error}=await client.auth.refreshSession();if(error)throw new SyncApiError('Sessão expirada.',{status:401,code:error.code||'AUTH_REFRESH_FAILED'})}});
}
