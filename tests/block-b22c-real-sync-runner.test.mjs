import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { createB22CRealRunner, EXPECTED_SUPABASE_URL, main, PASS_RESULT } from '../scripts/test-b22c-real-sync.mjs';

const ENV = { SUPABASE_URL: EXPECTED_SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_runner_test', SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-secret' };
const UUIDS = Array.from({ length: 13 }, (_, index) => `${(index + 1).toString(16).padStart(8, '0')}-0000-4000-8000-${(index + 1).toString().padStart(12, '0')}`);
const response = (status, data) => new Response(data == null ? null : JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

class FakeRemote {
  constructor({ failLogin = false, failFixtureTable = null, loseCreateResponse = false } = {}) {
    this.failLogin = failLogin; this.failFixtureTable = failFixtureTable; this.loseCreateResponse = loseCreateResponse; this.calls = []; this.users = new Map(); this.tokens = new Map(); this.tables = new Map();
  }
  rows(name) { if (!this.tables.has(name)) this.tables.set(name, []); return this.tables.get(name); }
  session(headers) { return this.tokens.get(headers.get('authorization')?.replace('Bearer ', '')); }
  cascade(userId) {
    for (const [name, rows] of this.tables) this.tables.set(name, rows.filter(row => row.user_id !== userId && row.id !== userId));
    for (const [token, session] of this.tokens) if (session.user.id === userId) this.tokens.delete(token);
  }
  select(table, url) {
    let rows = [...this.rows(table)];
    for (const [key, value] of url.searchParams) {
      if (key === 'select' || key === 'or') continue;
      if (value.startsWith('eq.')) rows = rows.filter(row => String(row[key]) === value.slice(3));
      if (value.startsWith('in.(')) rows = rows.filter(row => value.slice(4, -1).split(',').includes(String(row[key])));
    }
    if (url.searchParams.has('or')) {
      const values = [...url.searchParams.get('or').matchAll(/[a-z_]+\.in\.\(([^)]+)\)/g)].flatMap(match => match[1].split(','));
      rows = rows.filter(row => values.includes(row.operation_id) || values.includes(row.undo_operation_id));
    }
    return rows;
  }
  register(body, user) {
    if (!body.p_operation_id || !body.p_expected_user || user.id !== body.p_expected_user) return response(400, { message: 'intenção inválida' });
    let application = this.rows('applications').find(row => row.operation_id === body.p_operation_id && row.user_id === user.id);
    if (application) {
      const movement = this.rows('vial_movements').find(row => row.application_id === application.id && row.kind === 'application' && row.user_id === user.id);
      const vial = this.rows('vials').find(row => row.id === application.vial_id && row.user_id === user.id);
      return response(200, { replay: true, application, movement, vial });
    }
    const vial = this.rows('vials').find(row => row.id === body.p_vial_id && row.user_id === user.id);
    if (!vial) return response(404, { message: 'Frasco não encontrado' });
    application = { id: `app-${body.p_operation_id}`, user_id: user.id, operation_id: body.p_operation_id,
      routine_id: body.p_routine_id, routine_version_id: body.p_routine_version_id, vial_id: body.p_vial_id,
      scheduled_date: body.p_scheduled_date, dose_mg: 1, balance_before: vial.remaining_mg, balance_after: vial.remaining_mg - 1,
      undone_at: null, undo_operation_id: null };
    const movement = { id: `move-${body.p_operation_id}`, user_id: user.id, operation_id: body.p_operation_id,
      application_id: application.id, vial_id: vial.id, kind: 'application', delta_mg: -1,
      balance_before: vial.remaining_mg, balance_after: vial.remaining_mg - 1 };
    vial.remaining_mg -= 1; this.rows('applications').push(application); this.rows('vial_movements').push(movement);
    return response(200, { replay: false, application, movement, vial });
  }
  undo(body, user) {
    if (!body.p_undo_operation_id || !body.p_application_id || body.p_expected_user !== user.id) return response(400, { message: 'parâmetros de Undo inválidos' });
    const application = this.rows('applications').find(row => row.id === body.p_application_id && row.user_id === user.id);
    if (!application) return response(404, { message: 'Aplicação não encontrada' });
    const vial = this.rows('vials').find(row => row.id === application.vial_id);
    if (application.undo_operation_id) {
      if (application.undo_operation_id !== body.p_undo_operation_id) return response(409, { code: 'P0001', message: 'Aplicação já foi desfeita por outra operação' });
      return response(200, { replay: true, application,
        movement: this.rows('vial_movements').find(row => row.operation_id === body.p_undo_operation_id), vial });
    }
    application.undo_operation_id = body.p_undo_operation_id; application.undone_at = new Date().toISOString();
    const movement = { id: `move-${body.p_undo_operation_id}`, user_id: user.id, operation_id: body.p_undo_operation_id,
      application_id: application.id, vial_id: vial.id, kind: 'undo', delta_mg: 1,
      balance_before: vial.remaining_mg, balance_after: vial.remaining_mg + 1 };
    vial.remaining_mg += 1; this.rows('vial_movements').push(movement);
    return response(200, { replay: false, application, movement, vial });
  }
  async fetch(input, init = {}) {
    const url = new URL(input), method = init.method ?? 'GET', headers = new Headers(init.headers), body = init.body ? JSON.parse(init.body) : null;
    const bearer = headers.get('authorization')?.replace('Bearer ', '');
    this.calls.push({ path: url.pathname, method,
      keyKind: headers.get('apikey') === ENV.SUPABASE_PUBLISHABLE_KEY ? 'publishable'
        : headers.get('apikey') === ENV.SUPABASE_SERVICE_ROLE_KEY ? 'service' : 'other',
      authKind: this.tokens.has(bearer) ? 'user' : bearer === ENV.SUPABASE_SERVICE_ROLE_KEY ? 'service' : 'other',
      operationId: body?.p_operation_id ?? body?.p_undo_operation_id ?? null });
    if (url.pathname === '/auth/v1/admin/users' && method === 'GET') return response(200, { users: [...this.users.values()] });
    if (url.pathname === '/auth/v1/admin/users' && method === 'POST') {
      const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user = { id, email: body.email, user_metadata: body.user_metadata };
      this.users.set(id, user); for (const [table, row] of [['profiles', { id }], ['subscriptions', { user_id: id }], ['trials', { user_id: id }], ['settings', { user_id: id }]]) this.rows(table).push(row);
      if (this.loseCreateResponse) throw new TypeError('resposta Admin perdida');
      return response(200, user);
    }
    const adminUser = url.pathname.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/);
    if (adminUser && method === 'GET') return this.users.has(adminUser[1]) ? response(200, this.users.get(adminUser[1])) : response(404, { message: 'not found' });
    if (adminUser && method === 'DELETE') { const user = this.users.get(adminUser[1]); if (!user) return response(404, {}); this.users.delete(user.id); this.cascade(user.id); return response(200, {}); }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      if (this.failLogin) return response(500, { message: 'falha após criar conta' });
      const user = [...this.users.values()].find(item => item.email === body.email); if (!user) return response(400, {});
      const session = { access_token: 'access-token-secret', refresh_token: 'refresh-token-secret', user: { id: user.id } };
      this.tokens.set(session.access_token, session); return response(200, session);
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const session = [...this.tokens.values()].find(item => item.refresh_token === body.refresh_token);
      return session && this.users.has(session.user.id) ? response(200, session) : response(400, { message: 'invalid refresh' });
    }
    if (url.pathname === '/auth/v1/user') { const session = this.session(headers); return session && this.users.has(session.user.id) ? response(200, this.users.get(session.user.id)) : response(401, {}); }
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/)?.[1], session = this.session(headers);
    if (rpc === 'complete_onboarding') return session ? response(204, null) : response(401, {});
    if (rpc === 'start_trial') return session ? response(200, { status: 'trial' }) : response(401, {});
    if (rpc === 'register_application') return session ? this.register(body, session.user) : response(401, {});
    if (rpc === 'undo_application') return session ? this.undo(body, session.user) : response(401, {});
    const table = url.pathname.match(/^\/rest\/v1\/([^/]+)$/)?.[1]; if (!table) return response(404, {});
    if (method === 'POST') {
      if (this.failFixtureTable === table) return response(500, { message: 'falha fixture parcial' });
      const inserted = Array.isArray(body) ? body : [body]; this.rows(table).push(...structuredClone(inserted)); return response(201, inserted);
    }
    return response(200, this.select(table, url));
  }
}

function create(fake, overrides = {}) {
  let index = 0; const recovery = { values: [], async save(value) { this.values.push(value); }, async clear() { this.values.length = 0; } };
  return { recovery, runner: createB22CRealRunner({ env: ENV, fetchImpl: fake.fetch.bind(fake), indexedDBFactory: indexedDB,
    uuid: () => UUIDS[index++], password: () => 'Strong-Random-In-Memory-Password-123456!', recoveryStore: recovery, ...overrides }) };
}

function isolated(fake, offset) {
  let index = 0;
  const values = Array.from({ length: 20 }, (_, item) => `${(item + offset).toString(16).padStart(8, '0')}-0000-4000-8000-${(item + offset).toString().padStart(12, '0')}`);
  return create(fake, { uuid: () => values[index++] });
}

test('runner completo valida sync, replay, Undo, conflito, reparo local e zero fixtures', async () => {
  const fake = new FakeRemote(), { runner, recovery } = create(fake), result = await runner.run();
  assert.deepEqual(result, { ok: true, result: PASS_RESULT }); assert.equal(fake.users.size, 0); assert.equal([...fake.tables.values()].flat().length, 0); assert.equal(recovery.values.length, 0);
  const register = fake.calls.filter(call => call.path === '/rest/v1/rpc/register_application').map(call => call.operationId);
  const undo = fake.calls.filter(call => call.path === '/rest/v1/rpc/undo_application').map(call => call.operationId);
  assert.deepEqual(register, [UUIDS[5], UUIDS[5], UUIDS[11], UUIDS[11]]);
  assert.deepEqual(undo, [UUIDS[6], UUIDS[6], UUIDS[7]]);
  const userMutations = fake.calls.filter(call => ['/rest/v1/rpc/register_application', '/rest/v1/rpc/undo_application'].includes(call.path));
  assert.equal(userMutations.every(call => call.keyKind === 'publishable' && call.authKind === 'user'), true);
});

test('URL guard recusa projeto diferente e barra final antes de qualquer request', () => {
  for (const url of ['https://outro.supabase.co', `${EXPECTED_SUPABASE_URL}/`]) {
    const fake = new FakeRemote(); assert.throws(() => createB22CRealRunner({ env: { ...ENV, SUPABASE_URL: url }, fetchImpl: fake.fetch.bind(fake) }), /não corresponde exatamente/); assert.equal(fake.calls.length, 0);
  }
});

test('key guard aceita somente sb_publishable e rejeita anon JWT legada antes de request', () => {
  const fake = new FakeRemote();
  assert.throws(() => createB22CRealRunner({ env: { ...ENV, SUPABASE_PUBLISHABLE_KEY: 'eyJhbGciOiJIUzI1NiJ9.legacy' },
    fetchImpl: fake.fetch.bind(fake) }), /deve usar a chave pública sb_publishable_/);
  assert.equal(fake.calls.length, 0);
});

test('falha após criar somente a conta executa cleanup guardado', async () => {
  const fake = new FakeRemote({ failLogin: true }), { runner } = create(fake), result = await runner.run();
  assert.equal(result.ok, false); assert.equal(fake.users.size, 0); assert.equal([...fake.tables.values()].flat().length, 0);
});

test('resposta perdida na criação Auth redescobre somente a conta do marker e limpa', async () => {
  const fake = new FakeRemote({ loseCreateResponse: true }), { runner } = create(fake), result = await runner.run();
  assert.equal(result.ok, false); assert.equal(fake.users.size, 0); assert.equal([...fake.tables.values()].flat().length, 0);
});

test('falha após fixtures parciais limpa somente o run atual e preserva terceiros', async () => {
  const fake = new FakeRemote({ failFixtureTable: 'routines' }); fake.users.set('unrelated', { id: 'unrelated', email: 'other@example.invalid', user_metadata: { pepday_b22c_run_marker: 'other' } });
  fake.rows('vials').push({ id: 'unrelated-vial', user_id: 'unrelated', remaining_mg: 5 });
  const { runner } = create(fake), result = await runner.run(); assert.equal(result.ok, false);
  assert.deepEqual([...fake.users.keys()], ['unrelated']); assert.equal(fake.rows('vials').some(row => row.id === 'unrelated-vial'), true);
});

test('cleanup recusa marker divergente e não exclui a conta', async () => {
  const fake = new FakeRemote(), { runner } = create(fake); await runner._test.preflight(); await runner._test.createAccount();
  fake.users.get(runner._test.state.user.id).user_metadata.pepday_b22c_run_marker = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  await assert.rejects(runner._test.cleanup(), /CLEANUP RECUSADO/); assert.equal(fake.users.size, 1);
});

test('preflight com colisão não cria nem exclui dados preexistentes', async () => {
  const fake = new FakeRemote(); fake.rows('local_data_imports').push({ id: UUIDS[1], user_id: 'existing' });
  const { runner } = create(fake), result = await runner.run(); assert.equal(result.ok, false);
  assert.equal(fake.rows('local_data_imports').length, 1); assert.equal(fake.calls.some(call => call.method === 'DELETE'), false);
});

test('cardinalidade ignora registros externos coincidentes e mantém usuário/run isolados', async () => {
  const fake = new FakeRemote(), { runner } = isolated(fake, 201);
  await runner._test.preflight(); await runner._test.createAccount(); await runner._test.setupRemote(); await runner._test.setupLocal();
  const { fixture } = runner._test, externalUser = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  fake.rows('applications').push({ id: 'external-application', user_id: externalUser,
    operation_id: fixture.applicationPrimary, routine_id: fixture.routinePrimary,
    routine_version_id: fixture.versionPrimary, vial_id: fixture.vialPrimary });
  fake.rows('vial_movements').push({ id: 'external-movement', user_id: externalUser,
    operation_id: fixture.applicationPrimary, application_id: `app-${fixture.applicationPrimary}`,
    vial_id: fixture.vialPrimary, kind: 'application', delta_mg: -999 });
  fake.rows('vials').push({ id: fixture.vialPrimary, user_id: externalUser, remaining_mg: -999 });
  await runner._test.primaryScenario();
  assert.equal(fake.rows('applications').some(row => row.id === 'external-application'), true);
  assert.equal(fake.rows('vial_movements').some(row => row.id === 'external-movement'), true);
  assert.equal(fake.rows('vials').some(row => row.user_id === externalUser), true);
  runner._test.state.repository.close(); await runner._test.cleanup(); await runner._test.verifyCleanup();
});

test('verificação rejeita run_marker, fixture_ids ou associação retornada divergentes', async () => {
  const fake = new FakeRemote(), { runner } = isolated(fake, 301);
  await runner._test.preflight(); await runner._test.createAccount(); await runner._test.setupRemote(); await runner._test.setupLocal();
  const { fixture, state, runMarker } = runner._test;
  const marker = fake.rows('local_data_imports').find(row => row.id === fixture.marker);
  marker.source_snapshot.run_marker = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  await assert.rejects(runner._test.remoteVial(fixture.vialPrimary), /Proveniência/);
  marker.source_snapshot.run_marker = runMarker;
  const originalVialId = marker.source_snapshot.fixture_ids.vialPrimary;
  marker.source_snapshot.fixture_ids.vialPrimary = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  await assert.rejects(runner._test.remoteVial(fixture.vialPrimary), /Proveniência/);
  marker.source_snapshot.fixture_ids.vialPrimary = originalVialId;
  fake.rows('applications').push({ id: 'wrong-association', user_id: state.user.id,
    operation_id: fixture.applicationPrimary, routine_id: fixture.routinePrimary,
    routine_version_id: fixture.versionPrimary, vial_id: fixture.vialRepair });
  await assert.rejects(runner._test.remoteApplication(fixture.applicationPrimary), /não pertence aos IDs/);
  state.repository.close(); await runner._test.cleanup(); await runner._test.verifyCleanup();
});

test('saída final é única e sanitiza todas as credenciais', async () => {
  const output = [], original = console.log; console.log = value => output.push(String(value));
  try { assert.equal(await main({ env: { ...ENV, SUPABASE_URL: 'https://invalid.supabase.co' } }), 1); } finally { console.log = original; }
  assert.equal(output.length, 1); assert.match(output[0], /^FAIL FINAL —/); assert.doesNotMatch(output[0], /sb_publishable_runner_test|service-role-test-secret|access-token-secret|refresh-token-secret/);
});

test('caminho PASS também imprime uma única linha final', async () => {
  const fake = new FakeRemote(), output = [], original = console.log; let index = 0;
  const alternate = Array.from({ length: 13 }, (_, item) => `${(item + 101).toString(16).padStart(8, '0')}-0000-4000-8000-${(item + 101).toString().padStart(12, '0')}`);
  console.log = value => output.push(String(value));
  try {
    const code = await main({ env: ENV, fetchImpl: fake.fetch.bind(fake), indexedDBFactory: indexedDB,
      uuid: () => alternate[index++], password: () => 'Strong-Random-In-Memory-Password-123456!',
      recoveryStore: { async save() {}, async clear() {} } });
    assert.equal(code, 0);
  } finally { console.log = original; }
  assert.deepEqual(output, [PASS_RESULT]);
});

test('run_marker padrão é aleatório por execução', () => {
  const fake = new FakeRemote();
  const a = createB22CRealRunner({ env: ENV, fetchImpl: fake.fetch.bind(fake) });
  const b = createB22CRealRunner({ env: ENV, fetchImpl: fake.fetch.bind(fake) });
  assert.notEqual(a._test.runMarker, b._test.runMarker);
});

test('nenhum segredo é aceito por argumento nem gravado no recovery receipt', async () => {
  const fake = new FakeRemote(), { runner, recovery } = create(fake); await runner._test.preflight(); await runner._test.createAccount();
  const serialized = JSON.stringify(recovery.values); assert.doesNotMatch(serialized, /Strong-Random|access-token|refresh-token|publishable|service-role/);
  assert.deepEqual(process.argv.filter(value => /SUPABASE_|token|password/i.test(value)), []);
});
