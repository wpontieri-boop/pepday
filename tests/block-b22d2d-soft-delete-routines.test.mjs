import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL(
  '../supabase/migrations/20260925234500_block_b22d2d_soft_delete_routines.sql',
  import.meta.url,
);
const sql = await readFile(migrationUrl, 'utf8');
const signature = 'uuid,uuid,uuid,uuid,bigint,jsonb';

test('D2-D adiciona somente soft-delete versionado de Rotinas', () => {
  assert.match(sql, /create function public\.soft_delete_routine_versioned\s*\(/i);
  assert.doesNotMatch(sql, /create\s+(?:or\s+replace\s+)?function\s+public\.(?:create|update)_routine_versioned/i);
  assert.doesNotMatch(sql, /(?:alter|create)\s+table|create\s+(?:unique\s+)?index/i);
  assert.doesNotMatch(sql, /(?:update|delete\s+from) public\.(?:vials|applications|vial_movements|routine_versions)/i);
  assert.doesNotMatch(sql, /delete\s+from public\.(?:routines|routine_versions)/i);
});

test('fingerprint e intencao local sao deterministas e incluem todo o contrato', () => {
  assert.match(sql, /'mutation','soft_delete','entity_type','routine','entity_id',p_routine_id/i);
  assert.match(sql, /'new_routine_version_id',p_new_routine_version_id[\s\S]*'expected_version',p_expected_version,'base',p_base/i);
  assert.match(sql, /fingerprint:=intent/i);
  assert.match(sql, /'status','inactive'[\s\S]*'\$intent','server_statement_timestamp'/i);
  assert.doesNotMatch(sql, /fingerprint[\s\S]{0,200}statement_timestamp\(\)/i);
});

test('ordem profile-ledger-routine, replay e entitlement obedecem ao contrato', () => {
  const profile = sql.indexOf('from public.profiles where id=u for update');
  const ledger = sql.indexOf('from public.domain_mutation_operations\n    where user_id=u and operation_id=p_operation_id for update');
  const routine = sql.indexOf('from public.routines\n    where user_id=u and id=p_routine_id for update');
  const replay = sql.indexOf("return jsonb_set(op.result,'{replay}'");
  const entitlement = sql.indexOf('entitlement:=public.get_entitlement()');
  assert.ok(profile > 0 && profile < ledger && ledger < routine);
  assert.ok(replay > ledger && replay < entitlement && entitlement < routine);
  assert.doesNotMatch(sql, /from public\.vials[\s\S]*for update|for update[\s\S]*from public\.vials/i);
});

test('soft-delete incrementa versao e cria exatamente um snapshot canonico', () => {
  assert.match(sql, /status='inactive',deleted_at=statement_timestamp\(\)[\s\S]*version=version\+1,updated_at=statement_timestamp\(\)/i);
  assert.match(sql, /confirmed_snapshot:=public\.pepday_routine_snapshot\(deleted_routine\)/i);
  assert.match(sql, /insert into public\.routine_versions[\s\S]*values\(p_new_routine_version_id,u,p_routine_id,deleted_routine\.version,confirmed_snapshot\)/i);
  assert.doesNotMatch(sql, /update public\.routine_versions/i);
});

test('conflitos, revalidacao auth e hardening possuem contrato estavel', () => {
  for (const code of ['ROUTINE_NOT_AVAILABLE','ENTITY_DELETED','STALE_VERSION',
    'ROUTINE_VERSION_ID_UNAVAILABLE']) {
    assert.match(sql, new RegExp(`'${code}'`), code);
  }
  assert.match(sql, /language plpgsql security definer set search_path='' as \$\$/i);
  assert.match(sql, /auth\.uid\(\) is distinct from u[\s\S]*p_expected_user is distinct from auth\.uid\(\)[\s\S]*update public\.routines/i);
  assert.match(sql, new RegExp(`revoke all on function public\\.soft_delete_routine_versioned\\(\\s*${signature}\\s*\\)[\\s\\S]*from public,anon,authenticated`, 'i'));
  assert.match(sql, new RegExp(`grant execute on function public\\.soft_delete_routine_versioned\\(\\s*${signature}\\s*\\)[\\s\\S]*to authenticated`, 'i'));
});
