export const OUTBOX_STATUSES=Object.freeze(['pending','syncing','synced','failed','conflict']);
const STATUS_SET=new Set(OUTBOX_STATUSES);
const NON_COMPACTABLE=new Set(['application','undo']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const clone=value=>value==null?value:structuredClone(value);
const iso=value=>new Date(value).toISOString();
const millis=value=>new Date(value).getTime();
function fail(code,message){const error=new Error(message);error.code=code;throw error}
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}
function fingerprint(input){
  return JSON.stringify(stable({type:input.type,entityType:input.entityType,entityId:input.entityId,
    payload:input.payload,baseVersion:input.baseVersion??null,dependencies:input.dependencies||[]}));
}
function validateInput(input,scope){
  if(!input||typeof input!=='object')fail('INVALID_OPERATION','Operação obrigatória.');
  if(!UUID.test(input.operationId||''))fail('INVALID_OPERATION_ID','operationId deve ser UUID.');
  for(const field of ['type','entityType','entityId'])if(typeof input[field]!=='string'||!input[field])fail('INVALID_OPERATION',`${field} obrigatório.`);
  const dependencies=[...new Set(input.dependencies||[])];
  if(!dependencies.every(id=>UUID.test(id)))fail('INVALID_DEPENDENCY','Dependência inválida.');
  if(dependencies.includes(input.operationId))fail('CIRCULAR_DEPENDENCY','Operação não pode depender de si mesma.');
  return {...clone(input),accountScope:scope,dependencies,payload:clone(input.payload??null),baseVersion:input.baseVersion??null};
}
function intentEntry(input){return {operationId:input.operationId,fingerprint:fingerprint(input)}}
function ownsIntent(row,operationId){return (row.intents||[]).some(intent=>intent.operationId===operationId)}
function sameIntent(row,input){return (row.intents||[]).some(intent=>intent.operationId===input.operationId&&intent.fingerprint===fingerprint(input))}
function cancellationRecord(scope,input,now,createOperationId){
  return {accountScope:scope,id:`outbox-cancel:${input.operationId}`,data:{operationId:input.operationId,
    fingerprint:fingerprint(input),createOperationId,canceledAt:now},localRevision:1,syncState:'local',createdAtLocal:now,updatedAtLocal:now};
}

async function allRows(stores){return stores.outbox.getAll()}
async function findIntent(stores,operationId){
  const direct=await stores.outbox.getByIndex('operationId',operationId);
  if(direct)return direct;
  return (await allRows(stores)).find(row=>ownsIntent(row,operationId))||null;
}
async function findCancellation(stores,operationId){
  return (await stores.meta.getAll()).find(row=>row.id===`outbox-cancel:${operationId}`)||null;
}
async function nextSequence(stores,scope,now){
  const id='outbox-sequence',prior=await stores.meta.get(scope,id),value=(prior?.data?.value||0)+1;
  await stores.meta.put({accountScope:scope,id,data:{id,value},localRevision:(prior?.localRevision||0)+1,
    syncState:'local',createdAtLocal:prior?.createdAtLocal||now,updatedAtLocal:now});
  return value;
}
function eligibleCreate(rows,input){
  return rows.find(row=>row.accountScope===input.accountScope&&row.entityType===input.entityType&&row.entityId===input.entityId&&
    row.type==='create'&&row.status==='pending'&&row.attemptCount===0&&!row.leaseOwner);
}

export async function enqueueOutboxInTransaction({stores,accountScope,input,now=new Date().toISOString()}){
  const operation=validateInput(input,accountScope),all=await allRows(stores);
  const collision=await findIntent(stores,operation.operationId);
  if(collision){
    if(collision.accountScope!==accountScope||!sameIntent(collision,operation))fail('OPERATION_ID_CONFLICT','operationId reutilizado com intenção diferente.');
    return {operation:clone(collision),deduplicated:true,compacted:ownsIntent(collision,operation.operationId)&&collision.operationId!==operation.operationId};
  }
  const canceled=await findCancellation(stores,operation.operationId);
  if(canceled){
    if(canceled.accountScope!==accountScope||canceled.data.fingerprint!==fingerprint(operation))fail('OPERATION_ID_CONFLICT','operationId cancelado pertence a outra intenção.');
    return {canceled:true,deduplicated:true,receipt:clone(canceled.data)};
  }
  const byId=new Map(all.map(row=>[row.operationId,row]));
  for(const dependency of operation.dependencies){
    const target=byId.get(dependency);
    if(!target||target.accountScope!==accountScope)fail('MISSING_DEPENDENCY','Dependência inexistente no mesmo escopo.');
  }

  if(!NON_COMPACTABLE.has(operation.type)){
    const create=eligibleCreate(all,operation);
    if(create&&operation.type==='edit'){
      const updated={...create,payload:clone(operation.payload),updatedAt:now,
        intents:[...(create.intents||[]),intentEntry(operation)]};
      await stores.outbox.put(updated);
      return {operation:clone(updated),compacted:true,deduplicated:false};
    }
    if(create&&operation.type==='delete'){
      const ids=new Set((create.intents||[]).map(item=>item.operationId));ids.add(create.operationId);
      const blocked=all.some(row=>row!==create&&(row.entityType===operation.entityType&&row.entityId===operation.entityId||row.dependencies?.some(id=>ids.has(id))));
      if(!blocked){
        await stores.outbox.delete(accountScope,create.id);
        const receipt=cancellationRecord(accountScope,operation,now,create.operationId);await stores.meta.put(receipt);
        return {canceled:true,deduplicated:false,receipt:clone(receipt.data)};
      }
    }
  }

  const sequence=await nextSequence(stores,accountScope,now);
  const row={accountScope,id:operation.operationId,operationId:operation.operationId,type:operation.type,
    entityType:operation.entityType,entityId:operation.entityId,payload:clone(operation.payload),baseVersion:operation.baseVersion,
    sequence,dependencies:operation.dependencies,status:'pending',attemptCount:0,nextAttemptAt:now,leaseOwner:null,
    leaseExpiresAt:null,createdAt:now,updatedAt:now,lastErrorCode:null,intents:[intentEntry(operation)]};
  await stores.outbox.put(row);
  return {operation:clone(row),deduplicated:false,compacted:false};
}

export function createSyncOutbox({database,getAccountScope,clock=()=>Date.now(),leaseMs=30000,baseBackoffMs=1000}={}){
  if(!database?.transaction||typeof getAccountScope!=='function')throw new Error('Banco e escopo são obrigatórios para a outbox.');
  const scope=()=>getAccountScope();
  const nowIso=()=>iso(clock());
  const api={
    async enqueue(input){
      const accountScope=scope();
      return database.transaction(['outbox','meta'],'readwrite',stores=>enqueueOutboxInTransaction({stores,accountScope,input,now:nowIso()}));
    },
    async list(){
      const accountScope=scope(),rows=await database.read('outbox',store=>store.getAllByScope(accountScope));
      return rows.sort((a,b)=>a.sequence-b.sequence).map(clone);
    },
    async get(operationId){
      const accountScope=scope(),row=await database.read('outbox',store=>store.get(accountScope,operationId));return clone(row||null);
    },
    async claimNext({workerId,leaseDurationMs=leaseMs}={}){
      if(typeof workerId!=='string'||!workerId)fail('INVALID_WORKER','workerId obrigatório.');
      const accountScope=scope(),now=clock(),nowText=iso(now);
      return database.write('outbox',async store=>{
        const rows=(await store.getAllByScope(accountScope)).sort((a,b)=>a.sequence-b.sequence);
        const byId=new Map(rows.map(row=>[row.operationId,row]));
        for(const row of rows){
          if(row.status==='syncing'&&millis(row.leaseExpiresAt)<=now){row.status='pending';row.leaseOwner=null;row.leaseExpiresAt=null;row.updatedAt=nowText;await store.put(row)}
        }
        const candidate=rows.find(row=>row.status==='pending'&&millis(row.nextAttemptAt)<=now&&
          row.dependencies.every(id=>byId.get(id)?.status==='synced'));
        if(!candidate)return null;
        candidate.status='syncing';candidate.attemptCount+=1;candidate.leaseOwner=workerId;
        candidate.leaseExpiresAt=iso(now+leaseDurationMs);candidate.updatedAt=nowText;await store.put(candidate);return clone(candidate);
      });
    },
    async settle(operationId,{workerId,outcome,errorCode=null,retryAfterMs=null,transportConfirmed=false,replay=false}={}){
      if(!['success','temporary','conflict','permanent'].includes(outcome))fail('INVALID_OUTCOME','Resultado de transporte inválido.');
      const accountScope=scope(),now=clock(),nowText=iso(now);
      return database.write('outbox',async store=>{
        const row=await store.get(accountScope,operationId);
        if(!row||row.status!=='syncing'||row.leaseOwner!==workerId)fail('LEASE_LOST','Lease ausente ou pertencente a outro worker.');
        if(millis(row.leaseExpiresAt)<=now)fail('LEASE_EXPIRED','Lease expirado; a operação deve ser recuperada antes de concluir.');
        if(outcome==='success'&&!transportConfirmed)fail('TRANSPORT_CONFIRMATION_REQUIRED','Confirmação explícita do transporte obrigatória.');
        if(outcome==='success'){row.status='synced';row.transportReplay=Boolean(replay);row.nextAttemptAt=null;row.lastErrorCode=null}
        if(outcome==='temporary'){row.status='pending';row.nextAttemptAt=iso(now+(retryAfterMs??baseBackoffMs*Math.min(2**Math.max(0,row.attemptCount-1),64)));row.lastErrorCode=errorCode||'TEMPORARY'}
        if(outcome==='conflict'){row.status='conflict';row.nextAttemptAt=null;row.lastErrorCode=errorCode||'CONFLICT'}
        if(outcome==='permanent'){row.status='failed';row.nextAttemptAt=null;row.lastErrorCode=errorCode||'PERMANENT'}
        row.leaseOwner=null;row.leaseExpiresAt=null;row.updatedAt=nowText;await store.put(row);return clone(row);
      });
    },
    async processNext({workerId,transport,leaseDurationMs=leaseMs}={}){
      if(!transport?.send)throw new Error('Transporte mockado obrigatório.');
      const operation=await api.claimNext({workerId,leaseDurationMs});if(!operation)return null;
      let response;
      try{response=await transport.send(clone(operation))}
      catch(error){response={outcome:'temporary',errorCode:error?.code||'LOST_RESPONSE'}}
      const settled=await api.settle(operation.operationId,{workerId,...response});return {operation:settled,response:clone(response)};
    }
  };
  return Object.freeze(api);
}

export function createMockTransport({behaviors={}}={}){
  const accepted=new Set();
  return Object.freeze({
    async send(operation){
      const behavior=behaviors[operation.operationId]||'success';
      if(accepted.has(operation.operationId))return {outcome:'success',transportConfirmed:true,replay:true};
      if(behavior==='success'){accepted.add(operation.operationId);return {outcome:'success',transportConfirmed:true,replay:false}}
      if(behavior==='temporary')return {outcome:'temporary',errorCode:'TEMPORARY'};
      if(behavior==='conflict')return {outcome:'conflict',errorCode:'CONFLICT'};
      if(behavior==='permanent')return {outcome:'permanent',errorCode:'PERMANENT'};
      if(behavior==='lost-response'){accepted.add(operation.operationId);const error=new Error('Resposta perdida');error.code='LOST_RESPONSE';throw error}
      throw new Error(`Comportamento mock desconhecido: ${behavior}`);
    }
  });
}
