import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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

const vial={id:'11111111-1111-4111-8111-111111111111',name:'Frasco legado',initialMg:10,remainingMg:7,waterMl:2,date:'2026-09-15',history:[{type:'legacy-only'}]};
const routine={id:'22222222-2222-4222-8222-222222222222',vialId:vial.id,name:'Rotina legada',doseValue:1,doseUnit:'mg',frequency:'daily',start:'2026-09-15',weekdays:[],done:[]};

function schemaFactory(){
  const stores=new Map();
  const database={name:LOCAL_DB_NAME,version:1,objectStoreNames:{contains:name=>stores.has(name)},
    createObjectStore(name,options){
      const indexes=[];const store={name,options,indexes,createIndex(indexName,keyPath,indexOptions){indexes.push({indexName,keyPath,indexOptions})}};
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
  assert.equal(database.name,LOCAL_DB_NAME);assert.equal(database.version,1);
  assert.deepEqual([...fake.stores.keys()],LOCAL_STORE_NAMES);
  for(const store of fake.stores.values()){
    assert.deepEqual(store.options.keyPath,['accountScope','id']);
    assert.equal(store.indexes[0].indexName,'accountScope');
  }
});

test('upgrade de schema só cria stores na versão inicial',()=>{
  const created=[];
  const database={createObjectStore(name){created.push(name);return {createIndex(){}}}};
  upgradeLocalSchema(database,0);assert.deepEqual(created,LOCAL_STORE_NAMES);
  created.length=0;upgradeLocalSchema(database,1);assert.deepEqual(created,[]);
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
  assert.equal((await repository.migrationReceipts.list()).length,1);
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
  const [dbSource,repositorySource,migrationSource,appSource,serviceWorker,devServer]=await Promise.all([
    readFile(new URL('../src/local-db.mjs',import.meta.url),'utf8'),readFile(new URL('../src/pepday-repository.mjs',import.meta.url),'utf8'),
    readFile(new URL('../src/local-data-migration.mjs',import.meta.url),'utf8'),readFile(new URL('../app.js',import.meta.url),'utf8'),
    readFile(new URL('../sw.js',import.meta.url),'utf8'),readFile(new URL('../scripts/dev-server.mjs',import.meta.url),'utf8')]);
  assert.match(dbSource,/indexedDBFactory\.open/);
  assert.doesNotMatch(repositorySource,/\bindexedDB\b/);assert.doesNotMatch(migrationSource,/\bindexedDB\b/);assert.doesNotMatch(appSource,/\bindexedDB\b/);
  assert.doesNotMatch(appSource,/localStorage\.(setItem|removeItem)\((key|vialKey)/);
  assert.doesNotMatch(appSource,/remainingMg\s*=\s*Math\.(max|min).*dose/i);
  for(const asset of ['src/local-db.mjs','src/pepday-repository.mjs','src/local-data-migration.mjs']){
    const escaped=asset.replace(/[./]/g,'\\$&');assert.match(serviceWorker,new RegExp(escaped));assert.match(devServer,new RegExp(escaped));
  }
});
