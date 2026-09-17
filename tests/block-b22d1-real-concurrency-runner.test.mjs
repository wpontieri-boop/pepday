import assert from 'node:assert/strict';
import test from 'node:test';
import { executeRealValidation, runOverlapped, sanitizeError, validateDatabaseUrl,
  withSqlContext, withTimeout } from '../scripts/test-b22d1-real-concurrency.mjs';

const validUrl = 'postgresql://postgres:secret@db.fsbqpyyprtymwrmzsacp.supabase.co:5432/postgres';

test('guard aceita somente conexão do pepday-v3-test e não expõe credencial', () => {
  assert.equal(validateDatabaseUrl(validUrl), validUrl);
  assert.throws(() => validateDatabaseUrl('postgresql://postgres:secret@db.outro.supabase.co/postgres'), /pepday-v3-test/);
  assert.throws(() => validateDatabaseUrl('postgresql://postgres@db.fsbqpyyprtymwrmzsacp.supabase.co/postgres'), /credencial/);
  assert.doesNotMatch(sanitizeError(new Error(validUrl)), /secret|fsbqpyyprtymwrmzsacp/);
});

test('duas queries são disparadas sobrepostas e ambas terminam antes da avaliação', async () => {
  const events = [];
  let releaseA;
  const a = { query: async () => { events.push('a-start'); await new Promise(r => { releaseA = r; }); events.push('a-end'); } };
  const b = { query: async () => { events.push('b-start'); releaseA(); await new Promise(r => setTimeout(r, 5)); events.push('b-end'); } };
  await runOverlapped(a, b, 'A', 'B', 0);
  assert.deepEqual(events, ['a-start','b-start','a-end','b-end']);
});

test('falha rápida não encerra espera enquanto a outra conexão continua', async () => {
  const events = [];
  const a = { query: async () => { events.push('a-start'); throw new Error('falha A'); } };
  const b = { query: async () => { events.push('b-start'); await new Promise(r => setTimeout(r, 10)); events.push('b-end'); } };
  await assert.rejects(runOverlapped(a, b, 'A', 'B', 0), /falha A/);
  assert.deepEqual(events, ['a-start','b-start','b-end']);
});

test('mensagens de erro removem URL, senha e tokens', () => {
  const sanitized = sanitizeError(new Error('postgresql://user:pw@host/db password=abc token=xyz\ntrace'));
  assert.doesNotMatch(sanitized, /pw|abc|xyz|postgresql:\/\//);
  assert.doesNotMatch(sanitized, /\n/);
});

test('erro SQL futuro identifica cenário, etapa e operação sem expor credenciais', async () => {
  await assert.rejects(withSqlContext({
    scenario: 'create concorrente',
    step: 'sessões A/B',
    operation: 'create_vial_versioned',
  }, async () => { throw new Error(`operator is not unique: unknown - unknown ${validUrl} token=secreto`); }), error => {
    assert.match(error.message, /cenário: create concorrente/);
    assert.match(error.message, /etapa: sessões A\/B/);
    assert.match(error.message, /operação SQL lógica: create_vial_versioned/);
    assert.match(error.message, /operator is not unique: unknown - unknown/);
    assert.doesNotMatch(error.message, /secret|secreto|fsbqpyyprtymwrmzsacp/);
    return true;
  });
});

test('Promise que nunca resolve termina em timeout explícito', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 10, 'teste pendente'),
    /Timeout em teste pendente/);
});

test('conexão encerrada com query pendente produz FAIL em vez de top-level await órfão', async () => {
  class StuckClient {
    on() {}
    connect() { return Promise.resolve(); }
    query() { return new Promise(() => {}); }
    end() { return new Promise(() => {}); }
  }
  await assert.rejects(executeRealValidation({
    Client: StuckClient,
    connectionString: validUrl,
    delayMs: 0,
    timeouts: { connectMs: 10, queryMs: 10, closeMs: 10 },
  }), /falha principal: cenário: preflight; etapa: recuperar run anterior; operação SQL lógica: inspecionar e limpar marker conhecido; erro: Timeout em admin/);
});

test('falha antes de connect não enfileira rollback eterno no cliente desconectado', async () => {
  const instances = [];
  class PartialConnectClient {
    constructor() { this.index = instances.push(this) - 1; this.queryCount = 0; }
    on() {}
    connect() { return this.index === 0 ? Promise.reject(new Error('connect recusado')) : Promise.resolve(); }
    query() { this.queryCount += 1; return new Promise(() => {}); }
    end() { return Promise.resolve(); }
  }
  await assert.rejects(executeRealValidation({
    Client: PartialConnectClient,
    connectionString: validUrl,
    delayMs: 0,
    timeouts: { connectMs: 10, queryMs: 10, closeMs: 10 },
  }), /connect recusado/);
  assert.equal(instances[0].queryCount, 0, 'cliente admin desconectado recebeu query/rollback');
});
