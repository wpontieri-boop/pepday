import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL(
  '../supabase/migrations/20260925210000_block_b22d2b_create_routines.sql',
  import.meta.url,
);
const sql = await readFile(migrationUrl, 'utf8');
const signature = 'uuid,uuid,uuid,uuid,uuid,text,numeric,text,integer,text,integer[],date,time,integer';

test('D2-B adiciona somente a criação versionada de Rotinas', () => {
  assert.match(sql, /create function public\.create_routine_versioned\s*\(/i);
  assert.doesNotMatch(sql, /create\s+(?:or\s+replace\s+)?function\s+public\.(?:update|soft_delete)_routine_versioned/i);
  assert.doesNotMatch(sql, /(?:alter|create)\s+table|create\s+(?:unique\s+)?index/i);
  assert.doesNotMatch(sql, /register_application|undo_application|vial_movements\s*\(|applications\s*\(/i);
});

test('fingerprint inclui IDs e payload funcional normalizado', () => {
  const fingerprint = sql.match(/local_snapshot:=jsonb_build_object[\s\S]*?fingerprint:=intent;/i)?.[0] ?? '';
  for (const field of ['id','user_id','vial_id','name','dose_value','dose_unit',
    'syringe_capacity','frequency','weekdays','start_date','time_of_day','refill_at',
    'status','version','deleted_at','routine_version_id']) {
    assert.match(fingerprint, new RegExp(`'${field}'`), field);
  }
  assert.match(sql, /array_agg\(distinct day order by day\)/i);
  assert.match(sql, /day is null or day<0 or day>6/i);
  assert.match(sql, /p_frequency not in \('daily','alternate','5on2off','weekdays'\)/i);
  assert.doesNotMatch(sql, /replace\s*\([^)]*5x2|when\s+'5x2'/i);
});

test('locks seguem profiles, ledger e vial, nessa ordem', () => {
  const profileLock = sql.indexOf('from public.profiles where id=u for update');
  const ledgerRead = sql.indexOf('from public.domain_mutation_operations');
  const vialLock = sql.indexOf('from public.vials\n    where user_id=u');
  assert.ok(profileLock > 0 && profileLock < ledgerRead && ledgerRead < vialLock);
});

test('sucesso cria versão 1 pelo snapshot canônico e persiste resultado', () => {
  assert.match(sql, /values\(p_routine_id,u,p_vial_id[\s\S]*?'active',1,null\)/i);
  assert.match(sql, /confirmed_snapshot:=public\.pepday_routine_snapshot\(created\)/i);
  assert.match(sql, /insert into public\.routine_versions[\s\S]*values\(p_routine_version_id,u,p_routine_id,1,confirmed_snapshot\)/i);
  assert.doesNotMatch(sql, /to_jsonb\s*\(\s*created\s*\)|to_jsonb\s*\(\s*existing\s*\)/i);
  assert.match(sql, /'outcome','success'[\s\S]*'routine_version_id',p_routine_version_id[\s\S]*'snapshot',confirmed_snapshot/i);
  assert.match(sql, /values\(u,p_operation_id,'routine',p_routine_id,'create',fingerprint,'success',result\)/i);
});

test('conflitos funcionais têm códigos estáveis e não seguem para o insert', () => {
  for (const code of ['ENTITY_ALREADY_EXISTS','ROUTINE_VERSION_ID_UNAVAILABLE','VIAL_NOT_AVAILABLE']) {
    assert.equal((sql.match(new RegExp(`'${code}'`, 'g')) ?? []).length, 1, code);
  }
  assert.match(sql, /op\.intent_fingerprint is distinct from fingerprint/i);
  assert.match(sql, /return jsonb_set\(op\.result,'\{replay\}','true'::jsonb,false\)/i);
  assert.ok(sql.indexOf("return jsonb_set(op.result") < sql.indexOf('entitlement:=public.get_entitlement()'));
});

test('RPC segue hardening e grants mínimos', () => {
  assert.match(sql, /language plpgsql security definer set search_path='' as \$\$/i);
  assert.match(sql, /auth\.uid\(\) is distinct from u[\s\S]*p_expected_user is distinct from auth\.uid\(\)/i);
  assert.match(sql, new RegExp(`revoke all on function public\\.create_routine_versioned\\(\\s*${signature.replace(/[\[\]]/g, '\\$&')}\\s*\\)[\\s\\S]*from public,anon,authenticated`, 'i'));
  assert.match(sql, new RegExp(`grant execute on function public\\.create_routine_versioned\\(\\s*${signature.replace(/[\[\]]/g, '\\$&')}\\s*\\)[\\s\\S]*to authenticated`, 'i'));
});
