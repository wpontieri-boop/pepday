// Encrypted TEST-only recovery package. Not a live database/storage backup or a production restore.
const enc=new TextEncoder(),dec=new TextDecoder();
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
function validate(snapshot){
 if(!snapshot||snapshot.environment!=='test_synthetic'||snapshot.version!==1||Object.keys(snapshot).some(k=>!['version','environment','schemaVersions','objects'].includes(k)))throw Error('RECOVERY_SCOPE_DENIED');
 if(!Array.isArray(snapshot.schemaVersions)||snapshot.schemaVersions.some(v=>typeof v!=='string'||!/^\d{14}$/.test(v)))throw Error('RECOVERY_SCHEMA_DENIED');
 if(!Array.isArray(snapshot.objects)||snapshot.objects.length>20||snapshot.objects.some(x=>Object.keys(x).some(k=>!['id','value'].includes(k))||typeof x.id!=='string'||!/^QA-[A-Za-z0-9_-]{1,80}$/.test(x.id)||typeof x.value!=='string'||!/^QA [A-Za-z0-9 _.-]{1,200}$/.test(x.value)))throw Error('RECOVERY_SYNTHETIC_ONLY');
}
export async function makeRecoveryKey(){return crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
export async function sealSyntheticSnapshot(snapshot,key){
 validate(snapshot);const plain=enc.encode(JSON.stringify(snapshot)),iv=crypto.getRandomValues(new Uint8Array(12)),aad=enc.encode('pepday:test-synthetic:recovery:v1');
 const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,plain));
 return {version:1,iv,ciphertext,sha256:await hash(ciphertext)};
}
export async function restoreSyntheticSnapshot(bundle,key,{target='test-isolated-restore'}={}){
 if(target!=='test-isolated-restore'||bundle?.version!==1||!(bundle.iv instanceof Uint8Array)||bundle.iv.length!==12||!(bundle.ciphertext instanceof Uint8Array)||bundle.ciphertext.length>100000||await hash(bundle.ciphertext)!==bundle.sha256)throw Error('RECOVERY_INTEGRITY_DENIED');
 let plain;try{plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bundle.iv,additionalData:enc.encode('pepday:test-synthetic:recovery:v1')},key,bundle.ciphertext)}catch{throw Error('RECOVERY_AUTHENTICATION_DENIED')}
 const snapshot=JSON.parse(dec.decode(plain));validate(snapshot);return {snapshot,target,productionWrite:false,remoteWrite:false};
}
