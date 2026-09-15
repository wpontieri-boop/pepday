import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createB2Automation, main } from '../scripts/test-b2-real-transport.mjs';

const BASE_URL = 'https://fsbqpyyprtymwrmzsacp.supabase.co';
const ENV = { SUPABASE_URL: BASE_URL, SUPABASE_ANON_KEY: 'anon-test-secret', SUPABASE_SERVICE_ROLE_KEY: 'service-test-secret' };
const RUN_MARKER = '92640000-0000-4000-8000-000000000001';

function reply(status, data) {
  return new Response(data === null ? null : JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json' },
  });
}

class FakeSupabase {
  constructor({ allowCrossWrite = false, failCreateB = false, failLoginB = false } = {}) {
    this.allowCrossWrite = allowCrossWrite;
    this.failCreateB = failCreateB;
    this.failLoginB = failLoginB;
    this.users = new Map();
    this.tables = new Map();
    this.tokens = new Map();
    this.calls = [];
    this.rlsApplication = null;
    this.replayApplication = null;
  }

  rows(table) {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table);
  }

  session(headers) {
    return this.tokens.get(headers.get('authorization')?.replace('Bearer ', ''));
  }

  async fetch(input, init = {}) {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    const body = init.body ? JSON.parse(init.body) : null;
    this.calls.push({ path: url.pathname, method });

    if (url.pathname === '/auth/v1/admin/users' && method === 'GET') {
      return reply(200, { users: [...this.users.values()] });
    }
    if (url.pathname === '/auth/v1/admin/users' && method === 'POST') {
      const id = body.email.includes('-a@') ? 'fa640000-0000-4000-8000-000000000004' : 'fb650000-0000-4000-8000-000000000005';
      if (this.failCreateB && body.email.includes('-b@')) return reply(500, { message: 'falha simulada antes de criar B' });
      if ([...this.users.values()].some(user => user.email === body.email)) return reply(422, { message: 'already exists' });
      const user = { id, email: body.email, user_metadata: body.user_metadata };
      this.users.set(id, user);
      this.rows('profiles').push({ id });
      for (const table of ['subscriptions', 'trials', 'settings']) this.rows(table).push({ user_id: id });
      return reply(200, user);
    }
    const adminUser = url.pathname.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/);
    if (adminUser && method === 'GET') {
      const user = this.users.get(adminUser[1]);
      return user ? reply(200, user) : reply(404, { message: 'not found' });
    }
    if (adminUser && method === 'DELETE') {
      const id = adminUser[1];
      if (!this.users.has(id)) return reply(404, { message: 'not found' });
      this.users.delete(id);
      for (const [table, rows] of this.tables) {
        this.tables.set(table, rows.filter(row => row.user_id !== id && row.id !== id));
      }
      for (const [token, session] of this.tokens) if (session.id === id) this.tokens.delete(token);
      return reply(200, {});
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const user = [...this.users.values()].find(item => item.email === body.email);
      if (!user) return reply(400, { message: 'invalid login' });
      if (this.failLoginB && body.email.includes('-b@')) return reply(500, { message: 'falha simulada após criar B' });
      const suffix = user.email.includes('-a@') ? 'a' : 'b';
      const session = { id: user.id, email: user.email, access_token: `access-${suffix}`, refresh_token: `refresh-${suffix}` };
      this.tokens.set(session.access_token, session);
      return reply(200, session);
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const session = [...this.tokens.values()].find(item => item.refresh_token === body.refresh_token);
      return session && this.users.has(session.id)
        ? reply(200, { access_token: session.access_token, refresh_token: session.refresh_token })
        : reply(400, { message: 'invalid refresh token' });
    }
    if (url.pathname === '/auth/v1/user') {
      const session = this.session(headers);
      const user = session && this.users.get(session.id);
      return user ? reply(200, user) : reply(401, { message: 'invalid JWT' });
    }

    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/)?.[1];
    if (rpc) return this.rpc(rpc, body, this.session(headers));
    const table = url.pathname.match(/^\/rest\/v1\/([^/]+)$/)?.[1];
    if (!table) return reply(404, null);
    if (method === 'POST') {
      const inserted = Array.isArray(body) ? body : [body];
      this.rows(table).push(...inserted);
      return reply(201, inserted);
    }
    if (table === 'legacy_import_records' && url.searchParams.get('select') === 'id') {
      return reply(400, { message: 'column legacy_import_records.id does not exist' });
    }
    return reply(200, this.select(table, url, this.session(headers), headers));
  }

  rpc(name, body, session) {
    if (!session) return reply(401, { message: 'invalid JWT' });
    if (name === 'complete_onboarding') return reply(204, null);
    if (name === 'start_trial') return reply(200, { status: 'trial' });
    if (name === 'register_application') {
      const cross = session.email.includes('-b@') && body.p_vial_id.startsWith('e264');
      if (cross && !this.allowCrossWrite) return reply(404, { message: 'Frasco não encontrado' });
      if (body.p_operation_id.startsWith('b264')) {
        if (!this.rlsApplication) {
          this.rlsApplication = { id: 'app-rls', user_id: session.id, operation_id: body.p_operation_id };
          this.rows('applications').push(this.rlsApplication);
          this.rows('vial_movements').push({ id: 'move-rls', user_id: session.id, operation_id: body.p_operation_id });
        }
        return reply(200, { replay: false, application: this.rlsApplication });
      }
      if (!this.replayApplication) {
        this.replayApplication = { id: 'app-replay', user_id: session.id, vial_id: body.p_vial_id,
          operation_id: body.p_operation_id, undone_at: null, undo_operation_id: null };
        this.rows('applications').push(this.replayApplication);
        this.rows('vial_movements').push({ id: 'move-app', user_id: session.id, application_id: 'app-replay',
          kind: 'application', delta_mg: -1, balance_before: 10, balance_after: 9 });
        return reply(200, { replay: false, application: this.replayApplication });
      }
      return reply(200, { replay: true, application: this.replayApplication });
    }
    if (name === 'undo_application') {
      if (session.email.includes('-b@') && body.p_application_id === 'app-rls') return reply(404, { message: 'Aplicação não encontrada' });
      if (body.p_undo_operation_id.endsWith('0002')) {
        this.replayApplication.undone_at = new Date().toISOString();
        this.replayApplication.undo_operation_id = body.p_undo_operation_id;
        this.rows('vial_movements').push({ id: 'move-undo', user_id: session.id, application_id: 'app-replay',
          kind: 'undo', delta_mg: 1, balance_before: 9, balance_after: 10 });
        return reply(200, { replay: false, application: this.replayApplication });
      }
      return reply(409, { message: 'Aplicação já desfeita por outra operação' });
    }
    return reply(404, { message: 'rpc missing' });
  }

  select(table, url, session, headers) {
    let rows = [...this.rows(table)];
    const service = headers.get('authorization') === `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`;
    if (!service && session) rows = rows.filter(row => (row.user_id ?? row.id) === session.id);
    if (!service && url.search.includes('e2640000') && table === 'vials') {
      rows = session?.email.includes('-b@') ? [] : [{ id: 'e264', remaining_mg: 9 }];
    } else if (!service && url.search.includes('e2650000') && table === 'vials') rows = [{ remaining_mg: 10 }];
    else if (!service && url.search.includes('b2640000') && table === 'applications') rows = this.rlsApplication && !session?.email.includes('-b@') ? [this.rlsApplication] : [];
    else if (!service && url.search.includes('b2640000') && table === 'vial_movements') rows = this.rows(table).filter(row => row.operation_id?.startsWith('b264'));
    else if (!service && url.search.includes('app-replay') && table === 'vial_movements') rows = this.rows(table).filter(row => row.application_id === 'app-replay');
    else if (!service && url.search.includes('e2650000') && table === 'applications') rows = this.replayApplication ? [this.replayApplication] : [];
    else if (url.searchParams.get('id')?.startsWith('eq.a264')) rows = rows.filter(row => row.id?.startsWith('a264'));
    return rows;
  }
}

function automation(fake, overrides = {}) {
  return createB2Automation({ env: ENV, fetchImpl: fake.fetch.bind(fake), uuid: () => RUN_MARKER,
    password: () => 'VeryStrongInMemoryPassword-123456789!', ...overrides });
}

test('ciclo completo usa o schema real de legacy_import_records e remove contas/fixtures', async () => {
  const fake = new FakeSupabase();
  const result = await automation(fake).run();
  assert.deepEqual(result, { ok: true, result: 'PASS FINAL — AUTH/RLS + REPLAY/UNDO' });
  assert.equal(fake.users.size, 0);
  assert.equal([...fake.tables.values()].flat().length, 0);
  assert.equal(fake.calls.filter(call => call.path === '/auth/v1/admin/users' && call.method === 'POST').length, 2);
});

test('falha funcional tenta cleanup seguro antes de retornar FAIL', async () => {
  const fake = new FakeSupabase({ allowCrossWrite: true });
  const result = await automation(fake).run();
  assert.equal(result.ok, false);
  assert.match(result.result, /^FAIL FINAL — Auth\/RLS:/);
  assert.equal(fake.users.size, 0);
  assert.equal([...fake.tables.values()].flat().length, 0);
});

test('cleanup recusa conta cujo run_marker foi alterado', async () => {
  const fake = new FakeSupabase();
  const runner = automation(fake);
  await runner._test.preflight();
  await runner._test.createAccount('pepday-b2-jwt-a@example.invalid', 'A');
  fake.users.get(runner._test.state.users[0].id).user_metadata.pepday_b2_run_marker = '00000000-0000-4000-8000-000000000000';
  await assert.rejects(runner._test.cleanup(), /CLEANUP RECUSADO/);
  assert.equal(fake.users.size, 1);
});

test('URL diferente é recusada antes de qualquer request', () => {
  const fake = new FakeSupabase();
  assert.throws(() => createB2Automation({ env: { ...ENV, SUPABASE_URL: 'https://outro.supabase.co' },
    fetchImpl: fake.fetch.bind(fake) }), /não corresponde exatamente/);
  assert.equal(fake.calls.length, 0);
});

test('URL correta com barra final também é recusada antes de qualquer request', () => {
  const fake = new FakeSupabase();
  assert.throws(() => createB2Automation({ env: { ...ENV, SUPABASE_URL: `${BASE_URL}/` },
    fetchImpl: fake.fetch.bind(fake) }), /não corresponde exatamente/);
  assert.equal(fake.calls.length, 0);
});

test('colisão de e-mail no preflight não cria nem remove conta', async () => {
  const fake = new FakeSupabase();
  fake.users.set('existing-user', { id: 'existing-user', email: 'pepday-b2-jwt-a@example.invalid',
    user_metadata: { pepday_b2_run_marker: 'marker-de-outra-execucao' } });
  const result = await automation(fake).run();
  assert.equal(result.ok, false);
  assert.match(result.result, /PREFLIGHT: e-mail Auth fixture já existe/);
  assert.equal(fake.users.size, 1);
  assert.equal(fake.users.get('existing-user').user_metadata.pepday_b2_run_marker, 'marker-de-outra-execucao');
  assert.equal(fake.calls.filter(call => call.path === '/auth/v1/admin/users' && call.method === 'POST').length, 0);
  assert.equal(fake.calls.filter(call => call.method === 'DELETE').length, 0);
});

test('barreira aguarda a operação lenta mesmo quando a outra falha rapidamente', async () => {
  const fake = new FakeSupabase();
  const runner = automation(fake);
  const events = [];
  await assert.rejects(runner._test.coordinated([
    { name: 'falha-rapida', run: async () => { events.push('falha'); throw new Error('falha esperada'); } },
    { name: 'operacao-lenta', run: async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
      events.push('lenta-concluida');
      return { ok: true };
    } },
  ]), /operação concorrente falhou/);
  events.push('cleanup-autorizado');
  assert.deepEqual(events, ['falha', 'lenta-concluida', 'cleanup-autorizado']);
});

test('refresh é válido antes e recusado depois do hard-delete', async () => {
  const fake = new FakeSupabase();
  const runner = automation(fake);
  await runner._test.preflight();
  await runner._test.createAccount('pepday-b2-jwt-a@example.invalid', 'A');
  const refreshToken = runner._test.state.sessions[0].refresh_token;
  const before = await fake.fetch(`${BASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }), headers: {},
  });
  assert.equal(before.ok, true);
  await runner._test.cleanup();
  await runner._test.verifyCleanup();
  const after = await fake.fetch(`${BASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }), headers: {},
  });
  assert.equal(after.ok, false);
});

test('falhas antes e depois da criação de B limpam somente contas do run_marker atual', async () => {
  for (const options of [{ failCreateB: true }, { failLoginB: true }]) {
    const fake = new FakeSupabase(options);
    fake.users.set('unrelated-user', { id: 'unrelated-user', email: 'unrelated@example.invalid',
      user_metadata: { pepday_b2_run_marker: 'marker-de-outra-execucao' } });
    const result = await automation(fake).run();
    assert.equal(result.ok, false);
    assert.deepEqual([...fake.users.keys()], ['unrelated-user']);
    assert.equal([...fake.tables.values()].flat().filter(row =>
      ['fa640000-0000-4000-8000-000000000004', 'fb650000-0000-4000-8000-000000000005'].includes(row.user_id ?? row.id)).length, 0);
    assert.equal(fake.calls.filter(call => call.method === 'DELETE').length, options.failCreateB ? 1 : 2);
  }
});

test('runner não depende de JWT, senha ou marker fornecidos por ambiente', async () => {
  const source = await readFile(new URL('../scripts/test-b2-real-transport.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /PEPDAY_B2_JWT_[AB]|PEPDAY_B2_RUN_MARKER|SUPABASE_PASSWORD/);
  assert.match(source, /SUPABASE_URL/);
  assert.match(source, /SUPABASE_ANON_KEY/);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('runner usa escrita service_role somente nas quatro tabelas administrativas', async () => {
  const source = await readFile(new URL('../scripts/test-b2-real-transport.mjs', import.meta.url), 'utf8');
  const directInserts = [...source.matchAll(/serviceInsert\('([^']+)'/g)].map(match => match[1]).sort();
  assert.deepEqual(directInserts, ['local_data_imports', 'routine_versions', 'routines', 'vials']);
  assert.doesNotMatch(source, /service(?:Rows|Insert)[\s\S]{0,160}method:\s*'(?:PATCH|PUT|DELETE)'/);
});

test('saída final única sanitiza chaves de ambiente', async () => {
  const output = [];
  const original = console.log;
  console.log = value => output.push(String(value));
  try {
    const code = await main({ env: { ...ENV, SUPABASE_URL: 'https://outro.supabase.co' } });
    assert.equal(code, 1);
  } finally { console.log = original; }
  assert.equal(output.length, 1);
  assert.match(output[0], /^FAIL FINAL —/);
  assert.doesNotMatch(output[0], /anon-test-secret|service-test-secret/);
});
