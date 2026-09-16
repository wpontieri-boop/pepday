// Validação real controlada do B2.2-C. Não persiste nem imprime credenciais.
import { randomBytes, randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { indexedDB as defaultIndexedDB } from 'fake-indexeddb';
import { openPepDayRepository } from '../src/pepday-repository.mjs';
import { createSyncApi } from '../src/sync-api.mjs';
import { createSyncEngine } from '../src/sync-engine.mjs';
import { createTabCoordinator } from '../src/tab-coordinator.mjs';

export const EXPECTED_SUPABASE_URL = 'https://fsbqpyyprtymwrmzsacp.supabase.co';
export const PASS_RESULT = 'PASS FINAL — B2.2-C REAL SYNC/REPLAY/UNDO';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DOMAIN_TABLES = Object.freeze([
  ['profiles', 'id'], ['subscriptions', 'user_id'], ['trials', 'user_id'], ['settings', 'user_id'],
  ['vials', 'user_id'], ['routines', 'user_id'], ['routine_versions', 'user_id'],
  ['applications', 'user_id'], ['vial_movements', 'user_id'], ['local_data_imports', 'user_id'],
  ['legacy_import_records', 'user_id', 'legacy_id'], ['audit_logs', 'user_id'],
]);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const isoDate = (offset = 0) => { const date = new Date(); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); };

function sanitize(error, secrets = []) {
  let message = error instanceof Error ? error.message : String(error);
  for (const value of secrets.filter(Boolean)) message = message.split(String(value)).join('[REDACTED]');
  return message.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').replace(/[A-Za-z0-9_-]{80,}/g, '[REDACTED]').slice(0, 500);
}

async function json(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function ids(uuid) {
  const values = Array.from({ length: 12 }, () => uuid());
  assert(values.every(value => UUID_RE.test(value)) && new Set(values).size === values.length, 'Gerador de UUID inválido ou repetido');
  return Object.freeze({
    marker: values[0], vialPrimary: values[1], routinePrimary: values[2], versionPrimary: values[3],
    applicationPrimary: values[4], undoPrimary: values[5], undoConflict: values[6],
    vialRepair: values[7], routineRepair: values[8], versionRepair: values[9], applicationRepair: values[10], localDatabase: values[11],
  });
}

export function createB22CRealRunner({
  env = process.env, fetchImpl = globalThis.fetch, uuid = randomUUID,
  password = () => `${randomBytes(36).toString('base64url')}!aA9`, indexedDBFactory = defaultIndexedDB,
  recoveryStore,
} = {}) {
  for (const key of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!env[key]) throw new Error(`Variável obrigatória ausente: ${key}`);
  }
  if (env.SUPABASE_URL !== EXPECTED_SUPABASE_URL) throw new Error('SUPABASE_URL não corresponde exatamente ao pepday-v3-test autorizado');
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(env.SUPABASE_PUBLISHABLE_KEY)) {
    throw new Error('SUPABASE_PUBLISHABLE_KEY deve usar a chave pública sb_publishable_... do projeto de teste');
  }
  if (typeof fetchImpl !== 'function') throw new Error('Transporte HTTP indisponível');
  const baseUrl = env.SUPABASE_URL, publishableKey = env.SUPABASE_PUBLISHABLE_KEY, serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const runMarker = uuid(), fixture = ids(uuid);
  assert(UUID_RE.test(runMarker), 'run_marker inválido');
  const email = `pepday-b22c-${runMarker}@example.invalid`;
  const secrets = [publishableKey, serviceKey];
  const state = { user: null, session: null, markerCreated: false, repository: null, recoveryWritten: false };
  const receiptPath = join(tmpdir(), `pepday-b22c-real-${runMarker}.json`);
  const receipt = recoveryStore ?? {
    async save(value) { await writeFile(receiptPath, JSON.stringify(value), { encoding: 'utf8', flag: state.recoveryWritten ? 'w' : 'wx' }); },
    async clear() { await rm(receiptPath, { force: true }); },
  };
  const requestHeaders = (key, token = key) => ({ apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

  async function http(path, { method = 'GET', key = publishableKey, token = key, body, allowFailure = false, prefer, profile } = {}) {
    const headers = requestHeaders(key, token);
    if (prefer) headers.Prefer = prefer;
    if (profile) headers['Accept-Profile'] = profile;
    const response = await fetchImpl(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    const data = await json(response);
    const result = { ok: response.ok, status: response.status, data };
    if (!response.ok && !allowFailure) throw new Error(`HTTP ${response.status} em ${method} ${path.split('?')[0]}`);
    return result;
  }
  const admin = (path, options) => http(`/auth/v1/admin${path}`, { key: serviceKey, ...options });
  const serviceRows = (table, query) => http(`/rest/v1/${table}?${query}`, { key: serviceKey });
  const serviceInsert = (table, body) => http(`/rest/v1/${table}`, { method: 'POST', key: serviceKey, body, prefer: 'return=representation' });
  const userRpc = (name, body) => http(`/rest/v1/rpc/${name}`, { method: 'POST', key: publishableKey, token: state.session.access_token, body });

  async function listUsers() {
    const result = [];
    for (let page = 1; page <= 1000; page += 1) {
      const response = await admin(`/users?page=${page}&per_page=1000`);
      const batch = Array.isArray(response.data) ? response.data : (response.data?.users ?? []);
      result.push(...batch);
      if (batch.length < 1000 && !(Number(response.data?.next_page) > page)) return result;
    }
    throw new Error('Preflight Auth excedeu o limite seguro de paginação');
  }
  async function count(table, query, column = 'id') {
    const result = await serviceRows(table, `${query}&select=${column}`);
    assert(Array.isArray(result.data), `Resposta inesperada ao consultar ${table}`);
    return result.data.length;
  }

  async function preflight() {
    assert(!(await listUsers()).some(user => user.email === email || user.user_metadata?.pepday_b22c_run_marker === runMarker), 'PREFLIGHT: fixture Auth já existe');
    const operationIds = [fixture.applicationPrimary, fixture.undoPrimary, fixture.undoConflict, fixture.applicationRepair].join(',');
    const checks = await Promise.all([
      count('local_data_imports', `id=eq.${fixture.marker}`),
      count('vials', `id=in.(${fixture.vialPrimary},${fixture.vialRepair})`),
      count('routines', `id=in.(${fixture.routinePrimary},${fixture.routineRepair})`),
      count('routine_versions', `id=in.(${fixture.versionPrimary},${fixture.versionRepair})`),
      count('applications', `or=(operation_id.in.(${operationIds}),undo_operation_id.in.(${operationIds}))`),
      count('vial_movements', `operation_id=in.(${operationIds})`),
      count('audit_logs', `operation_id=in.(${operationIds})`),
    ]);
    assert(checks.every(value => value === 0), 'PREFLIGHT: UUID reservado já existe');
  }

  async function createAccount() {
    const generated = password();
    assert(typeof generated === 'string' && generated.length >= 32, 'Senha aleatória insuficientemente forte');
    secrets.push(generated);
    await receipt.save({ package: 'pepday-b22c-real-sync', runMarker, userId: null, email, markerId: fixture.marker });
    state.recoveryWritten = true;
    const created = await admin('/users', { method: 'POST', body: { email, password: generated, email_confirm: true,
      user_metadata: { pepday_b22c_run_marker: runMarker } } });
    assert(created.data?.id && created.data.email === email && created.data.user_metadata?.pepday_b22c_run_marker === runMarker, 'Conta Auth criada sem marker esperado');
    state.user = { id: created.data.id, email };
    await receipt.save({ package: 'pepday-b22c-real-sync', runMarker, userId: state.user.id, email, markerId: fixture.marker });
    const signed = await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: generated } });
    assert(signed.data?.access_token && signed.data?.refresh_token, 'Login normal da conta fixture falhou');
    state.session = { access_token: signed.data.access_token, refresh_token: signed.data.refresh_token, user: { id: state.user.id } };
    secrets.push(state.session.access_token, state.session.refresh_token);
    const identity = await http('/auth/v1/user', { token: state.session.access_token });
    assert(identity.data?.id === state.user.id && identity.data?.user_metadata?.pepday_b22c_run_marker === runMarker, 'JWT não corresponde à conta fixture');
  }

  async function setupRemote() {
    await userRpc('complete_onboarding', { p_name: 'B2.2-C Real', p_country: 'BR', p_timezone: 'America/Sao_Paulo', p_adult: true,
      p_terms_version: 'b22c-real', p_privacy_version: 'b22c-real', p_marketing: false });
    const trial = await userRpc('start_trial', {});
    assert(['trial', 'pro_active'].includes(trial.data?.status), 'Conta fixture sem entitlement de teste');
    await serviceInsert('local_data_imports', { id: fixture.marker, user_id: state.user.id, source_hash: 'c'.repeat(64),
      source_version: 'b22c-real-sync', status: 'completed', completed_at: new Date().toISOString(),
      source_snapshot: { fixture: 'pepday-b22c-real-sync', run_marker: runMarker, user_id: state.user.id, fixture_ids: fixture },
      verification: { purpose: 'cleanup-provenance' } });
    state.markerCreated = true;
    const today = isoDate();
    await serviceInsert('vials', [fixture.vialPrimary, fixture.vialRepair].map((id, index) => ({ id, user_id: state.user.id,
      name: `B2.2-C ${index ? 'repair' : 'primary'}`, initial_mg: 10, remaining_mg: 10, water_ml: 2, prepared_on: today })));
    await serviceInsert('routines', [
      [fixture.routinePrimary, fixture.vialPrimary, 'B2.2-C primary'], [fixture.routineRepair, fixture.vialRepair, 'B2.2-C repair'],
    ].map(([id, vial_id, name]) => ({ id, user_id: state.user.id, vial_id, name, dose_value: 1, dose_unit: 'mg', syringe_capacity: 100,
      frequency: 'daily', start_date: today, status: 'active' })));
    await serviceInsert('routine_versions', [
      [fixture.versionPrimary, fixture.routinePrimary, fixture.vialPrimary, 'B2.2-C primary'],
      [fixture.versionRepair, fixture.routineRepair, fixture.vialRepair, 'B2.2-C repair'],
    ].map(([id, routine_id, vial_id, name]) => ({ id, user_id: state.user.id, routine_id, version: 1,
      snapshot: { id: routine_id, user_id: state.user.id, vial_id, name, dose_value: 1, dose_unit: 'mg', syringe_capacity: 100,
        frequency: 'daily', weekdays: [], start_date: today, status: 'active', deleted_at: null } })));
  }

  async function setupLocal() {
    state.repository = await openPepDayRepository({ accountScope: `user:${state.user.id}`, indexedDBFactory,
      databaseName: `pepday_b22c_real_${fixture.localDatabase}`, outboxOptions: { leaseMs: 100, baseBackoffMs: 10 } });
    for (const item of [
      { id: 'local-vial-primary', name: 'B2.2-C primary', initialMg: 10, remainingMg: 10, remoteRef: { status: 'synced', id: fixture.vialPrimary } },
      { id: 'local-vial-repair', name: 'B2.2-C repair', initialMg: 10, remainingMg: 10, remoteRef: { status: 'synced', id: fixture.vialRepair } },
    ]) await state.repository.vials.put(item);
    for (const item of [
      { id: 'local-routine-primary', vialId: 'local-vial-primary', remoteRef: { status: 'synced', id: fixture.routinePrimary, versionId: fixture.versionPrimary } },
      { id: 'local-routine-repair', vialId: 'local-vial-repair', remoteRef: { status: 'synced', id: fixture.routineRepair, versionId: fixture.versionRepair } },
    ]) await state.repository.routines.put(item);
  }

  function authClient() {
    return { auth: {
      async getSession() { return { data: { session: state.session }, error: null }; },
      async refreshSession() {
        const refreshed = await http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: state.session.refresh_token }, allowFailure: true });
        if (!refreshed.ok) return { data: { session: null }, error: { code: 'AUTH_REFRESH_FAILED' } };
        state.session = { ...state.session, ...refreshed.data, user: { id: state.user.id } };
        secrets.push(state.session.access_token, state.session.refresh_token);
        return { data: { session: state.session }, error: null };
      },
    } };
  }

  function apiWithLostResponse(targetOperationId = null) {
    let lost = false;
    const transport = async (url, options) => {
      const response = await fetchImpl(url, options);
      let body = null;
      try { body = JSON.parse(options?.body ?? 'null'); } catch {}
      const operationId = body?.p_operation_id ?? body?.p_undo_operation_id;
      if (!lost && targetOperationId && operationId === targetOperationId && response.ok) {
        lost = true;
        throw Object.assign(new Error('Resposta perdida simulada'), { code: 'SIMULATED_LOST_RESPONSE' });
      }
      return response;
    };
    return createSyncApi({ client: authClient(), config: { supabaseUrl: baseUrl, supabasePublishableKey: publishableKey }, fetchImpl: transport });
  }

  async function runEngine(api, repository = state.repository, owner = uuid()) {
    const coordinator = createTabCoordinator({ repository, locks: null, ownerId: owner, leaseMs: 100,
      setIntervalFn: () => 1, clearIntervalFn: () => {} });
    const engine = createSyncEngine({ repository, api, coordinator, online: () => true,
      windowTarget: null, documentTarget: null, setTimer: () => 1, clearTimer: () => {}, random: () => 0 });
    const result = await engine.start(); engine.stop(); return result;
  }

  async function waitUntilEligible(operationId) {
    const row = await state.repository.outbox.get(operationId);
    const target = Date.parse(row.status === 'syncing' ? row.leaseExpiresAt : row.nextAttemptAt);
    if (Number.isFinite(target)) await sleep(Math.max(0, target - Date.now()) + 20);
  }

  function fixtureIdsMatch(actual) {
    const expected = Object.entries(fixture);
    return actual && Object.keys(actual).length === expected.length
      && expected.every(([key, value]) => actual[key] === value);
  }
  async function assertRunProvenance() {
    assert(state.user && state.markerCreated, 'Proveniência do run ainda não foi criada');
    const result = await serviceRows('local_data_imports', `id=eq.${fixture.marker}&user_id=eq.${state.user.id}&select=id,user_id,source_snapshot`);
    const row = result.data?.[0], marker = row?.source_snapshot;
    assert(result.data?.length === 1 && row.id === fixture.marker && row.user_id === state.user.id
      && marker?.fixture === 'pepday-b22c-real-sync' && marker?.run_marker === runMarker
      && marker?.user_id === state.user.id && fixtureIdsMatch(marker?.fixture_ids),
    'Proveniência ou IDs do run_marker divergentes');
    return marker;
  }
  function expectedApplication(operationId) {
    if (operationId === fixture.applicationPrimary) return { routineId: fixture.routinePrimary,
      routineVersionId: fixture.versionPrimary, vialId: fixture.vialPrimary };
    if (operationId === fixture.applicationRepair) return { routineId: fixture.routineRepair,
      routineVersionId: fixture.versionRepair, vialId: fixture.vialRepair };
    throw new Error('operation_id não pertence às fixtures do run atual');
  }
  async function remoteApplication(operationId) {
    await assertRunProvenance(); const expected = expectedApplication(operationId);
    const result = await serviceRows('applications', `user_id=eq.${state.user.id}&operation_id=eq.${operationId}&select=*`);
    assert(result.data?.length === 1, `Application remota ${operationId} não é única`);
    const row = result.data[0];
    assert(row.user_id === state.user.id && row.operation_id === operationId
      && row.routine_id === expected.routineId && row.routine_version_id === expected.routineVersionId
      && row.vial_id === expected.vialId, 'Application retornada não pertence aos IDs do run atual');
    return row;
  }
  async function remoteMovements(application, allowedOperationIds) {
    await assertRunProvenance(); const expected = expectedApplication(application.operation_id);
    assert(application.user_id === state.user.id && allowedOperationIds.every(id =>
      [fixture.applicationPrimary, fixture.undoPrimary, fixture.applicationRepair].includes(id)),
    'Movimentos solicitados não pertencem ao run atual');
    const result = await serviceRows('vial_movements', `user_id=eq.${state.user.id}&application_id=eq.${application.id}&select=*`);
    const rows = result.data ?? [];
    assert(rows.every(row => row.user_id === state.user.id && row.application_id === application.id
      && row.vial_id === expected.vialId && allowedOperationIds.includes(row.operation_id)),
    'Movimento retornado não pertence aos IDs do run atual');
    return rows;
  }
  async function remoteVial(id) {
    await assertRunProvenance();
    assert([fixture.vialPrimary, fixture.vialRepair].includes(id), 'Frasco solicitado não pertence ao run atual');
    const result = await serviceRows('vials', `user_id=eq.${state.user.id}&id=eq.${id}&select=*`);
    assert(result.data?.length === 1 && result.data[0].user_id === state.user.id && result.data[0].id === id,
      'Frasco remoto não pertence aos IDs do run atual'); return result.data[0];
  }

  async function primaryScenario() {
    const routine = await state.repository.routines.get('local-routine-primary'), vial = await state.repository.vials.get('local-vial-primary');
    await state.repository.enqueueApplicationIntent({ operationId: fixture.applicationPrimary, routine, vial, scheduledDate: isoDate() });
    await runEngine(apiWithLostResponse(fixture.applicationPrimary));
    let queued = await state.repository.outbox.get(fixture.applicationPrimary);
    assert(queued.status === 'pending' && queued.operationId === fixture.applicationPrimary, 'Resposta perdida não preservou a intenção Application');
    await waitUntilEligible(fixture.applicationPrimary);
    await runEngine(apiWithLostResponse());
    queued = await state.repository.outbox.get(fixture.applicationPrimary);
    assert(queued.status === 'synced' && queued.transportReplay === true, 'Replay Application não confirmou a outbox');
    const application = await remoteApplication(fixture.applicationPrimary), movements = await remoteMovements(application,
      [fixture.applicationPrimary]), remote = await remoteVial(fixture.vialPrimary);
    assert(movements.length === 1 && movements[0].kind === 'application' && Number(movements[0].delta_mg) === -1 && Number(remote.remaining_mg) === 9,
      'Replay Application duplicou movimento ou desconto');
    const local = (await state.repository.applications.list()).find(item => item.operation_id === fixture.applicationPrimary);
    assert(local?.id === application.id && (await state.repository.vials.get('local-vial-primary')).remainingMg === 9, 'Confirmação local da Application divergiu');

    await state.repository.enqueueUndoIntent({ operationId: fixture.undoPrimary, application: local,
      localRoutineId: 'local-routine-primary', localVialId: 'local-vial-primary', scheduledDate: isoDate() });
    await runEngine(apiWithLostResponse(fixture.undoPrimary));
    assert((await state.repository.outbox.get(fixture.undoPrimary)).status === 'pending', 'Resposta perdida não preservou Undo');
    await waitUntilEligible(fixture.undoPrimary); await runEngine(apiWithLostResponse());
    const undoRow = await state.repository.outbox.get(fixture.undoPrimary), undone = await remoteApplication(fixture.applicationPrimary);
    const afterUndo = await remoteMovements(application, [fixture.applicationPrimary, fixture.undoPrimary]), restored = await remoteVial(fixture.vialPrimary);
    assert(undoRow.status === 'synced' && undoRow.transportReplay === true && undone.undo_operation_id === fixture.undoPrimary,
      'Replay Undo não convergiu');
    assert(afterUndo.length === 2 && afterUndo.filter(item => item.kind === 'application').length === 1
      && afterUndo.filter(item => item.kind === 'undo').length === 1 && Number(restored.remaining_mg) === 10,
    'Undo duplicou movimento ou não restaurou saldo');

    const updatedLocal = (await state.repository.applications.list()).find(item => item.operation_id === fixture.applicationPrimary);
    await state.repository.enqueueUndoIntent({ operationId: fixture.undoConflict, application: updatedLocal,
      localRoutineId: 'local-routine-primary', localVialId: 'local-vial-primary', scheduledDate: isoDate() });
    await runEngine(apiWithLostResponse());
    assert((await state.repository.outbox.get(fixture.undoConflict)).status === 'conflict', 'Segundo Undo com UUID diferente não virou conflict');
    assert((await remoteMovements(application, [fixture.applicationPrimary, fixture.undoPrimary])).length === 2
      && Number((await remoteVial(fixture.vialPrimary)).remaining_mg) === 10,
      'Segundo Undo alterou movimento ou saldo');
  }

  async function localFailureRepairScenario() {
    const routine = await state.repository.routines.get('local-routine-repair'), vial = await state.repository.vials.get('local-vial-repair');
    await state.repository.enqueueApplicationIntent({ operationId: fixture.applicationRepair, routine, vial, scheduledDate: isoDate() });
    const realPersist = state.repository.persistRemoteConfirmation.bind(state.repository); let failed = false;
    const proxy = { ...state.repository, get accountScope() { return state.repository.accountScope; },
      async persistRemoteConfirmation(input) { if (!failed) { failed = true; throw Object.assign(new Error('Falha local simulada'), { name: 'QuotaExceededError' }); } return realPersist(input); } };
    const first = await runEngine(apiWithLostResponse(), proxy, uuid());
    assert(first.error && (await state.repository.outbox.get(fixture.applicationRepair)).status === 'syncing', 'Falha local não preservou estado reparável');
    const remoteBefore = await remoteApplication(fixture.applicationRepair);
    assert((await remoteMovements(remoteBefore, [fixture.applicationRepair])).length === 1
      && Number((await remoteVial(fixture.vialRepair)).remaining_mg) === 9,
      'Servidor não confirmou exatamente uma vez antes da falha local');
    await waitUntilEligible(fixture.applicationRepair); await runEngine(apiWithLostResponse());
    const repaired = await state.repository.outbox.get(fixture.applicationRepair);
    assert(repaired.status === 'synced' && repaired.transportReplay === true, 'Replay não reparou falha de persistência local');
    assert((await remoteMovements(remoteBefore, [fixture.applicationRepair])).length === 1
      && Number((await remoteVial(fixture.vialRepair)).remaining_mg) === 9,
      'Reparo local causou segundo desconto ou movimento');
  }

  async function markerMatches() {
    if (!state.user || !state.markerCreated) return false;
    try { await assertRunProvenance(); return true; } catch { return false; }
  }
  async function authMarkerMatches() {
    if (!state.user) return false;
    const result = await admin(`/users/${state.user.id}`, { allowFailure: true });
    return result.ok && result.data?.email === email && result.data?.user_metadata?.pepday_b22c_run_marker === runMarker;
  }

  async function discoverOwnedAccount() {
    if (state.user) return;
    try {
      const matches = (await listUsers()).filter(user => user.email === email
        && user.user_metadata?.pepday_b22c_run_marker === runMarker);
      if (matches.length === 1) state.user = { id: matches[0].id, email };
    } catch { /* a falha de rede será preservada como falha principal/cleanup */ }
  }

  async function cleanup() {
    if (!state.user) return;
    assert(await authMarkerMatches(), 'CLEANUP RECUSADO: run_marker Auth ausente ou divergente');
    if (state.markerCreated) assert(await markerMatches(), 'CLEANUP RECUSADO: marcador de domínio ausente ou divergente');
    await admin(`/users/${state.user.id}`, { method: 'DELETE' });
  }

  async function verifyCleanup() {
    if (!state.user) return;
    const filter = `eq.${state.user.id}`;
    const counts = await Promise.all(DOMAIN_TABLES.map(([table, column, selectColumn]) => count(table, `${column}=${filter}`, selectColumn)));
    assert(counts.every(value => value === 0), 'Cleanup deixou fixture em tabela de domínio');
    const auth = await admin(`/users/${state.user.id}`, { allowFailure: true });
    assert(auth.status === 404, 'Cleanup deixou conta em auth.users');
    if (state.session) {
      const access = await http('/auth/v1/user', { token: state.session.access_token, allowFailure: true });
      const refresh = await http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: state.session.refresh_token }, allowFailure: true });
      assert(!access.ok && !refresh.ok, 'Cleanup deixou token Auth utilizável');
    }
  }

  async function run() {
    let failure = null, cleanupFailure = null;
    try {
      await preflight(); await createAccount(); await setupRemote(); await setupLocal();
      await primaryScenario(); await localFailureRepairScenario();
    } catch (error) { failure = error; }
    finally {
      state.repository?.close();
      await discoverOwnedAccount();
      if (state.user) {
        try { await cleanup(); await verifyCleanup(); await receipt.clear(); state.recoveryWritten = false; }
        catch (error) { cleanupFailure = error; }
      }
    }
    if (failure || cleanupFailure) {
      const reason = [failure, cleanupFailure && new Error(`cleanup: ${cleanupFailure.message}`)].filter(Boolean).map(error => sanitize(error, secrets)).join(' | ');
      return { ok: false, result: `FAIL FINAL — ${reason}` };
    }
    return { ok: true, result: PASS_RESULT };
  }

  return Object.freeze({ run, _test: { state, fixture, runMarker, email, preflight, createAccount, setupRemote, setupLocal,
    primaryScenario, localFailureRepairScenario, cleanup, verifyCleanup, markerMatches, authMarkerMatches, discoverOwnedAccount,
    assertRunProvenance, remoteApplication, remoteMovements, remoteVial, apiWithLostResponse } });
}

export async function main(options) {
  let output;
  try { output = await createB22CRealRunner(options).run(); }
  catch (error) {
    const env = options?.env ?? process.env;
    output = { ok: false, result: `FAIL FINAL — ${sanitize(error, [env.SUPABASE_PUBLISHABLE_KEY, env.SUPABASE_SERVICE_ROLE_KEY])}` };
  }
  console.log(output.result);
  return output.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
