// Public client keys only. Outputs fingerprints and dependencies, never the key values.
import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const files=['src/firebase-public-config.mjs','src/firebase-messaging-sw.js','src/firebase-public-config.production.mjs','src/firebase-messaging-sw.production.js'];
const keys=new Map();
for(const file of files){
  const text=await readFile(new URL('../../'+file,import.meta.url),'utf8');
  for(const match of text.matchAll(/AIza[A-Za-z0-9_-]{35}/g)){
    const fingerprint=createHash('sha256').update(match[0]).digest('hex').slice(0,16);
    if(!keys.has(fingerprint))keys.set(fingerprint,{fingerprint,paths:[],environment:file.includes('production')?'PROD':'TEST',project:file.includes('production')?'pepday-v3-prod':'pepday-v3-test',publicExposure:'intentional_firebase_web_client',completeValueOmitted:true,restrictionsVerifiedNow:false});
    keys.get(fingerprint).paths.push(file);
  }
}
console.log(JSON.stringify({keys:[...keys.values()],cloudAccess:'not_inspected_by_inventory_script',mutation:false,productionRevoked:false},null,2));
