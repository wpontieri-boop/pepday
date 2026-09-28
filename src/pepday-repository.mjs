import { openLocalDatabase } from './local-db.mjs';
import { createSyncOutbox, enqueueOutboxInTransaction } from './sync-outbox.mjs';

const ENTITY_STORES=new Set(['vials','routines','routineVersions','applications','vialMovements']);
const WRITABLE_COLLECTIONS=new Set(['vials','routines','drafts','meta','migrationReceipts']);
const SCOPE_PATTERN=/^(user|device):[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function clone(value){return value==null?value:structuredClone(value)}
export function assertAccountScope(value){
  if(typeof value!=='string'||!SCOPE_PATTERN.test(value))throw new Error('Escopo local inválido.');
  return value;
}
function assertId(value){if(typeof value!=='string'||!value.trim())throw new Error('Identificador local obrigatório.');return value}

function recordFor(accountScope,id,data,previous=null){
  const now=new Date().toISOString();
  return {accountScope,id,data:clone(data),localRevision:(previous?.localRevision||0)+1,
    syncState:'local',createdAtLocal:previous?.createdAtLocal||now,updatedAtLocal:now};
}
function dataFrom(record){return record?clone(record.data):null}

function collection(database,getScope,storeName,{readonly=false}={}){
  return Object.freeze({
    async list(){
      const scope=getScope();
      const rows=await database.read(storeName,store=>store.getAllByScope(scope));
      return rows.sort((a,b)=>String(a.createdAtLocal||'').localeCompare(String(b.createdAtLocal||''))).map(dataFrom);
    },
    async get(id){
      const scope=getScope();
      return dataFrom(await database.read(storeName,store=>store.get(scope,assertId(id))));
    },
    async put(value){
      if(readonly)throw new Error(`${storeName} aceita somente registros confirmados em fase futura.`);
      const id=assertId(value?.id),scope=getScope();
      return database.write(storeName,async store=>{
        const previous=await store.get(scope,id);
        await store.put(recordFor(scope,id,value,previous));
        return clone(value);
      });
    },
    async delete(id){
      if(readonly)throw new Error(`${storeName} não pode ser removida pelo repository local.`);
      const scope=getScope();
      await database.write(storeName,store=>store.delete(scope,assertId(id)));
    },
    async clear(){
      if(readonly)throw new Error(`${storeName} não pode ser limpa pelo repository local.`);
      const scope=getScope();
      await database.write(storeName,async store=>{
        const rows=await store.getAllByScope(scope);
        for(const row of rows)await store.delete(scope,row.id);
      });
    }
  });
}

export function createPepDayRepository({database,accountScope,outboxOptions={}}){
  if(!database?.transaction)throw new Error('Banco local obrigatório.');
  let activeScope=assertAccountScope(accountScope);
  const getScope=()=>activeScope;
  const outbox=createSyncOutbox({database,getAccountScope:getScope,...outboxOptions});
  const repositoryClock=outboxOptions.clock||Date.now;
  const outboxNow=()=>new Date(repositoryClock()).toISOString();
  const randomUUID=()=>{const fn=outboxOptions.cryptoProvider?.randomUUID||globalThis.crypto?.randomUUID;if(!fn)throw new Error('UUID seguro indisponível.');return fn.call(outboxOptions.cryptoProvider||globalThis.crypto)};
  const entityTypeFor=storeName=>storeName==='vials'?'vial':'routine';
  const remoteVersion=(storeName,ref)=>storeName==='vials'?ref?.editVersion:ref?.version;
  function entityPayload(storeName,scope,entity,previous){
    const ref=previous?.data?.remoteRef||null;
    return {expectedUserId:scope.startsWith('user:')?scope.slice(5):null,entity:clone(entity),
      base:clone(ref?.snapshot||null),expectedVersion:remoteVersion(storeName,ref)||null,
      routineVersionId:storeName==='routines'?randomUUID():null};
  }
  async function priorEntityOperation(tx,scope,entityType,entityId){
    const rows=await tx.outbox.getAllByScope(scope);
    return rows.filter(row=>row.entityType===entityType&&row.entityId===entityId&&['pending','syncing'].includes(row.status))
      .sort((a,b)=>b.sequence-a.sequence)[0]||null;
  }
  async function saveEntityWithOutbox(storeName,entity,{operationId,type,draft=null,clearDraft=false}={}){
    const scope=getScope(),id=assertId(entity?.id),entityType=entityTypeFor(storeName),stores=[storeName,'outbox','meta'];
    if(storeName==='routines')stores.push('vials');
    if(draft||clearDraft)stores.push('drafts');
    return database.transaction(stores,'readwrite',async tx=>{
      const previous=await tx[storeName].get(scope,id),operationType=type||(previous?'edit':'create'),prior=await priorEntityOperation(tx,scope,entityType,id);
      const next=recordFor(scope,id,entity,previous);await tx[storeName].put(next);
      if(draft){const priorDraft=await tx.drafts.get(scope,assertId(draft.id));await tx.drafts.put(recordFor(scope,draft.id,draft,priorDraft))}
      if(clearDraft)await tx.drafts.delete(scope,'routine-form');
      const payload=entityPayload(storeName,scope,entity,previous),dependencies=[];
      let blockedReason=null;
      if(operationType!=='create'&&prior&&!(prior.type==='create'&&prior.status==='pending'&&prior.attemptCount===0)){
        dependencies.push(prior.operationId);blockedReason='remote-prerequisites';
      }else if(operationType!=='create'&&!payload.base)blockedReason='remote-prerequisites';
      if(storeName==='routines'&&entity?.vialId){
        const vial=await tx.vials.get(scope,entity.vialId),vialRef=vial?.data?.remoteRef;
        payload.remoteVialId=vialRef?.id||entity.vialId;
        if(!vialRef?.id){const vialPrior=await priorEntityOperation(tx,scope,'vial',entity.vialId);if(vialPrior&&!dependencies.includes(vialPrior.operationId))dependencies.push(vialPrior.operationId);else if(!vialPrior)blockedReason=blockedReason||'remote-vial-prerequisite'}
      }
      const queued=await enqueueOutboxInTransaction({stores:tx,accountScope:scope,now:outboxNow(),input:{operationId,
        type:operationType,entityType,entityId:id,payload,baseVersion:previous?.localRevision||null,dependencies,blockedReason}});
      return {entity:clone(entity),outbox:queued};
    });
  }
  async function deleteEntityWithOutbox(storeName,id,{operationId,dependencies=[]}={}){
    const scope=getScope(),entityId=assertId(id),entityType=entityTypeFor(storeName);
    return database.transaction([storeName,'outbox','meta'],'readwrite',async tx=>{
      const previous=await tx[storeName].get(scope,entityId),prior=await priorEntityOperation(tx,scope,entityType,entityId),payload=entityPayload(storeName,scope,null,previous);
      await tx[storeName].delete(scope,entityId);
      const nextDependencies=[...dependencies];let blockedReason=null;
      if(prior&&!(prior.type==='create'&&prior.status==='pending'&&prior.attemptCount===0)){nextDependencies.push(prior.operationId);blockedReason='remote-prerequisites'}
      else if(!payload.base)blockedReason='remote-prerequisites';
      const queued=await enqueueOutboxInTransaction({stores:tx,accountScope:scope,now:outboxNow(),input:{operationId,type:'delete',
        entityType,entityId,payload,baseVersion:previous?.localRevision||null,dependencies:[...new Set(nextDependencies)],blockedReason}});
      return {entity:previous?dataFrom(previous):null,outbox:queued};
    });
  }
  const repository={
    get accountScope(){return activeScope},
    setAccountScope(next){activeScope=assertAccountScope(next);return activeScope},
    vials:collection(database,getScope,'vials'),
    routines:collection(database,getScope,'routines'),
    routineVersions:collection(database,getScope,'routineVersions',{readonly:true}),
    applications:collection(database,getScope,'applications',{readonly:true}),
    vialMovements:collection(database,getScope,'vialMovements',{readonly:true}),
    drafts:collection(database,getScope,'drafts'),
    meta:collection(database,getScope,'meta'),
    migrationReceipts:collection(database,getScope,'migrationReceipts'),
    outbox,
    async enqueueApplicationIntent({operationId,routine,vial,scheduledDate}){
      const scope=getScope();if(!scope.startsWith('user:'))throw new Error('Application exige conta autenticada.');
      const rr=routine?.remoteRef,vr=vial?.remoteRef,remote=rr?.status==='synced'&&vr?.status==='synced'&&rr.id&&rr.versionId&&vr.id;
      return outbox.enqueue({operationId,type:'application',entityType:'application',entityId:`${assertId(routine?.id)}:${scheduledDate}`,
        dependencies:[],blockedReason:remote?null:'remote-prerequisites',payload:{expectedUserId:scope.slice(5),localRoutineId:routine.id,
          localVialId:assertId(vial?.id),routineId:remote?rr.id:null,routineVersionId:remote?rr.versionId:null,vialId:remote?vr.id:null,
          scheduledDate,appliedAt:null}});
    },
    async enqueueUndoIntent({operationId,application,localRoutineId,localVialId,scheduledDate}){
      const scope=getScope();if(!scope.startsWith('user:'))throw new Error('Undo exige conta autenticada.');
      const dependency=await outbox.get(application?.operation_id);
      if(!dependency||dependency.status!=='synced'){const error=new Error('Application correspondente ainda não foi confirmada.');error.code='MISSING_CONFIRMED_APPLICATION';throw error}
      return outbox.enqueue({operationId,type:'undo',entityType:'application',entityId:assertId(application?.id),dependencies:[application.operation_id],
        payload:{expectedUserId:scope.slice(5),applicationId:application.id,localRoutineId:assertId(localRoutineId),localVialId:assertId(localVialId),scheduledDate,undoneAt:null}});
    },
    async acquireSyncLeader({ownerId,accountScope=getScope(),leaseMs=30000,now=Date.now()}={}){
      const scope=assertAccountScope(accountScope),id='sync-leader';
      return database.write('meta',async store=>{
        const prior=await store.get(scope,id),expires=Date.parse(prior?.data?.leaseExpiresAt||0);
        if(prior&&prior.data.ownerId!==ownerId&&expires>now)return false;
        const data={id,ownerId,leaseExpiresAt:new Date(now+leaseMs).toISOString()};
        await store.put(recordFor(scope,id,data,prior));return true;
      });
    },
    async releaseSyncLeader(ownerId,accountScope=getScope()){
      const scope=assertAccountScope(accountScope),id='sync-leader';
      await database.write('meta',async store=>{const row=await store.get(scope,id);if(row?.data?.ownerId===ownerId)await store.delete(scope,id)});
    },
    async persistRemoteConfirmation({accountScope,operationId,workerId,response}){
      const ensureScope=()=>{if(activeScope!==accountScope){const error=new Error('Escopo mudou durante a sincronização.');error.code='STALE_SCOPE';throw error}};
      ensureScope();
      return database.transaction(['applications','vialMovements','vials','routines','routineVersions','outbox'],'readwrite',async stores=>{
        ensureScope();
        const queued=await stores.outbox.get(accountScope,operationId);
        const ensureLease=()=>{
          if(!queued||queued.status!=='syncing'||queued.leaseOwner!==workerId){const error=new Error('Lease perdida.');error.code='LEASE_LOST';throw error}
          if(Date.parse(queued.leaseExpiresAt)<=repositoryClock()){const error=new Error('Lease expirado.');error.code='LEASE_EXPIRED';throw error}
        };
        const invalid=()=>{const error=new Error('Resposta remota incompleta.');error.code='INVALID_CONFIRMATION';throw error};
        const putConfirmed=async(name,id,value)=>{const prior=await stores[name].get(accountScope,id);await stores[name].put({...recordFor(accountScope,id,value,prior),syncState:'synced'});return prior};
        const unblockDependents=async(snapshot,version)=>{
          const rows=await stores.outbox.getAllByScope(accountScope);
          for(const row of rows){
            if(row.status!=='pending'||row.blockedReason!=='remote-prerequisites'||row.entityType!==queued.entityType||row.entityId!==queued.entityId||!row.dependencies?.includes(operationId))continue;
            row.payload={...(row.payload||{}),base:clone(snapshot),expectedVersion:version};row.blockedReason=null;row.updatedAt=outboxNow();await stores.outbox.put(row);
          }
        };
        ensureLease();
        if(queued.entityType==='application'){
          const application=response?.application,movement=response?.movement,vial=response?.vial;
          if(!application?.id||!movement?.id||!vial?.id||vial.remaining_mg==null)invalid();
          const applicationData={...application,localRoutineId:queued.payload?.localRoutineId||application.localRoutineId||null};
          await putConfirmed('applications',application.id,applicationData);await putConfirmed('vialMovements',movement.id,movement);
          const localVialId=queued.payload?.localVialId||vial.id,priorVial=await stores.vials.get(accountScope,localVialId),oldRef=priorVial?.data?.remoteRef||{};
          const snapshot=oldRef.snapshot?{...oldRef.snapshot,remaining_mg:Number(vial.remaining_mg)}:oldRef.snapshot;
          const vialData={...(priorVial?.data||{}),id:localVialId,remoteRef:{...oldRef,status:'synced',id:vial.id,...(snapshot?{snapshot}: {})},remainingMg:Number(vial.remaining_mg)};
          await stores.vials.put({...recordFor(accountScope,localVialId,vialData,priorVial),syncState:'synced'});
        }else if(queued.entityType==='vial'){
          const vial=response?.vial;if(!vial?.id||vial.edit_version==null||vial.version==null)invalid();
          if(queued.type!=='delete'){
            const localId=queued.entityId,prior=await stores.vials.get(accountScope,localId);if(!prior)invalid();
            const current=prior.data||{},data={...current,id:localId,name:vial.name??current.name,
              initialMg:vial.initial_mg==null?current.initialMg:Number(vial.initial_mg),remainingMg:vial.remaining_mg==null?current.remainingMg:Number(vial.remaining_mg),
              waterMl:vial.water_ml==null?current.waterMl:Number(vial.water_ml),date:vial.prepared_on??current.date,cost:vial.cost==null?(current.cost??0):Number(vial.cost),active:vial.active??current.active,
              remoteRef:{status:'synced',id:vial.id,version:Number(vial.version),editVersion:Number(vial.edit_version),snapshot:clone(vial)}};
            await stores.vials.put({...recordFor(accountScope,localId,data,prior),syncState:'synced'});
          }
          await unblockDependents(vial,Number(vial.edit_version));
        }else if(queued.entityType==='routine'){
          const routine=response?.routine,versionId=response?.routineVersionId;if(!routine?.id||routine.version==null||!versionId)invalid();
          if(queued.type!=='delete'){
            const localId=queued.entityId,prior=await stores.routines.get(accountScope,localId);if(!prior)invalid();
            const current=prior.data||{},data={...current,id:localId,name:routine.name??current.name,doseValue:routine.dose_value==null?current.doseValue:Number(routine.dose_value),
              doseUnit:routine.dose_unit??current.doseUnit,syringeCapacity:routine.syringe_capacity==null?current.syringeCapacity:Number(routine.syringe_capacity),
              frequency:routine.frequency??current.frequency,weekdays:Array.isArray(routine.weekdays)?routine.weekdays:current.weekdays,start:routine.start_date??current.start,
              time:routine.time_of_day??current.time,refillAt:routine.refill_at==null?current.refillAt:Number(routine.refill_at),
              remoteRef:{status:'synced',id:routine.id,versionId,version:Number(routine.version),snapshot:clone(routine)}};
            await stores.routines.put({...recordFor(accountScope,localId,data,prior),syncState:'synced'});
          }
          const versionData={id:versionId,routineId:queued.entityId,remoteRoutineId:routine.id,version:Number(routine.version),snapshot:clone(routine)};
          await putConfirmed('routineVersions',versionId,versionData);await unblockDependents(routine,Number(routine.version));
        }else invalid();
        ensureLease();ensureScope();
        queued.status='synced';queued.transportReplay=Boolean(response.replay);queued.nextAttemptAt=null;queued.lastErrorCode=null;
        queued.leaseOwner=null;queued.leaseExpiresAt=null;queued.updatedAt=outboxNow();await stores.outbox.put(queued);
        ensureScope();return clone(queued);
      });
    },
    async importLegacy({receiptId,sourceHash,routines,vials,validateSource=()=>true}){
      const scope=getScope();
      assertId(receiptId);
      return database.transaction(['routines','vials','migrationReceipts'],'readwrite',async stores=>{
        const prior=await stores.migrationReceipts.get(scope,receiptId);
        if(prior)return {status:'already-migrated',receipt:dataFrom(prior)};
        for(const [storeName,items] of [['vials',vials],['routines',routines]]){
          for(const item of items){
            const id=assertId(item?.id),existing=await stores[storeName].get(scope,id);
            if(existing && JSON.stringify(existing.data)!==JSON.stringify(item)){
              throw new Error(`Conflito ao migrar ${storeName}:${id}. Nada foi alterado.`);
            }
            if(!existing)await stores[storeName].put(recordFor(scope,id,item));
          }
        }
        if(validateSource()!==true){
          const error=new Error('A origem local mudou durante a migração. Nenhum recibo foi criado.');
          error.code='LEGACY_SOURCE_CHANGED';throw error;
        }
        const receipt={id:receiptId,sourceHash,sourceKeys:['pepday_v1_routines','pepday_v2_vials'],
          routineCount:routines.length,vialCount:vials.length,migratedAt:new Date().toISOString()};
        await stores.migrationReceipts.put(recordFor(scope,receiptId,receipt));
        return {status:'migrated',receipt};
      });
    },
    async saveRoutineAndClearDraft(routine,draftId='routine-form'){
      const scope=getScope(),id=assertId(routine?.id);
      await database.transaction(['routines','drafts'],'readwrite',async stores=>{
        const previous=await stores.routines.get(scope,id);
        await stores.routines.put(recordFor(scope,id,routine,previous));
        await stores.drafts.delete(scope,assertId(draftId));
      });
      return clone(routine);
    },
    async saveVialWithDraft(vial,draft){
      const scope=getScope(),vialId=assertId(vial?.id),draftId=assertId(draft?.id);
      await database.transaction(['vials','drafts'],'readwrite',async stores=>{
        const previousVial=await stores.vials.get(scope,vialId),previousDraft=await stores.drafts.get(scope,draftId);
        await stores.vials.put(recordFor(scope,vialId,vial,previousVial));
        await stores.drafts.put(recordFor(scope,draftId,draft,previousDraft));
      });
      return {vial:clone(vial),draft:clone(draft)};
    },
    saveRoutineWithOutbox(routine,options){return saveEntityWithOutbox('routines',routine,{...options,clearDraft:true})},
    saveVialWithOutbox(vial,options){return saveEntityWithOutbox('vials',vial,options)},
    saveVialWithDraftAndOutbox(vial,draft,options){return saveEntityWithOutbox('vials',vial,{...options,draft})},
    deleteRoutineWithOutbox(id,options){return deleteEntityWithOutbox('routines',id,options)},
    deleteVialWithOutbox(id,options){return deleteEntityWithOutbox('vials',id,options)},
    async clearUserData(){
      const scope=getScope(),stores=['routines','vials','drafts'];
      await database.transaction(stores,'readwrite',async txStores=>{
        for(const name of stores){
          const rows=await txStores[name].getAllByScope(scope);
          for(const row of rows)await txStores[name].delete(scope,row.id);
        }
      });
    },
    async confirmedCounts(){
      const scope=getScope();
      return database.transaction(['applications','vialMovements'],'readonly',async stores=>({
        applications:(await stores.applications.getAllByScope(scope)).length,
        vialMovements:(await stores.vialMovements.getAllByScope(scope)).length
      }));
    },
    close(){database.close?.()}
  };
  return Object.freeze(repository);
}

export async function openPepDayRepository({accountScope,indexedDBFactory,databaseName,outboxOptions}={}){
  const database=await openLocalDatabase({indexedDBFactory,name:databaseName});
  return createPepDayRepository({database,accountScope,outboxOptions});
}

export async function openDeviceRepository({indexedDBFactory,databaseName,database:providedDatabase,cryptoProvider=globalThis.crypto}={}){
  if(!cryptoProvider?.randomUUID)throw new Error('Não foi possível identificar esta instalação.');
  const database=providedDatabase||await openLocalDatabase({indexedDBFactory,name:databaseName});
  try{
    const bootstrapScope='device:bootstrap';
    const installation=await database.transaction('meta','readwrite',async stores=>{
      const store=stores.meta,existing=await store.get(bootstrapScope,'installation-id');
      if(existing)return dataFrom(existing);
      const created={id:'installation-id',value:cryptoProvider.randomUUID()};
      await store.put(recordFor(bootstrapScope,created.id,created));
      return created;
    });
    return createPepDayRepository({database,accountScope:`device:${installation.value}`});
  }catch(error){if(!providedDatabase)database.close();throw error}
}

export const repositoryStores=Object.freeze({entities:[...ENTITY_STORES],writable:[...WRITABLE_COLLECTIONS]});
