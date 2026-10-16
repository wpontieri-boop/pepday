// PepDay QA-only in-memory paginated Storage snapshot.
// No credentials, HTTP, filesystem writes, Supabase client or remote destination.
import {createHash,randomBytes} from 'node:crypto';
import {sealRecovery,openRecovery} from './isolated-recovery.mjs';
const qa=s=>typeof s==='string'&&/^QA-[A-Za-z0-9_-]{1,80}$/.test(s);
const deny=()=>{throw Error('SYNTHETIC_STORAGE_DENIED')};
const mime=new Set(['image/png','image/jpeg','application/pdf']);
const digest=b=>createHash('sha256').update(b).digest('hex');

export async function captureSyntheticPages({listPage,readObject,limit=2}={}){
  if(typeof listPage!=='function'||typeof readObject!=='function'||!Number.isInteger(limit)||limit<1||limit>5)deny();
  let cursor=null,totalBytes=0;
  const seenCursor=new Set(),seenIds=new Set(),items=[];
  for(let page=0;page<12;page++){
    const response=await listPage({cursor,limit,synthetic:true});
    if(!response||Object.keys(response).sort().join(',')!=='items,nextCursor'
      ||!Array.isArray(response.items)||response.items.length>limit)deny();
    const next=response.nextCursor;
    if(next!==null&&(!qa(next)||seenCursor.has(next)||next===cursor))deny();
    if(next!==null&&response.items.length===0)deny();
    for(const it of response.items){
      if(!it||Object.keys(it).sort().join(',')!=='id,mime,owner'
        ||!qa(it.id)||!qa(it.owner)||!mime.has(it.mime)||seenIds.has(it.id))deny();
      const data=await readObject({id:it.id,synthetic:true});
      if(!Buffer.isBuffer(data)||data.length===0||data.length>5*1024*1024)deny();
      seenIds.add(it.id);totalBytes+=data.length;
      if(items.length>=20||totalBytes>32*1024*1024)deny();
      items.push({id:it.id,owner:it.owner,mime:it.mime,sha256:digest(data),bytes:Buffer.from(data)});
    }
    if(next===null){
      return {scope:'PEPDAY_STORAGE_SYNTHETIC',items,objectCount:items.length,totalBytes,
        allPagesRead:true,remoteStorageTouched:false};
    }
    seenCursor.add(next);cursor=next;
  }
  deny();
}
export function sealSyntheticSnapshot({database,snapshot,key}={}){
  if(!snapshot||snapshot.scope!=='PEPDAY_STORAGE_SYNTHETIC'||snapshot.allPagesRead!==true
    ||snapshot.remoteStorageTouched!==false||snapshot.objectCount!==snapshot.items?.length
    ||!Buffer.isBuffer(database)||!Buffer.isBuffer(key)||key.length!==32)deny();
  return sealRecovery({
    database,synthetic:true,key,
    objects:snapshot.items.map(i=>({id:i.id,owner:i.owner,mime:i.mime,bytes:i.bytes}))
  });
}
export function confirmSyntheticSnapshot({bundle,key,expectedIds}={}){
  if(!Array.isArray(expectedIds)||expectedIds.some(id=>!qa(id)))deny();
  const decoded=openRecovery(bundle,key,{synthetic:true,target:'test-isolated-restore'});
  const got=decoded.objects.map(o=>o.id);
  if(got.length!==expectedIds.length||new Set(got).size!==got.length||got.some((id,i)=>id!==expectedIds[i]))deny();
  return {status:'PASS_SYNTHETIC_DB_STORAGE_ROUNDTRIP',objects:got.length,
    remoteStorageTouched:false,realBackupProven:false};
}
export function newSyntheticKeyForQA(){return randomBytes(32)}
