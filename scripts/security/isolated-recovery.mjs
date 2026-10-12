// TEST synthetic PostgreSQL data-directory + separate object bytes, never a remote Supabase export.
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {sha256} from './clamav-scanner.mjs';
const scope='pepday:test-synthetic:postgres-storage:v1';
const qa=s=>typeof s==='string'&&/^QA-[A-Za-z0-9_-]{1,80}$/.test(s);
const deny=()=>{throw Error('RECOVERY_DENIED')};
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
    const data=JSON.parse(plain.toString());if(data.version!==1||data.scope!==scope||!Array.isArray(data.objects)||data.objects.length>20)deny();
    const database=Buffer.from(data.database,'base64');if(sha256(database)!==data.databaseSha256)deny();
    const objects=data.objects.map(o=>{const bytes=Buffer.from(o.bytes,'base64');if(!qa(o.id)||!qa(o.owner)||sha256(bytes)!==o.sha256)deny();return {...o,bytes}});
    return {database,objects,remoteWrite:false,productionWrite:false};
  }finally{plain.fill(0)}
}
