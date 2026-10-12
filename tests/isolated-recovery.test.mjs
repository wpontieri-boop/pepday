import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';
import {sealRecovery,openRecovery} from '../scripts/security/isolated-recovery.mjs';
const fixture=()=>({synthetic:true,key:randomBytes(32),database:Buffer.from('QA database bytes'),objects:[{id:'QA-object-1',owner:'QA-A',mime:'image/png',bytes:Buffer.from('QA object bytes')}]});
test('DB and separate Storage bytes encrypted and verified; no remote/PROD writes',()=>{
  const f=fixture(),b=sealRecovery(f),r=openRecovery(b,f.key,{synthetic:true});assert.deepEqual(r.database,f.database);assert.deepEqual(r.objects[0].bytes,f.objects[0].bytes);assert.equal(r.remoteWrite,false);assert.equal(r.productionWrite,false);assert.ok(!b.ciphertext.includes(f.database));
});
test('wrong key, corrupt ciphertext/tag/IV, wrong scope and real target are denied',()=>{
  const f=fixture(),b=sealRecovery(f);
  for(const change of [{sha256:'0'.repeat(64)},{tag:randomBytes(16)},{iv:randomBytes(12)}])assert.throws(()=>openRecovery({...b,...change},f.key,{synthetic:true}),/DENIED/);
  assert.throws(()=>openRecovery(b,randomBytes(32),{synthetic:true}),/DENIED/);
  assert.throws(()=>openRecovery(b,f.key,{synthetic:true,target:'production'}),/DENIED/);assert.throws(()=>openRecovery(b,f.key),/DENIED/);
});
test('synthetic scope, unique objects, minimization and size gates mandatory',()=>{
  const f=fixture();for(const changes of [{synthetic:false},{key:Buffer.alloc(1)},{database:Buffer.alloc(64*1024*1024+1)},{objects:[{...f.objects[0],owner:'real'}]},{objects:[...f.objects,...f.objects]},{objects:[{...f.objects[0],secret:'forbidden'}]}])assert.throws(()=>sealRecovery({...f,...changes}),/DENIED/);
});
