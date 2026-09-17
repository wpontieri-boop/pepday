import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRunValues, evaluateOverlap, generatePackage } from '../scripts/prepare-b22d1-real-validation.mjs';

const files = ['00_preflight.sql','10_prepare.sql','20_create_session_a.sql','21_create_session_b.sql',
  '30_update_delete_session_a.sql','31_update_delete_session_b.sql','90_verify.sql','99_cleanup.sql'];

test('gerador usa UUIDs e marker novos, resolve placeholders e não contém segredo', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'pepday-d1-package-test-'));
  const outputDir = join(parent, 'run');
  try {
    const first = createRunValues();
    const second = createRunValues();
    assert.notEqual(first.RUN_MARKER, second.RUN_MARKER);
    await generatePackage({ outputDir, values: first });
    for (const file of files) {
      const sql = await readFile(join(outputDir, file), 'utf8');
      assert.doesNotMatch(sql, /__[A-Z0-9_]+__/);
      assert.doesNotMatch(sql, /service_role|SUPABASE_|eyJ[A-Za-z0-9_-]+/i);
    }
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test('janela automática aceita sobreposição real e rejeita execução sequencial ou lado ausente', () => {
  const valid = {
    a_lock_acquired_at: '2026-09-16T12:00:00.000Z',
    a_sleep_finished_at: '2026-09-16T12:00:12.000Z',
    b_started_at: '2026-09-16T12:00:02.000Z',
    b_finished_at: '2026-09-16T12:00:12.100Z',
    b_wait_ms: 10100,
  };
  assert.equal(evaluateOverlap(valid), true);
  assert.equal(evaluateOverlap({ ...valid, b_started_at: '2026-09-16T12:00:13.000Z', b_finished_at: '2026-09-16T12:00:13.010Z', b_wait_ms: 10 }), false);
  assert.equal(evaluateOverlap({ ...valid, b_wait_ms: 1000 }), false);
  assert.equal(evaluateOverlap({ ...valid, b_started_at: null }), false);
});

test('SQL exige participação A/B, duração mínima, vencedor fixo e cardinalidades exatas', async () => {
  const verify = await readFile(new URL('../supabase/tests/block_b22d1_real_concurrency/90_verify.sql.template', import.meta.url), 'utf8');
  assert.match(verify, /as duas sessões não participaram/);
  assert.equal((verify.match(/wait_ms'\)::numeric<7000/g) ?? []).length, 2);
  assert.match(verify, /ENTITY_ALREADY_EXISTS/);
  assert.match(verify, /STALE_VERSION/);
  assert.match(verify, /count\(\*\) from public\.domain_mutation_operations[\s\S]*<>4/);
  assert.match(verify, /version=2 and edit_version=2/);
  assert.match(verify, /remaining_mg=10/);
});

test('cleanup é guardado por marker/metadata/IDs e não contém exclusão ampla de domínio', async () => {
  const cleanup = await readFile(new URL('../supabase/tests/block_b22d1_real_concurrency/99_cleanup.sql.template', import.meta.url), 'utf8');
  assert.match(cleanup, /pepday_b22d1_run_marker/);
  assert.match(cleanup, /marker\/IDs não comprovam procedência/);
  assert.match(cleanup, /dados inesperados associados/);
  assert.doesNotMatch(cleanup, /delete\s+from\s+public\./i);
  assert.match(cleanup, /delete from auth\.users where id='__USER_ID__' and email='__FIXTURE_EMAIL__'/i);
  assert.match(cleanup, /auth\.refresh_tokens where user_id=\$1::text/);
  assert.doesNotMatch(cleanup, /auth\.refresh_tokens where user_id=\$1['\s]/);
  assert.match(cleanup, /total_fixtures/);
});
