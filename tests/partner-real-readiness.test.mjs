import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPartnerDraft,inspectDocumentCandidate,inspectContractVersion} from '../src/partner-real-readiness.mjs';
import {META_TEMPLATE_DRAFTS,templateActivationCheck} from '../supabase/functions/meta-whatsapp-gateway/template-catalog.mjs';
test('real draft analysis reuses existing validation and never opens collection or returns PII',()=>{
 const p={kind:'CPF',legal_name:'QA Nome',document:'00000000000',email:'qa@example.invalid',pix_type:'random',pix_key:'00000000-0000-4000-8000-000000000001'};
 const r=inspectPartnerDraft(p);assert.equal(r.valid,false);assert.ok(r.errors.includes('INVALID_DOCUMENT'));assert.equal(r.realCollection,false);assert.equal(r.contractAcceptance,false);assert.equal(r.identityVerified,false);
 assert.ok(!JSON.stringify(r).includes(p.document));assert.ok(!JSON.stringify(r).includes(p.pix_key));
});
test('CPF MEI CNPJ are recognized without invented mandatory documents or fiscal rules',()=>{
 for(const kind of ['CPF','MEI','CNPJ']){
 const r=inspectPartnerDraft({kind,document:kind==='CPF'?'00000000000':'00000000000000'});
 assert.ok(!r.errors.includes('INVALID_KIND'));assert.ok(r.errors.includes('INVALID_DOCUMENT'));assert.equal(r.realCollection,false);
 }
});
test('financial injection unknown keys and unsafe names rejected',()=>{
 const r=inspectPartnerDraft({kind:'CPF',legal_name:'QA\nNome',document:'0',email:'wrong',pix_type:'invalid',commission_percent:90});
 for(const e of ['UNKNOWN_FIELD','INVALID_NAME','INVALID_DOCUMENT','INVALID_EMAIL','INVALID_PIX'])assert.ok(r.errors.includes(e));
});
test('malware and quarantine cannot be bypassed by PDF PNG JPEG magic bytes',()=>{
 for(const [mime,bytes] of [['application/pdf',new TextEncoder().encode('%PDF-')],['image/png',Uint8Array.from([137,80,78,71,13,10,26,10])],['image/jpeg',Uint8Array.from([255,216,255])]]){
 const r=inspectDocumentCandidate({mime,bytes,size:bytes.length});assert.equal(r.valid,true);assert.equal(r.uploadEnabled,false);assert.equal(r.quarantineRequired,true);assert.equal(r.malwareScanRequired,true);
 }
});
test('upload size spoof mismatch and illegal MIME rejected',()=>{
 assert.equal(inspectDocumentCandidate({mime:'image/png',bytes:new Uint8Array(5),size:5}).valid,false);
 assert.equal(inspectDocumentCandidate({mime:'text/html',bytes:new Uint8Array(5),size:5}).valid,false);
 assert.equal(inspectDocumentCandidate({mime:'image/png',bytes:new Uint8Array(5),size:6*1024*1024}).valid,false);
});
test('contract validation never enables acceptance including a client legalApproved claim',()=>{
 for(const legalApproved of [true,false]){
 const r=inspectContractVersion({version:'draft-1',sha256:'a'.repeat(64),legalApproved});assert.equal(r.valid,true);assert.equal(r.acceptanceEnabled,false);
 }
 assert.equal(inspectContractVersion({version:'x\n',sha256:'bad'}).valid,false);
});
test('Meta catalog uses static no-reply notices, optout and pending approval',()=>{
 assert.equal(META_TEMPLATE_DRAFTS.length,4);
 for(const t of META_TEMPLATE_DRAFTS){assert.equal(t.realSend,false);assert.equal(t.approval,'pending_meta');if(t.body){assert.match(t.body,/PARAR/);assert.match(t.body,/não responde/)}}
});
test('Meta approvals and channel IDs cannot enable actual send',()=>{
 assert.equal(templateActivationCheck({kind:'initial',metaApproval:'APPROVED',phoneNumberId:'123',wabaId:'123',supportUrl:'https://example.invalid'}).enabled,false);
 assert.ok(templateActivationCheck({}).reasons.includes('CHANNEL_PENDING'));
});
