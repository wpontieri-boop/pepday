import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL(
  '../supabase/migrations/20260925223000_block_b22d2c_update_routines.sql',
  import.meta.url,
);
const sql = await readFile(migrationUrl, 'utf8');
const signature = 'uuid,uuid,uuid,uuid,bigint,jsonb,jsonb';

test('D2-C adiciona somente update versionado de Rotinas', () => {
  assert.match(sql, /create function public\.update_routine_versioned\s*\(/i);
  assert.doesNotMatch(sql, /create\s+(?:or\s+replace\s+)?function\s+public\.(?:create|soft_delete)_routine_versioned/i);
  assert.doesNotMatch(sql, /(?:alter|create)\s+table|create\s+(?:unique\s+)?index/i);
  assert.doesNotMatch(sql, /update public\.(?:vials|applications|vial_movements)/i);
});

test('patch possui allowlist, validacao estrita e normalizacao canonica', () => {
  for (const field of ['vial_id','name','dose_value','dose_unit','syringe_capacity',
    'frequency','weekdays','start_date','time_of_day','refill_at']) {
    assert.match(sql, new RegExp(`'${field}'`), field);
  }
  for (const forbidden of ['status','deleted_at','version','user_id','id']) {
    assert.doesNotMatch(sql, new RegExp(`key not in \\([^)]*'${forbidden}'`, 'i'), forbidden);
  }
  assert.match(sql, /jsonb_typeof\(p_base\)[\s\S]*octet_length\(p_patch::text\)>16384/i);
  assert.match(sql, /array_agg\(distinct[\s\S]*order by/i);
  assert.match(sql, /fingerprint:=intent/i);
  assert.match(sql, /'base',p_base,'patch',normalized_patch/i);
  assert.doesNotMatch(sql, /replace\s*\([^)]*5x2|when\s+'5x2'/i);
});

test('ordem de locks e replay antecedem entitlement', () => {
  const profile = sql.indexOf('from public.profiles where id=u for update');
  const ledger = sql.indexOf('from public.domain_mutation_operations\n    where user_id=u and operation_id=p_operation_id for update');
  const routine = sql.indexOf('from public.routines\n    where user_id=u and id=p_routine_id for update');
  const vials = sql.indexOf('from public.vials v\n    where v.user_id=u and v.id in (current_routine.vial_id,target_vial_id)');
  const replay = sql.indexOf("return jsonb_set(op.result,'{replay}'");
  const entitlement = sql.indexOf('entitlement:=public.get_entitlement()');
  assert.ok(profile > 0 && profile < ledger && ledger < routine && routine < vials);
  assert.match(sql, /order by v\.id for update/i);
  assert.match(sql, /current_canonical_weekdays[\s\S]*array_agg\(distinct day order by day\)/i);
  assert.ok(replay > ledger && replay < entitlement);
});

test('no-op persiste sucesso sem update nem nova routine_version', () => {
  const branch = sql.match(/if not semantic_change then[\s\S]*?return result;\s*end if;/i)?.[0] ?? '';
  assert.match(branch, /'no_op',true/i);
  assert.match(branch, /'routine_version_id',current_routine_version_id/i);
  assert.match(branch, /'update',fingerprint,'success',result/i);
  assert.doesNotMatch(branch, /update public\.routines|insert into public\.routine_versions/i);
  assert.ok(sql.indexOf('if not semantic_change then') < sql.indexOf('where id=p_new_routine_version_id'));
});

test('mudanca incrementa exatamente uma versao e usa snapshot canonico', () => {
  assert.match(sql, /version=version\+1,updated_at=statement_timestamp\(\)/i);
  assert.match(sql, /confirmed_snapshot:=public\.pepday_routine_snapshot\(updated_routine\)/i);
  assert.match(sql, /insert into public\.routine_versions[\s\S]*values\(p_new_routine_version_id,u,p_routine_id,updated_routine\.version,confirmed_snapshot\)/i);
  assert.match(sql, /'no_op',false[\s\S]*'routine_version_id',p_new_routine_version_id/i);
  assert.doesNotMatch(sql, /update public\.routine_versions/i);
});

test('conflitos, isolamento e hardening possuem contrato estavel', () => {
  for (const code of ['ROUTINE_NOT_AVAILABLE','ENTITY_DELETED','STALE_VERSION',
    'VIAL_NOT_AVAILABLE','ROUTINE_VERSION_ID_UNAVAILABLE']) {
    assert.match(sql, new RegExp(`'${code}'`), code);
  }
  assert.match(sql, /language plpgsql security definer set search_path='' as \$\$/i);
  assert.match(sql, /auth\.uid\(\) is distinct from u[\s\S]*p_expected_user is distinct from auth\.uid\(\)/i);
  assert.match(sql, new RegExp(`revoke all on function public\\.update_routine_versioned\\(\\s*${signature}\\s*\\)[\\s\\S]*from public,anon,authenticated`, 'i'));
  assert.match(sql, new RegExp(`grant execute on function public\\.update_routine_versioned\\(\\s*${signature}\\s*\\)[\\s\\S]*to authenticated`, 'i'));
});
