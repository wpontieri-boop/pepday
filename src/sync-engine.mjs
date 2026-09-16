const SUPPORTED=Object.freeze(['application','undo']);
const waitCode=error=>String(error?.code||'SYNC_ERROR').slice(0,80);
function category(error){
  const status=Number(error?.status||0),code=waitCode(error),message=String(error?.message||'').toLowerCase();
  if(status===401)return 'auth';if(status===403)return 'entitlement';if(status===429)return 'temporary';
  if(status>=500||status===0)return 'temporary';
  if(['23505','P0001','CONFLICT'].includes(code)||message.includes('conflit')||message.includes('já foi desfeita'))return 'conflict';
  if(status>=400&&status<500)return 'permanent';return 'temporary';
}
export function createSyncEngine({repository,api,coordinator,online=()=>globalThis.navigator?.onLine!==false,
  clock=()=>Date.now(),random=Math.random,windowTarget=globalThis.window,documentTarget=globalThis.document,
  setTimer=setTimeout,clearTimer=clearTimeout,maxBackoffMs=300000}={}){
  if(!repository?.outbox||!api?.send||!coordinator?.runExclusive)throw new Error('Dependências de sincronização obrigatórias.');
  let active=false,paused=false,generation=0,running=null,timer=null;
  const workerId=coordinator.ownerId;
  const valid=(token,scope)=>active&&!paused&&token===generation&&repository.accountScope===scope;
  const backoff=attempt=>Math.min(maxBackoffMs,1000*2**Math.max(0,attempt-1)*(0.75+random()*0.5));
  async function settleFailure(op,error,token,scope){
    if(!valid(token,scope))return;
    const kind=category(error);
    if(kind==='auth'||kind==='entitlement')paused=true;
    await repository.outbox.settle(op.operationId,{workerId,outcome:kind==='conflict'?'conflict':kind==='permanent'?'permanent':'temporary',
      errorCode:waitCode(error),retryAfterMs:error?.retryAfterMs??(kind==='temporary'?backoff(op.attemptCount):0)});
  }
  async function transmit(op,token,scope){
    let response;
    try{response=await api.send(op)}catch(error){
      if(category(error)==='auth'){
        try{await api.refreshSession();if(!valid(token,scope))return;response=await api.send(op)}catch(refreshError){await settleFailure(op,refreshError,token,scope);return}
      }else{await settleFailure(op,error,token,scope);return}
    }
    if(!valid(token,scope))return;
    // Falha local deixa syncing: o lease expira e o mesmo UUID repara via replay.
    await repository.persistRemoteConfirmation({accountScope:scope,operationId:op.operationId,workerId,response});
  }
  async function drain(token,scope){
    if(!valid(token,scope)||!online())return {processed:0,offline:!online()};let processed=0;
    const result=await coordinator.runExclusive(scope,async()=>{
      while(valid(token,scope)&&online()){
        const op=await repository.outbox.claimNext({workerId,allowedTypes:SUPPORTED});if(!op)break;
        await transmit(op,token,scope);processed++;
        if(paused)break;
      }
      return processed;
    });return {processed,leader:result.acquired};
  }
  async function run(){
    if(running)return running;const token=generation,scope=repository.accountScope;
    running=drain(token,scope).finally(async()=>{running=null;
      if(!valid(token,scope)||!online())return;
      const pending=(await repository.outbox.list()).filter(row=>SUPPORTED.includes(row.type)&&['pending','syncing'].includes(row.status));
      const next=Math.min(...pending.map(row=>Date.parse(row.status==='syncing'?row.leaseExpiresAt:row.nextAttemptAt)).filter(Number.isFinite));
      if(Number.isFinite(next)){if(timer)clearTimer(timer);timer=setTimer(()=>{timer=null;trigger()},Math.max(0,next-clock()))}
    });return running;
  }
  function trigger(){if(!active||paused)return Promise.resolve({processed:0});return run().catch(error=>({processed:0,error}))}
  const visible=()=>{if(documentTarget?.visibilityState==='visible')trigger()};
  const focus=()=>trigger();
  return Object.freeze({
    start(){if(active)return trigger();active=true;paused=false;generation++;windowTarget?.addEventListener?.('online',focus);windowTarget?.addEventListener?.('focus',focus);documentTarget?.addEventListener?.('visibilitychange',visible);return trigger()},
    stop(){active=false;paused=false;generation++;if(timer)clearTimer(timer);timer=null;windowTarget?.removeEventListener?.('online',focus);windowTarget?.removeEventListener?.('focus',focus);documentTarget?.removeEventListener?.('visibilitychange',visible)},
    resume(){paused=false;return trigger()},trigger,get paused(){return paused},get running(){return Boolean(running)}
  });
}
