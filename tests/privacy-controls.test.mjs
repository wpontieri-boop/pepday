import test from 'node:test';import assert from 'node:assert/strict';
import {minimizePartnerFields,retentionDecision,rightsDecision,safeIncidentEvent} from '../scripts/security/privacy-controls.mjs';
test('purpose allowlists reject unnecessary health/identity data and diagnostics omit values',()=>{
  assert.deepEqual(minimizePartnerFields('identity',{legal_name:'QA Name',document:'QA mock'}),{allowed:true,purpose:'identity',fields:['document','legal_name'],realCollection:false});
  assert.throws(()=>minimizePartnerFields('identity',{selfie:'QA'}),/EXCESS/);assert.throws(()=>minimizePartnerFields('health',{health:'QA'}),/PURPOSE/);
  assert.ok(!JSON.stringify(minimizePartnerFields('payment',{pix_key:'QA hidden value'})).includes('hidden value'));
});
test('undefined fiscal retention cannot become zero/default; legal hold wins over expiry',()=>{
  assert.equal(retentionDecision({purpose:'fiscal',now:100}).action,'block');
  const rule={purpose:'fiscal',now:100,expiresAt:50,approvedAt:10,approvedBy:'QA-owner',policyVersion:'qa-policy-explicit'};
  assert.equal(retentionDecision(rule).action,'eligible_synthetic_erasure');assert.equal(retentionDecision({...rule,legalHold:true}).action,'preserve_restricted');
  assert.equal(retentionDecision({...rule,approvedAt:200}).action,'block');assert.equal(retentionDecision(rule).realErasure,false);
});
test('rights are owner-bound; opt-out never revokes contract access or confiscates commission',()=>{
  assert.equal(rightsDecision({request:'access',requester:'QA-A',owner:'QA-B',verified:true}).allowed,false);
  assert.equal(rightsDecision({request:'access',requester:'QA-A',owner:'QA-A'}).allowed,false);
  const r=rightsDecision({request:'channel_opt_out',requester:'QA-A',owner:'QA-A',verified:true});
  assert.equal(r.stopChannel,true);assert.equal(r.contractAccessPreserved,true);assert.equal(r.commissionPreserved,true);assert.equal(r.eraseDocuments,false);assert.equal(r.realAction,false);
});
test('incident records accept only minimum enums/QA references and deny contents or contact fields',()=>{
  const e={kind:'contained',reference:'QA-incident-1',occurredAt:100};assert.deepEqual(safeIncidentEvent(e),e);
  for(const extra of [{body:'message'},{phone:'number'},{token:'value'}])assert.throws(()=>safeIncidentEvent({...e,...extra}),/DENIED/);
});
