export const LOCAL_DB_NAME = 'pepday_v3_local';
export const LOCAL_DB_VERSION = 1;

export const LOCAL_STORE_NAMES = Object.freeze([
  'vials',
  'routines',
  'routineVersions',
  'applications',
  'vialMovements',
  'outbox',
  'conflicts',
  'drafts',
  'meta',
  'migrationReceipts'
]);

const requestResult = request => new Promise((resolve,reject)=>{
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error || new Error('Falha no IndexedDB.'));
});

const transactionDone = transaction => new Promise((resolve,reject)=>{
  transaction.oncomplete=()=>resolve();
  transaction.onabort=()=>reject(transaction.error || new Error('Transação IndexedDB cancelada.'));
  transaction.onerror=()=>{}; // onabort contém o erro final da transação.
});

export function upgradeLocalSchema(database, oldVersion) {
  if(oldVersion<1){
    for(const name of LOCAL_STORE_NAMES){
      const store=database.createObjectStore(name,{keyPath:['accountScope','id']});
      store.createIndex('accountScope','accountScope',{unique:false});
    }
  }
}

function transactionStore(transaction,name){
  const store=transaction.objectStore(name);
  return Object.freeze({
    get:(accountScope,id)=>requestResult(store.get([accountScope,id])),
    getAll:()=>requestResult(store.getAll()),
    getAllByScope:accountScope=>requestResult(store.index('accountScope').getAll(accountScope)),
    put:value=>requestResult(store.put(value)),
    delete:(accountScope,id)=>requestResult(store.delete([accountScope,id])),
    clear:()=>requestResult(store.clear())
  });
}

export class LocalDatabase {
  #database;
  constructor(database){this.#database=database}
  get name(){return this.#database.name}
  get version(){return this.#database.version}
  close(){this.#database.close()}
  async transaction(storeNames,mode,work){
    const names=[...new Set(Array.isArray(storeNames)?storeNames:[storeNames])];
    for(const name of names)if(!LOCAL_STORE_NAMES.includes(name))throw new Error(`Store local desconhecida: ${name}`);
    const transaction=this.#database.transaction(names,mode);
    const done=transactionDone(transaction);
    const stores=Object.freeze(Object.fromEntries(names.map(name=>[name,transactionStore(transaction,name)])));
    let result;
    try{
      result=await work(stores);
      transaction.commit?.();
    }catch(error){
      try{transaction.abort()}catch{}
      try{await done}catch{}
      throw error;
    }
    await done;
    return result;
  }
  read(storeName,work){return this.transaction(storeName,'readonly',stores=>work(stores[storeName]))}
  write(storeName,work){return this.transaction(storeName,'readwrite',stores=>work(stores[storeName]))}
}

export function openLocalDatabase({indexedDBFactory=globalThis.indexedDB,name=LOCAL_DB_NAME,version=LOCAL_DB_VERSION}={}){
  if(!indexedDBFactory?.open) return Promise.reject(new Error('IndexedDB indisponível neste navegador.'));
  return new Promise((resolve,reject)=>{
    const request=indexedDBFactory.open(name,version);
    request.onupgradeneeded=event=>{
      try{upgradeLocalSchema(request.result,event.oldVersion || 0)}
      catch(error){request.transaction?.abort();reject(error)}
    };
    request.onsuccess=()=>resolve(new LocalDatabase(request.result));
    request.onerror=()=>reject(request.error || new Error('Não foi possível abrir os dados locais.'));
    request.onblocked=()=>reject(new Error('Feche outras abas antigas do PepDay para atualizar os dados locais.'));
  });
}
