import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../docs/operations/PWA-TELEMETRY-RATE-LIMIT-DRAFT-20261113.sql',import.meta.url),'utf8');

test('SQL remains an inert draft and not a migration',()=>{
  assert.match(source,/DO NOT APPLY TO TEST OR PROD/i);
  assert.match(source,/supabase\/migrations/);
  assert.doesNotMatch(source,/drop\s+table|truncate\s+table|disable\s+row\s+level\s+security/i);
});
test('proposed RPC keeps signature, privilege model and idempotency',()=>{
  assert.match(source,/create or replace function public\.record_pwa_install_event\(\s*p_installation_id uuid,\s*p_event_id uuid,\s*p_event_type text,\s*p_platform text/);
  assert.match(source,/security definer\s+set search_path=''/i);
  assert.match(source,/on conflict do nothing/i);
  assert.match(source,/grant execute on function public\.record_pwa_install_event\(uuid,uuid,text,text\)\s+to anon,authenticated/i);
});
test('limiter has global and per-ID rolling-hour gates with one advisory transaction lock',()=>{
  assert.match(source,/pg_try_advisory_xact_lock\(202611,13\)/);
  assert.match(source,/where e\.created_at>stamp-interval '1 hour'\)>=240/);
  assert.match(source,/and e\.created_at>stamp-interval '1 hour'\)>=12/);
  assert.match(source,/pwa_install_events_installation_created_idx/);
});
test('the proposed policy is honest about untrusted UUID and missing gateway throttling',()=>{
  assert.match(source,/untrusted installation UUIDs/);
  assert.match(source,/does NOT protect network\/CPU/);
  assert.match(source,/thresholds are provisional/);
});
