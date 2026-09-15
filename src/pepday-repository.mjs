import { openLocalDatabase } from './local-db.mjs';

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

export function createPepDayRepository({database,accountScope}){
  if(!database?.transaction)throw new Error('Banco local obrigatório.');
  let activeScope=assertAccountScope(accountScope);
  const getScope=()=>activeScope;
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
    async importLegacy({receiptId,sourceHash,routines,vials}){
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
    }
  };
  return Object.freeze(repository);
}

export async function openPepDayRepository({accountScope,indexedDBFactory,databaseName}={}){
  const database=await openLocalDatabase({indexedDBFactory,name:databaseName});
  return createPepDayRepository({database,accountScope});
}

export async function openDeviceRepository({indexedDBFactory,databaseName,database:providedDatabase,cryptoProvider=globalThis.crypto}={}){
  const database=providedDatabase||await openLocalDatabase({indexedDBFactory,name:databaseName});
  const bootstrapScope='device:bootstrap';
  const bootstrap=createPepDayRepository({database,accountScope:bootstrapScope});
  let installation=await bootstrap.meta.get('installation-id');
  if(!installation){
    if(!cryptoProvider?.randomUUID)throw new Error('Não foi possível identificar esta instalação.');
    installation={id:'installation-id',value:cryptoProvider.randomUUID()};
    await bootstrap.meta.put(installation);
  }
  return createPepDayRepository({database,accountScope:`device:${installation.value}`});
}

export const repositoryStores=Object.freeze({entities:[...ENTITY_STORES],writable:[...WRITABLE_COLLECTIONS]});
