import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {captureSyntheticPages,sealSyntheticSnapshot,confirmSyntheticSnapshot,newSyntheticKeyForQA} from '../scripts/security/storage-pagination-qa.mjs';

const objects=[
  {id:'QA-storageA',owner:'QA-ownerA',mime:'image/png',bytes:Buffer.from('QA PNG BYTES')},
  {id:'QA-storageB',owner:'QA-ownerB',mime:'application/pdf',bytes:Buffer.from('QA PDF BYTES')},
  {id:'QA-storageC',owner:'QA-ownerA',mime:'image/jpeg',bytes:Buffer.from('QA JPG BYTES')}
];
function dataCallbacks(rows=objects){
  return {
    listPage:async({cursor,limit,synthetic})=>{
      assert.equal(synthetic,true);
      const start=cursor===null?0:Number(cursor.slice('QA-next'.length));
      const batch=rows.slice(start,start+limit);
      const next=start+batch.length<rows.length?'QA-next'+(start+batch.length):null;
      return {items:batch.map(({id,owner,mime})=>({id,owner,mime})),nextCursor:next};
    },
    readObject:async({id,synthetic})=>{
      assert.equal(synthetic,true);
      return Buffer.from(rows.find(x=>x.id===id).bytes);
    }
  };
}
test('Storage synthetic pages enumerate all objects and seal DB+bytes together',async()=>{
  const snapshot=await captureSyntheticPages({...dataCallbacks(),limit:2});
  assert.equal(snapshot.objectCount,3);
  assert.equal(snapshot.allPagesRead,true);
  assert.equal(snapshot.remoteStorageTouched,false);
  assert.equal(snapshot.items[0].bytes.toString(),'QA PNG BYTES');
  const key=newSyntheticKeyForQA();
  const bundle=sealSyntheticSnapshot({snapshot,database:Buffer.from('QA-DATABASE-CONTENTS'),key});
  const report=confirmSyntheticSnapshot({bundle,key,expectedIds:objects.map(x=>x.id)});
  assert.equal(report.status,'PASS_SYNTHETIC_DB_STORAGE_ROUNDTRIP');
  assert.equal(report.objects,3);
  assert.equal(report.realBackupProven,false);
  key.fill(0);
});
test('zero objects finishes cleanly without faking remote backup',async()=>{
  const snapshot=await captureSyntheticPages({
    listPage:async()=>({items:[],nextCursor:null}),
    readObject:async()=>{throw Error('unexpected read')}
  });
  assert.equal(snapshot.objectCount,0);
  assert.equal(snapshot.allPagesRead,true);
});
test('duplicate object IDs fail closed',async()=>{
  const rows=[objects[0],objects[0]];
  await assert.rejects(()=>captureSyntheticPages({...dataCallbacks(rows),limit:1}),/SYNTHETIC_STORAGE_DENIED/);
});
test('path traversal, non-QA records, and unsupported MIME are denied',async()=>{
  for(const bad of [
    {id:'../escape',owner:'QA-owner',mime:'image/png'},
    {id:'QA-valid',owner:'person@example.com',mime:'image/png'},
    {id:'QA-valid',owner:'QA-owner',mime:'text/html'}
  ]){
    await assert.rejects(()=>captureSyntheticPages({
      listPage:async()=>({items:[bad],nextCursor:null}),readObject:async()=>Buffer.from('qa')
    }),/SYNTHETIC_STORAGE_DENIED/);
  }
});
test('repeated cursors and empty continuation pages are denied',async()=>{
  await assert.rejects(()=>captureSyntheticPages({
    listPage:async()=>({items:[],nextCursor:'QA-next1'}),
    readObject:async()=>Buffer.from('qa')
  }),/SYNTHETIC_STORAGE_DENIED/);
  await assert.rejects(()=>captureSyntheticPages({
    listPage:async()=>({items:[{id:'QA-one',owner:'QA-owner',mime:'image/png'}],nextCursor:'QA-loop'}),
    readObject:async()=>Buffer.from('qa'),limit:1
  }),/SYNTHETIC_STORAGE_DENIED/);
});
test('metadata mismatches and malformed page shapes are denied',async()=>{
  await assert.rejects(()=>captureSyntheticPages({
    listPage:async()=>({items:[]}),readObject:async()=>Buffer.from('qa')
  }),/SYNTHETIC_STORAGE_DENIED/);
  await assert.rejects(()=>captureSyntheticPages({
    listPage:async()=>({items:[{id:'QA-a',owner:'QA-o',mime:'image/png',secret:'unexpected'}],nextCursor:null}),
    readObject:async()=>Buffer.from('qa')
  }),/SYNTHETIC_STORAGE_DENIED/);
});
test('ciphertext tampering and wrong secret cannot recover synthetic snapshot',async()=>{
  const snapshot=await captureSyntheticPages({...dataCallbacks(),limit:2});
  const key=newSyntheticKeyForQA();
  const bundle=sealSyntheticSnapshot({snapshot,database:Buffer.from('QA-DB'),key});
  assert.throws(()=>confirmSyntheticSnapshot({bundle,key:newSyntheticKeyForQA(),expectedIds:objects.map(x=>x.id)}));
  const bad={...bundle,ciphertext:Buffer.from(bundle.ciphertext)};
  bad.ciphertext[0]^=1;
  assert.throws(()=>confirmSyntheticSnapshot({bundle:bad,key,expectedIds:objects.map(x=>x.id)}));
  assert.throws(()=>confirmSyntheticSnapshot({bundle,key,expectedIds:['QA-storageA']}),/SYNTHETIC_STORAGE_DENIED/);
  key.fill(0);
});
test('Storage QA is dependency injected, without network, secrets or remote endpoints',()=>{
  const src=readFileSync(new URL('../scripts/security/storage-pagination-qa.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(src,/https?:\/\/|fetch\(|supabase\.co|PGPASSWORD|service_role|googleapis\.com|fs\/promises/);
  assert.match(src,/synthetic:true/);
  assert.match(src,/remoteStorageTouched:false/);
});
