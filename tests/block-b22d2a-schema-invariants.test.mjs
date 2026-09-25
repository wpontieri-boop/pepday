import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = new URL('../supabase/migrations/20260925195332_block_b22d2a_routine_schema_invariants.sql', import.meta.url);
const sql = await readFile(file, 'utf8');

test('D2-A limita-se a schema/invariantes e não cria RPCs de Rotina', () => {
  assert.doesNotMatch(sql, /create\s+function\s+public\.(create|update|soft_delete)_routine_versioned/i);
  assert.doesNotMatch(sql, /create\s+or\s+replace\s+function\s+public\.(register_application|undo_application)/i);
  assert.match(sql, /entity_type\s+in\s*\('vial','routine'\)/i);
});

test('preflights vêm antes de qualquer alteração estrutural', () => {
  const firstAlter = sql.search(/alter\s+table/i);
  for (const marker of ['Rotina sem versão corrente', 'identidade incompatível',
    'Application aponta para versão de outra Rotina', 'Rotina excluída logicamente']) {
    assert.ok(sql.indexOf(marker) > 0 && sql.indexOf(marker) < firstAlter, marker);
  }
});

test('snapshot canônico é explícito e exclui timestamps técnicos', () => {
  const body = sql.match(/create function public\.pepday_routine_snapshot[\s\S]*?\$\$;/i)?.[0] ?? '';
  for (const field of ['id','user_id','vial_id','name','dose_value','dose_unit','syringe_capacity',
    'frequency','weekdays','start_date','time_of_day','refill_at','status','version','deleted_at']) {
    assert.match(body, new RegExp(`'${field}'`));
  }
  assert.doesNotMatch(body, /created_at|updated_at|to_jsonb\s*\(\s*p_routine/i);
  assert.match(body, /select distinct day[\s\S]*order by day/i);
});

test('routine_versions bloqueia apenas UPDATE e mantém cascade possível', () => {
  assert.match(sql, /create trigger routine_versions_block_update\s+before update/i);
  assert.doesNotMatch(sql, /before\s+(?:update\s+or\s+delete|delete)/i);
  assert.match(sql, /deferrable initially deferred/i);
  assert.match(sql, /create constraint trigger routine_versions_current_guard\s+after insert or delete/i);
});

test('Applications recebe vínculo composto e consultas ganham somente índices necessários', () => {
  assert.match(sql, /foreign key\(user_id,routine_id,routine_version_id\)[\s\S]*references public\.routine_versions\(user_id,routine_id,id\)/i);
  assert.match(sql, /create index routines_active_vial_idx[\s\S]*where status='active' and deleted_at is null/i);
  assert.equal((sql.match(/create index routines_active_vial_idx/gi) ?? []).length, 1);
});
