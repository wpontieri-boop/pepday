import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');

test('migração registra consentimento sensível separado sem presumir aceite antigo',async()=>{
  const sql=await read('supabase/migrations/20261001020400_legal_consent_fields.sql');
  assert.match(sql,/add column sensitive_data_consent_at timestamptz/i);
  assert.match(sql,/add column sensitive_data_consent_version text/i);
  assert.match(sql,/profiles_sensitive_consent_pair/i);
  assert.doesNotMatch(sql,/update\s+public\.profiles[^;]*sensitive_data_consent_at\s*=\s*now\(\)/i);
});

test('onboarding exige consentimento específico e persiste versão própria',async()=>{
  const sql=await read('supabase/migrations/20261001020400_legal_consent_fields.sql');
  assert.match(sql,/p_sensitive_consent boolean/i);
  assert.match(sql,/p_sensitive_consent_version text/i);
  assert.match(sql,/p_sensitive_consent is distinct from true/i);
  assert.match(sql,/sensitive_data_consent_at=stamp/i);
  assert.match(sql,/sensitive_data_consent_version=trim\(p_sensitive_consent_version\)/i);
  assert.match(sql,/sensitive_data_consent_granted/i);
});

test('assinatura de RPC antiga é removida e nova fica limitada a authenticated',async()=>{
  const sql=await read('supabase/migrations/20261001020400_legal_consent_fields.sql');
  assert.match(sql,/drop function if exists public\.complete_onboarding\(\s*text,text,text,boolean,text,text,boolean\s*\)/i);
  assert.match(sql,/revoke all on function public\.complete_onboarding\([\s\S]*boolean,text,boolean[\s\S]*\) from public,anon,authenticated/i);
  assert.match(sql,/grant execute on function public\.complete_onboarding\([\s\S]*boolean,text,boolean[\s\S]*\) to authenticated/i);
});

test('trial exige consentimento sensível registrado',async()=>{
  const sql=await read('supabase/migrations/20261001020400_legal_consent_fields.sql');
  const section=sql.slice(sql.indexOf('create or replace function public.start_trial'));
  assert.match(section,/sensitive_data_consent_at is not null/i);
});
