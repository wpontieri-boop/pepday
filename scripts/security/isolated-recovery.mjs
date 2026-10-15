// TEST synthetic PostgreSQL data-directory + separate object bytes, never a remote Supabase export.
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {sha256} from './clamav-scanner.mjs';
const scope='pepday:test-synthetic:postgres-storage:v1';
const qa=s=>typeof s==='string'&&/^QA-[A-Za-z0-9_-]{1,80}$/.test(s);
const deny=()=>{throw Error('RECOVERY_DENIED')};
const maxDb=64*1024*1024,maxObject=5242880,maxTotal=96*1024*1024;
const keysAre=(value,allowed)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key));
const decode=(value,maximum)=>{
  if(typeof value!=='string'||value.length>Math.ceil(maximum/3)*4+4||value.length%4!==0||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))deny();
  const bytes=Buffer.from(value,'base64');
  if(bytes.length>maximum||bytes.toString('base64')!==value)deny();
  return bytes;
};
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const validMime=value=>['application/pdf','image/png','image/jpeg'].includes(value);
export function sealRecovery({database,objects=[],synthetic=false,key}={}){
  if(synthetic!==true||!Buffer.isBuffer(database)||database.length>64*1024*1024||!Buffer.isBuffer(key)||key.length!==32||!Array.isArray(objects)||objects.length>20)deny();
  const seen=new Set();let total=database.length;
  const items=objects.map(o=>{
    if(!o||Object.keys(o).some(k=>!['id','owner','bytes','mime'].includes(k))||!qa(o.id)||!qa(o.owner)||!Buffer.isBuffer(o.bytes)||o.bytes.length>5242880||!['application/pdf','image/png','image/jpeg'].includes(o.mime)||seen.has(o.id))deny();
    seen.add(o.id);total+=o.bytes.length;if(total>96*1024*1024)deny();
    return {id:o.id,owner:o.owner,mime:o.mime,sha256:sha256(o.bytes),bytes:o.bytes.toString('base64')};
  });
  const plain=Buffer.from(JSON.stringify({version:1,scope,database:database.toString('base64'),databaseSha256:sha256(database),objects:items}));
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(scope));
  const ciphertext=Buffer.concat([cipher.update(plain),cipher.final()]);plain.fill(0);
  return {version:1,iv,ciphertext,tag:cipher.getAuthTag(),sha256:sha256(ciphertext)};
}
export function openRecovery(bundle,key,{target='test-isolated-restore',synthetic=false}={}){
  if(target!=='test-isolated-restore'||synthetic!==true||!Buffer.isBuffer(key)||key.length!==32||bundle?.version!==1||!Buffer.isBuffer(bundle.iv)||bundle.iv.length!==12||!Buffer.isBuffer(bundle.tag)||bundle.tag.length!==16||!Buffer.isBuffer(bundle.ciphertext)||bundle.ciphertext.length>140*1024*1024||sha256(bundle.ciphertext)!==bundle.sha256)deny();
  let plain;
  try{const cipher=createDecipheriv('aes-256-gcm',key,bundle.iv);cipher.setAAD(Buffer.from(scope));cipher.setAuthTag(bundle.tag);plain=Buffer.concat([cipher.update(bundle.ciphertext),cipher.final()])}catch{deny()}
  try{
    const data=JSON.parse(plain.toString());
    if(!keysAre(data,['version','scope','database','databaseSha256','objects'])||data.version!==1||data.scope!==scope||!Array.isArray(data.objects)||data.objects.length>20||!validHash(data.databaseSha256))deny();
    const database=decode(data.database,maxDb);if(sha256(database)!==data.databaseSha256)deny();
    let total=database.length;const seen=new Set();
    const objects=data.objects.map(o=>{
      if(!keysAre(o,['id','owner','mime','sha256','bytes'])||!qa(o.id)||!qa(o.owner)||!validMime(o.mime)||!validHash(o.sha256)||seen.has(o.id))deny();
      seen.add(o.id);const bytes=decode(o.bytes,maxObject);total+=bytes.length;
      if(total>maxTotal||sha256(bytes)!==o.sha256)deny();
      return {id:o.id,owner:o.owner,mime:o.mime,sha256:o.sha256,bytes};
    });
    return {database,objects,remoteWrite:false,productionWrite:false};
  }catch{deny()}finally{plain.fill(0)}
}
