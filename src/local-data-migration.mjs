export const LOCAL_DATA_KEYS=Object.freeze(['pepday_v1_routines','pepday_v2_vials']);

function parseArray(raw,label){
  if(raw===null)return [];
  let parsed;
  try{parsed=JSON.parse(raw)}catch{throw new Error(`${label}: dados locais inválidos. A cópia original foi preservada.`)}
  if(!Array.isArray(parsed))throw new Error(`${label}: formato local inválido. A cópia original foi preservada.`);
  for(const item of parsed)if(!item||typeof item!=='object'||typeof item.id!=='string'||!item.id){
    throw new Error(`${label}: registro sem identificador. A cópia original foi preservada.`);
  }
  return parsed;
}

async function sha256(value,cryptoProvider){
  if(!cryptoProvider?.subtle)throw new Error('SHA-256 indisponível para conferir a migração local.');
  const digest=await cryptoProvider.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function migrateLocalStorageToRepository({repository,storage=globalThis.localStorage,cryptoProvider=globalThis.crypto}={}){
  if(!repository?.importLegacy||!storage?.getItem)throw new Error('Repository e armazenamento legado são obrigatórios.');
  const raw=Object.fromEntries(LOCAL_DATA_KEYS.map(key=>[key,storage.getItem(key)]));
  const canonical=JSON.stringify(LOCAL_DATA_KEYS.map(key=>[key,raw[key]]));
  const sourceHash=await sha256(canonical,cryptoProvider);
  const routines=parseArray(raw.pepday_v1_routines,'Rotinas');
  const vials=parseArray(raw.pepday_v2_vials,'Frascos');
  const result=await repository.importLegacy({receiptId:`local-storage:${sourceHash}`,sourceHash,routines,vials});
  // Não escrever, remover nem normalizar os bytes originais do localStorage.
  for(const key of LOCAL_DATA_KEYS){
    if(storage.getItem(key)!==raw[key])throw new Error('Os dados legados mudaram durante a migração.');
  }
  return {...result,sourceHash,routineCount:routines.length,vialCount:vials.length};
}
