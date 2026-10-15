import test from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv,randomBytes,createHash} from 'node:crypto';
import {openRecovery,sealRecovery} from '../scripts/security/isolated-recovery.mjs';

const scope='pepday:test-synthetic:postgres-storage:v1';
const sha=x=>createHash('sha256').update(x).digest('hex');
const base=()=>{
  const database=Buffer.from('QA local database');
  const bytes=Buffer.from('QA private storage file');
  return {version:1,scope,database:database.toString('base64'),databaseSha256:sha(database),objects:[
    {id:'QA-one',owner:'QA-A',mime:'image/png',sha256:sha(bytes),bytes:bytes.toString('base64')}
  ]};
};
function encryptAuthenticatedPayload(value,key) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(scope));
  const ciphertext=Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value))),cipher.final()]);
  return {version:1,iv,ciphertext,tag:cipher.getAuthTag(),sha256:sha(ciphertext)};
}
test('VALID signed synthetic restore still permits isolated QA only',()=>{
  const key=randomBytes(32),data=base();
  const bundle=sealRecovery({key,synthetic:true,database:Buffer.from(data.database,'base64'),objects:[
    {id:data.objects[0].id,owner:data.objects[0].owner,mime:data.objects[0].mime,bytes:Buffer.from(data.objects[0].bytes,'base64')}
  ]});
  const restored=openRecovery(bundle,key,{synthetic:true});
  assert.equal(restored.database.toString(),'QA local database');
  assert.equal(restored.objects[0].bytes.toString(),'QA private storage file');
  assert.equal(restored.remoteWrite,false);assert.equal(restored.productionWrite,false);
});
test('authenticated yet malformed backup metadata and duplicate object IDs fail closed',()=>{
  const b=base();
  const variants=[
    {...b,extra:'unapproved-field'},
    {...b,objects:[b.objects[0],b.objects[0]]},
    {...b,objects:[{...b.objects[0],owner:'not-QA'}]},
    {...b,objects:[{...b.objects[0],mime:'text/plain'}]},
    {...b,objects:[{...b.objects[0],sha256:'z'.repeat(64)}]},
    {...b,objects:[{...b.objects[0],unexpected:'file path'}]},
    {...b,objects:[{...b.objects[0],bytes:'AA=\n'}]},
    {...b,database:'@@invalid@@'},
    {...b,objects:[{...b.objects[0],bytes:'A===',sha256:sha(Buffer.from([]))}]},
    {...b,objects:[{...b.objects[0],bytes:Buffer.alloc(5242881).toString('base64'),sha256:sha(Buffer.alloc(5242881))}]},
    {...b,objects:[] ,database:Buffer.alloc(64*1024*1024+1).toString('base64'),databaseSha256:sha(Buffer.alloc(64*1024*1024+1))}
  ];
  const key=randomBytes(32);
  for(const data of variants)assert.throws(()=>openRecovery(encryptAuthenticatedPayload(data,key),key,{synthetic:true}),/RECOVERY_DENIED/);
});
test('encrypted backup JSON is never accepted without TEST-synthetic restoration scope',()=>{
  const key=randomBytes(32),bundle=encryptAuthenticatedPayload(base(),key);
  for(const args of [{},{synthetic:true,target:'production'},{synthetic:false,target:'test-isolated-restore'}])
    assert.throws(()=>openRecovery(bundle,key,args),/RECOVERY_DENIED/);
});
