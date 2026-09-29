import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeEntitlement, postTrialExperience } from '../src/entitlement.mjs';

const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');

test('pós-trial aparece somente para trial realmente expirado',()=>{
  const expired=normalizeEntitlement({
    status:'pro_expired',pro:false,source:'trial',trial_used:true,
    trial_available:false,ends_at:'2026-09-28T12:00:00Z'
  },{signedIn:true});
  const experience=postTrialExperience(expired);
  assert.equal(experience.visible,true);
  assert.match(experience.message,/PepDay FREE/i);
  assert.match(experience.message,/dados PRO permanecem salvos/i);

  assert.equal(postTrialExperience(normalizeEntitlement({
    status:'pro_expired',pro:false,source:'subscription',trial_used:true
  },{signedIn:true})).visible,false);
  assert.equal(postTrialExperience(normalizeEntitlement({
    status:'trial',pro:true,source:'trial',trial_used:true
  },{signedIn:true})).visible,false);
});

test('Home oferece continuar no FREE ou voltar ao PRO sem apagar dados',async()=>{
  const html=await read('index.html');
  const ui=await read('src/account-ui.mjs');
  assert.match(html,/id="postTrialNotice"/);
  assert.match(html,/id="postTrialViewPro"[^>]*>Ver planos PRO</);
  assert.match(html,/id="postTrialContinueFree"[^>]*>Continuar no FREE</);
  assert.match(ui,/postTrialExperience\(access\)/);
  assert.match(ui,/postTrialDismissed=true/);
  assert.match(ui,/proOffer[^]*scrollIntoView/);
  assert.doesNotMatch(ui,/postTrial[^\n]*(delete|clear|removeItem)/i);
});

test('e-mail de fim de trial exige consentimento no enqueue e revalida antes do claim',async()=>{
  const sql=await read('supabase/migrations/20260929024659_post_trial_recovery_policy.sql');
  assert.match(sql,/p_event_type in \('trial_ending','trial_ended'\)/);
  assert.match(sql,/item\.event_type in \('trial_ending','trial_ended'\)/);
  assert.ok((sql.match(/marketing_opt_in/g)||[]).length>=2);
  assert.ok((sql.match(/MARKETING_CONSENT_REQUIRED/g)||[]).length>=2);
  assert.match(sql,/status='suppressed'/);
  assert.match(sql,/grant execute on function public\.enqueue_transactional_email[^]*to service_role/i);
  assert.match(sql,/grant execute on function public\.claim_transactional_email[^]*to service_role/i);
  assert.doesNotMatch(sql,/grant execute[^]*to (anon|authenticated)/i);
});

test('recuperados por campanha continuam indisponíveis até tracking real',async()=>{
  const sql=await read('supabase/migrations/20260929022500_fix_admin_lifecycle_marketing_column.sql');
  const admin=await read('site/admin/admin.mjs');
  assert.match(sql,/'recovered_campaign_available',false/);
  assert.match(admin,/data\.recovered_campaign_available\?'0':'—'/);
});
