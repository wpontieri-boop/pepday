import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import { LOCAL_DB_NAME, LOCAL_STORE_NAMES, openLocalDatabase, upgradeLocalSchema } from '../src/local-db.mjs';
import { createPepDayRepository, openDeviceRepository } from '../src/pepday-repository.mjs';
import { migrateLocalStorageToRepository } from '../src/local-data-migration.mjs';

class MemoryDatabase {
  constructor(){this.data=new Map(LOCAL_STORE_NAMES.map(name=>[name,new Map()]))}
  async transaction(storeNames,mode,work){
    const names=Array.isArray(storeNames)?storeNames:[storeNames];
    const working=new Map(names.map(name=>[name,new Map([...this.data.get(name)].map(([key,value])=>[key,structuredClone(value)]))]));
    const stores=Object.fromEntries(names.map(name=>[name,{
      get:async(scope,id)=>structuredClone(working.get(name).get(`${scope}\0${id}`)),
      getAll:async()=>[...working.get(name).values()].map(value=>structuredClone(value)),
      getAllByScope:async scope=>[...working.get(name).values()].filter(row=>row.accountScope===scope).map(value=>structuredClone(value)),
      put:async value=>{working.get(name).set(`${value.accountScope}\0${value.id}`,structuredClone(value));return [value.accountScope,value.id]},
      delete:async(scope,id)=>working.get(name).delete(`${scope}\0${id}`),
      clear:async()=>working.get(name).clear()
    }]));
    const result=await work(Object.freeze(stores));
    if(mode==='readwrite')for(const name of names)this.data.set(name,working.get(name));
    return result;
  }
  read(name,work){return this.transaction(name,'readonly',stores=>work(stores[name]))}
  write(name,work){return this.transaction(name,'readwrite',stores=>work(stores[name]))}
}

function storageFixture({routines=[],vials=[]}={}){
  const values=new Map([
    ['pepday_v1_routines',JSON.stringify(routines)],
    ['pepday_v2_vials',JSON.stringify(vials)]
  ]);
  return {values,getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
}

const uniqueDbName=label=>`pepday-b22a-${label}-${webcrypto.randomUUID()}`;
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function deleteDatabase(name){
  return new Promise((resolve,reject)=>{
    const request=fakeIndexedDB.deleteDatabase(name);
    request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error(`Delete bloqueado: ${name}`));
  });
}
function rawOpen(name,version,{closeOnVersionChange=false}={}){
  return new Promise((resolve,reject)=>{
    const request=fakeIndexedDB.open(name,version);
    request.onupgradeneeded=()=>{};request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{if(closeOnVersionChange)request.result.onversionchange=()=>request.result.close();resolve(request.result)};
  });
}

const vial={id:'11111111-1111-4111-8111-111111111111',name:'Frasco legado',initialMg:10,remainingMg:7,waterMl:2,date:'2026-09-15',history:[{type:'legacy-only'}]};
const routine={id:'22222222-2222-4222-8222-222222222222',vialId:vial.id,name:'Rotina legada',doseValue:1,doseUnit:'mg',frequency:'daily',start:'2026-09-15',weekdays:[],done:[]};

function schemaFactory(){
  const stores=new Map();
  const database={name:LOCAL_DB_NAME,version:2,objectStoreNames:{contains:name=>stores.has(name)},
    createObjectStore(name,options){
      const indexes=[];const store={name,options,indexes,indexNames:{contains:indexName=>indexes.some(index=>index.indexName===indexName)},createIndex(indexName,keyPath,indexOptions){indexes.push({indexName,keyPath,indexOptions})}};
      stores.set(name,store);return store;
    },close(){},transaction(){throw new Error('não usado neste teste')}};
  return {stores,factory:{open(name,version){
    const request={result:database,error:null,transaction:{abort(){request.error=new Error('abortado')}}};
    queueMicrotask(()=>{request.onupgradeneeded?.({oldVersion:0,newVersion:version});if(!request.error)request.onsuccess?.()});
    return request;
  }}};
}

test('abre banco vazio com nome, versão e dez stores esperadas',async()=>{
  const fake=schemaFactory(),database=await openLocalDatabase({indexedDBFactory:fake.factory});
  assert.equal(database.name,LOCAL_DB_NAME);assert.equal(database.version,2);
  assert.deepEqual([...fake.stores.keys()],LOCAL_STORE_NAMES);
  for(const store of fake.stores.values()){
    assert.deepEqual(store.options.keyPath,['accountScope','id']);
    assert.equal(store.indexes[0].indexName,'accountScope');
    if(store.name==='outbox')assert.deepEqual(store.indexes.slice(1).map(index=>index.indexName),['operationId','sequence']);
  }
});

test('upgrade de schema cria stores inicialmente e índices da outbox na versão 2',()=>{
  const created=[];
  const database={createObjectStore(name){created.push(name);return {indexNames:{contains:()=>false},createIndex(){}}}};
  upgradeLocalSchema(database,0);assert.deepEqual(created,LOCAL_STORE_NAMES);
  const indexes=[],outbox={indexNames:{contains:()=>false},createIndex(name,keyPath,options){indexes.push({name,keyPath,options})}};
  created.length=0;upgradeLocalSchema(database,1,{objectStore:name=>{assert.equal(name,'outbox');return outbox}});assert.deepEqual(created,[]);
  assert.deepEqual(indexes.map(index=>index.name),['operationId','sequence']);
});

test('upgrade interrompido rejeita de forma controlada e fecha sucesso tardio',async()=>{
  let closes=0;
  const database={close(){closes++},createObjectStore(){throw new Error('falha controlada no schema')}};
  const factory={open(){
    const request={result:database,transaction:{abort(){}},error:null};
    queueMicrotask(()=>{request.onupgradeneeded?.({oldVersion:0,newVersion:1});request.onsuccess?.()});
    return request;
  }};
  await assert.rejects(openLocalDatabase({indexedDBFactory:factory}),/falha controlada no schema/);
  await tick();assert.equal(closes,1);
});

test('CRUD de Rotinas e Frascos persiste e recarrega pelo repository',async()=>{
  const database=new MemoryDatabase(),first=createPepDayRepository({database,accountScope:'user:alpha'});
  await first.vials.put(vial);await first.routines.put(routine);
  assert.deepEqual(await first.vials.get(vial.id),vial);assert.deepEqual(await first.routines.list(),[routine]);
  const edited={...routine,name:'Editada'};await first.routines.put(edited);assert.equal((await first.routines.get(routine.id)).name,'Editada');
  const reload=createPepDayRepository({database,accountScope:'user:alpha'});
  assert.deepEqual(await reload.vials.list(),[vial]);assert.deepEqual(await reload.routines.list(),[edited]);
  await reload.routines.delete(routine.id);await reload.vials.delete(vial.id);
  assert.deepEqual(await reload.routines.list(),[]);assert.deepEqual(await reload.vials.list(),[]);
});

test('duas contas e escopo device permanecem isolados',async()=>{
  const database=new MemoryDatabase(),repository=createPepDayRepository({database,accountScope:'user:alpha'});
  await repository.vials.put(vial);
  repository.setAccountScope('user:beta');assert.deepEqual(await repository.vials.list(),[]);
  await repository.vials.put({...vial,name:'Conta B'});
  repository.setAccountScope('user:alpha');assert.equal((await repository.vials.get(vial.id)).name,'Frasco legado');
  repository.setAccountScope('device:installation-1');assert.deepEqual(await repository.vials.list(),[]);
  await repository.routines.put(routine);
  repository.setAccountScope('user:beta');assert.deepEqual(await repository.routines.list(),[]);
});

test('openDeviceRepository conserva o mesmo installation id no banco',async()=>{
  const database=new MemoryDatabase();let calls=0;
  const cryptoProvider={randomUUID:()=>{calls++;return 'install-fixed'}};
  const first=await openDeviceRepository({database,cryptoProvider});
  const second=await openDeviceRepository({database,cryptoProvider});
  assert.equal(first.accountScope,'device:install-fixed');assert.equal(second.accountScope,'device:install-fixed');assert.equal(calls,1);
});

test('get-or-create do installation id é atômico entre duas conexões',async()=>{
  const name=uniqueDbName('installation');let calls=0;
  const cryptoProvider={randomUUID:()=>`installation-${++calls}`};
  const [first,second]=await Promise.all([
    openDeviceRepository({indexedDBFactory:fakeIndexedDB,databaseName:name,cryptoProvider}),
    openDeviceRepository({indexedDBFactory:fakeIndexedDB,databaseName:name,cryptoProvider})
  ]);
  assert.equal(first.accountScope,second.accountScope);
  assert.equal(first.accountScope,'device:installation-1');
  assert.equal(calls,1);
  first.close();second.close();await deleteDatabase(name);
});

test('migração localStorage é idempotente, preserva bytes/IDs/saldo e não fabrica eventos',async()=>{
  const database=new MemoryDatabase(),repository=createPepDayRepository({database,accountScope:'device:migration'});
  const storage=storageFixture({routines:[routine],vials:[vial]});
  const before=new Map(storage.values);
  const first=await migrateLocalStorageToRepository({repository,storage,cryptoProvider:webcrypto});
  const second=await migrateLocalStorageToRepository({repository,storage,cryptoProvider:webcrypto});
  assert.equal(first.status,'migrated');assert.equal(second.status,'already-migrated');
  assert.deepEqual(await repository.routines.list(),[routine]);assert.deepEqual(await repository.vials.list(),[vial]);
  assert.equal((await repository.vials.get(vial.id)).remainingMg,7);
  assert.deepEqual(await repository.confirmedCounts(),{applications:0,vialMovements:0});
  const receipts=await repository.migrationReceipts.list();assert.equal(receipts.length,1);
  assert.equal(receipts[0].sourceHash,first.sourceHash);assert.equal(receipts[0].id,`local-storage:${first.sourceHash}`);
  assert.deepEqual([...storage.values], [...before]);
});

test('falha no meio da importação reverte toda a transação',async()=>{
  const database=new MemoryDatabase(),repository=createPepDayRepository({database,accountScope:'device:atomic'});
  await repository.routines.put({...routine,name:'já existente e diferente'});
  const storage=storageFixture({routines:[routine],vials:[vial]});
  await assert.rejects(migrateLocalStorageToRepository({repository,storage,cryptoProvider:webcrypto}),/Conflito/);
  assert.deepEqual(await repository.vials.list(),[]);
  assert.equal((await repository.routines.get(routine.id)).name,'já existente e diferente');
  assert.deepEqual(await repository.migrationReceipts.list(),[]);
});

test('mutação concorrente da origem aborta importação e não cria receipt enganoso',async()=>{
  const database=new MemoryDatabase(),repository=createPepDayRepository({database,accountScope:'device:source-race'});
  const storage=storageFixture({routines:[routine],vials:[vial]});
  let reads=0;
  const racedStorage={...storage,getItem(key){
    reads++;
    if(reads===3)storage.values.set('pepday_v1_routines',JSON.stringify([{...routine,name:'mudou durante migração'}]));
    return storage.getItem(key);
  }};
  await assert.rejects(migrateLocalStorageToRepository({repository,storage:racedStorage,cryptoProvider:webcrypto}),error=>error.code==='LEGACY_SOURCE_CHANGED');
  assert.deepEqual(await repository.routines.list(),[]);
  assert.deepEqual(await repository.vials.list(),[]);
  assert.deepEqual(await repository.migrationReceipts.list(),[]);
});

test('mudança da origem após commit é distinguida de falha da migração',async()=>{
  const database=new MemoryDatabase(),base=createPepDayRepository({database,accountScope:'device:source-after'});
  const storage=storageFixture({routines:[routine],vials:[vial]});
  const repository={...base,async importLegacy(input){
    const result=await base.importLegacy(input);
    storage.values.set('pepday_v1_routines',JSON.stringify([{...routine,name:'mudou após commit'}]));
    return result;
  }};
  const result=await migrateLocalStorageToRepository({repository,storage,cryptoProvider:webcrypto});
  assert.equal(result.status,'migrated');
  assert.equal(result.originChangedAfterMigration,true);
  assert.equal(result.originStatus,'snapshot-migrated-origin-changed-after');
  assert.equal((await base.migrationReceipts.list()).length,1);
  assert.deepEqual(await base.routines.list(),[routine]);
});

test('IndexedDB realista mantém rollback atômico em AbortError, QuotaExceededError e DataCloneError',async()=>{
  for(const errorName of ['AbortError','QuotaExceededError']){
    const name=uniqueDbName(errorName),database=await openLocalDatabase({indexedDBFactory:fakeIndexedDB,name});
    await assert.rejects(database.transaction(['routines','vials'],'readwrite',async stores=>{
      await stores.routines.put({accountScope:'device:test',id:'r',data:{name:'temporária'}});
      await stores.vials.put({accountScope:'device:test',id:'v',data:{name:'temporário'}});
      throw new DOMException(errorName,errorName);
    }),error=>error.name===errorName);
    assert.deepEqual(await database.read('routines',store=>store.getAll()),[]);
    assert.deepEqual(await database.read('vials',store=>store.getAll()),[]);
    database.close();await deleteDatabase(name);
  }

  const name=uniqueDbName('clone'),database=await openLocalDatabase({indexedDBFactory:fakeIndexedDB,name});
  await assert.rejects(database.write('routines',store=>store.put({accountScope:'device:test',id:'bad',data:{notCloneable(){}}})),error=>error.name==='DataCloneError');
  assert.deepEqual(await database.read('routines',store=>store.getAll()),[]);
  database.close();await deleteDatabase(name);
});

test('versionchange fecha conexão antiga e libera upgrade posterior',async()=>{
  const name=uniqueDbName('versionchange');let versionChanges=0;
  const old=await openLocalDatabase({indexedDBFactory:fakeIndexedDB,name,version:1,onVersionChange:()=>versionChanges++});
  const upgraded=await rawOpen(name,2,{closeOnVersionChange:true});
  assert.equal(upgraded.version,2);assert.equal(versionChanges,1);
  upgraded.close();old.close();await deleteDatabase(name);
});

test('upgrade bloqueado falha controladamente e conexão tardia é fechada',async()=>{
  const name=uniqueDbName('blocked'),old=await rawOpen(name,1);let blocked=0;
  const opening=openLocalDatabase({indexedDBFactory:fakeIndexedDB,name,version:2,onBlocked:()=>blocked++});
  await assert.rejects(opening,error=>error.code==='IDB_BLOCKED');
  assert.equal(blocked,1);
  old.close();await tick();await tick();
  const next=await rawOpen(name,3,{closeOnVersionChange:true});
  assert.equal(next.version,3);
  next.close();await deleteDatabase(name);
});

test('draft completo sobrevive ao fluxo Rotina → Frasco e a reload',async()=>{
  const database=new MemoryDatabase(),repository=createPepDayRepository({database,accountScope:'device:draft'});
  const draft={id:'routine-form',editing:null,lastCalc:{mg:10,water:2},fields:{name:'Rotina',vialId:'',dose:'250',doseUnit:'mcg',syringe:'30',refillAt:'4',frequency:'weekdays',startDate:'2026-09-15',time:'08:30',weekdays:[1,3,5]}};
  await repository.drafts.put(draft);await repository.vials.put(vial);
  const reload=createPepDayRepository({database,accountScope:'device:draft'});
  const restored=await reload.drafts.get('routine-form');
  assert.deepEqual(restored,draft);
  await reload.saveVialWithDraft(vial,{...restored,fields:{...restored.fields,vialId:vial.id}});
  assert.equal((await reload.drafts.get('routine-form')).fields.vialId,vial.id);
  assert.deepEqual(await reload.vials.list(),[vial]);
  await reload.saveRoutineAndClearDraft({...routine,vialId:vial.id});
  assert.equal(await reload.drafts.get('routine-form'),null);
  assert.deepEqual(await reload.routines.list(),[{...routine,vialId:vial.id}]);
});

test('somente local-db encapsula chamadas IndexedDB e app não grava chaves legadas',async()=>{
  const [dbSource,repositorySource,migrationSource,appSource,accountSource,serviceWorker,devServer]=await Promise.all([
    readFile(new URL('../src/local-db.mjs',import.meta.url),'utf8'),readFile(new URL('../src/pepday-repository.mjs',import.meta.url),'utf8'),
    readFile(new URL('../src/local-data-migration.mjs',import.meta.url),'utf8'),readFile(new URL('../app.js',import.meta.url),'utf8'),
    readFile(new URL('../src/account-ui.mjs',import.meta.url),'utf8'),
    readFile(new URL('../sw.js',import.meta.url),'utf8'),readFile(new URL('../scripts/dev-server.mjs',import.meta.url),'utf8')]);
  assert.match(dbSource,/indexedDBFactory\.open/);
  assert.doesNotMatch(repositorySource,/\bindexedDB\b/);assert.doesNotMatch(migrationSource,/\bindexedDB\b/);assert.doesNotMatch(appSource,/\bindexedDB\b/);
  for(const source of [dbSource,repositorySource,migrationSource,appSource,accountSource])assert.doesNotMatch(source,/from\s+['"]node:|require\s*\(/);
  assert.doesNotMatch(appSource,/readLegacyArray/);assert.match(appSource,/let routines=\[\],vials=\[\]/);
  assert.match(appSource,/localDataState='loading'/);assert.match(appSource,/if\(proScreens\.has\(id\)&&localDataState!=='ready'\)return false/);
  assert.match(appSource,/if\(draft\)applyRoutineDraft\(draft,\{show:true\}\);\s*localRepository=base\.repository;localDataState='ready'/);
  assert.match(appSource,/if\(token!==scopeGeneration\)return null/);assert.match(appSource,/token===scopeGeneration\?\{ok:true,value\}:\{ok:false,stale:true\}/);
  assert.match(accountSource,/signedIn\(session\.session\.user\.id\)/);assert.match(accountSource,/repositoryScope\?\.suspend\(\)/);
  assert.doesNotMatch(appSource,/localStorage\.(setItem|removeItem)\((key|vialKey)/);
  assert.doesNotMatch(appSource,/remainingMg\s*=\s*Math\.(max|min).*dose/i);
  for(const asset of ['src/local-db.mjs','src/pepday-repository.mjs','src/local-data-migration.mjs']){
    const escaped=asset.replace(/[./]/g,'\\$&');assert.match(serviceWorker,new RegExp(escaped));assert.match(devServer,new RegExp(escaped));
  }
  assert.match(serviceWorker,/pepday-v3-b22b-outbox/);
  assert.doesNotMatch(serviceWorker,/indexedDB|deleteDatabase/);
});
