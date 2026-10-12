import test from 'node:test';import assert from 'node:assert/strict';
import {portalHandler,PORTAL_URL,PORTAL_ORIGIN} from '../supabase/functions/partner-portal/portal-core.mjs';
import {SyntheticQuarantine,scanSyntheticBytes,syntheticSampleBytes} from '../supabase/functions/partner-portal/quarantine-core.mjs';
import {makeRecoveryKey,sealSyntheticSnapshot,restoreSyntheticSnapshot} from '../src/partner-recovery-test.mjs';
import {LEGAL_REVIEW,partnerLegalDocuments} from '../src/partner-legal-bundle.mjs';
import {createHash} from 'node:crypto';
test('internal approval is recorded without professional opinion or real acceptance',()=>{assert.equal(LEGAL_REVIEW.ownerCommercialApproved,true);assert.equal(LEGAL_REVIEW.externalLawyerRequired,false);assert.equal(LEGAL_REVIEW.professionalOpinion,false);assert.equal(LEGAL_REVIEW.realAcceptanceEnabled,false);assert.equal(partnerLegalDocuments.length,9)});
test('all legal documents verify version/hash and fiscal text does not invent rates',()=>{for(const d of partnerLegalDocuments){assert.equal(createHash('sha256').update(d.body).digest('hex'),d.sha256);assert.equal(d.version,LEGAL_REVIEW.version)}assert.match(partnerLegalDocuments.find(d=>d.id==='fiscal').body,/aguardando definições da contadora/)});
test('caller-controlled forwarding headers cannot rotate portal rate identity',async()=>{
 const values=[];const h=portalHandler({url:PORTAL_URL,secret:'fixture',fetcher:async(u,o)=>{values.push(JSON.parse(o.body).p_request.ip_hash);return Response.json({ok:true})}});
 for(const ip of ['1.2.3.4','5.6.7.8','1.2.3.4, spoof'])await h(new Request(PORTAL_URL,{method:'POST',headers:{origin:PORTAL_ORIGIN,'content-type':'application/json','x-forwarded-for':ip},body:JSON.stringify({action:'challenge',invite:'A'.repeat(43),ip_hash:'attacker'})}));
 assert.equal(new Set(values).size,1);assert.match(values[0],/^[a-f0-9]{64}$/);
});
test('unknown file and EICAR-labelled marker bytes are rejected, never downloadable',async()=>{
 for(const bytes of [new TextEncoder().encode('QA unknown file'),new TextEncoder().encode('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')]){
 const q=new SyntheticQuarantine(),r=await q.put({owner:'QA-A',bytes,mime:'image/png'});assert.equal(r.status,'rejected');await assert.rejects(q.read({owner:'QA-A',id:r.id}),/DENIED/);
 }
});
test('clean synthetic sample is owner-bound, cloned and removable',async()=>{
 const q=new SyntheticQuarantine(),bytes=syntheticSampleBytes(),r=await q.put({owner:'QA-A',bytes,mime:'image/png'});assert.equal(r.status,'clean');bytes.fill(0);
 await assert.rejects(q.read({owner:'QA-B',id:r.id}),/DENIED/);assert.equal((await q.read({owner:'QA-A',id:r.id})).length,68);
 q.remove({owner:'QA-A',id:r.id});await assert.rejects(q.read({owner:'QA-A',id:r.id}),/DENIED/);
});
test('scanner unavailable or stale proof remains blocked',async()=>{
 for(const scanner of [async()=>{throw Error('QA engine unavailable')},async()=>({status:'clean',sha256:'0'.repeat(64),engine:'synthetic_sha256_allowlist',definitionsVersion:'fixed-sample-v1'})]){
 const q=new SyntheticQuarantine({scanner}),r=await q.put({owner:'QA-A',bytes:syntheticSampleBytes(),mime:'image/png'});assert.equal(r.status,'rejected');
 }
 let now=0;const q=new SyntheticQuarantine({now:()=>now}),r=await q.put({owner:'QA-A',bytes:syntheticSampleBytes(),mime:'image/png'});now=120001;await assert.rejects(q.read({owner:'QA-A',id:r.id}),/DENIED/);
});
test('encrypted synthetic restore reproduces records in isolation without remote writes',async()=>{
 const key=await makeRecoveryKey(),snapshot={version:1,environment:'test_synthetic',schemaVersions:['20261012163141'],objects:[{id:'QA-1',value:'QA backup fixture'}]};
 const bundle=await sealSyntheticSnapshot(snapshot,key),result=await restoreSyntheticSnapshot(bundle,key);assert.deepEqual(result.snapshot,snapshot);assert.equal(result.productionWrite,false);assert.equal(result.remoteWrite,false);assert.ok(!new TextDecoder().decode(bundle.ciphertext).includes('backup fixture'));
});
test('tampered backup, wrong key and PROD restore targets fail closed',async()=>{
 const key=await makeRecoveryKey(),s={version:1,environment:'test_synthetic',schemaVersions:[],objects:[]},b=await sealSyntheticSnapshot(s,key);
 await assert.rejects(restoreSyntheticSnapshot(b,key,{target:'production'}),/DENIED/);await assert.rejects(restoreSyntheticSnapshot(b,await makeRecoveryKey()),/DENIED/);
 const changed={...b,ciphertext:new Uint8Array(b.ciphertext)};changed.ciphertext[0]^=1;await assert.rejects(restoreSyntheticSnapshot(changed,key),/DENIED/);
});
test('backup builder refuses real data and unexpected fields',async()=>{
 const key=await makeRecoveryKey();for(const s of [{version:1,environment:'production',schemaVersions:[],objects:[]},{version:1,environment:'test_synthetic',schemaVersions:[],objects:[],unexpected:true},{version:1,environment:'test_synthetic',schemaVersions:[],objects:[{id:'QA-1',value:'real person'}]}])await assert.rejects(sealSyntheticSnapshot(s,key),/DENIED|ONLY/);
});
