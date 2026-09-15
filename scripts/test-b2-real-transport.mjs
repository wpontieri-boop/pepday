// B2.1: Auth/RLS real e replay concorrente + Undo em pepday-v3-test.
// Executa o ciclo inteiro sem persistir ou imprimir chaves, senhas ou tokens.
import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const AUTH_EMAIL_A = 'pepday-b2-jwt-a@example.invalid';
const AUTH_EMAIL_B = 'pepday-b2-jwt-b@example.invalid';
const EXPECTED_URL = 'https://fsbqpyyprtymwrmzsacp.supabase.co';
const FIXTURE = Object.freeze({
  marker: 'a2640000-0000-4000-8000-000000000004',
  vialRls: 'e2640000-0000-4000-8000-000000000004', vialReplay: 'e2650000-0000-4000-8000-000000000005',
  routineRls: 'd2640000-0000-4000-8000-000000000004', routineReplay: 'd2650000-0000-4000-8000-000000000005',
  versionRls: 'c2640000-0000-4000-8000-000000000004', versionReplay: 'c2650000-0000-4000-8000-000000000005',
  rlsRegister: 'b2640000-0000-4000-8000-000000000001', crossRegister: 'b2640000-0000-4000-8000-000000000002',
  crossUndo: 'b2640000-0000-4000-8000-000000000003', replayRegister: 'b2650000-0000-4000-8000-000000000001',
  firstUndo: 'b2650000-0000-4000-8000-000000000002', secondUndo: 'b2650000-0000-4000-8000-000000000003',
});
const PUBLIC_TABLES = [
  ['profiles', 'id'], ['subscriptions', 'user_id'], ['trials', 'user_id'], ['settings', 'user_id'],
  ['vials', 'user_id'], ['routines', 'user_id'], ['routine_versions', 'user_id'], ['applications', 'user_id'],
  ['vial_movements', 'user_id'], ['local_data_imports', 'user_id'],
  ['legacy_import_records', 'user_id', 'legacy_id'], ['audit_logs', 'user_id'],
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_DISPATCH_SKEW_MS = 25;
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function safeReason(error, secrets) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets.filter(Boolean)) message = message.split(secret).join('[REDACTED]');
  return message.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').slice(0, 500);
}

async function responseJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export function createB2Automation({ env = process.env, fetchImpl = fetch, uuid = randomUUID,
  password = () => `${randomBytes(32).toString('base64url')}!aA9` } = {}) {
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  for (const key of required) if (!env[key]) throw new Error(`Variável obrigatória ausente: ${key}`);
  const baseUrl = env.SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (baseUrl !== EXPECTED_URL) throw new Error('SUPABASE_URL não corresponde exatamente ao pepday-v3-test autorizado');

  const runMarker = uuid();
  assert(UUID_RE.test(runMarker), 'Gerador retornou run_marker inválido');
  const secrets = [anonKey, serviceKey];
  const state = { users: [], sessions: [], markerCreated: false };
  const headers = (key, token = key) => ({ apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

  async function http(path, { method = 'GET', key = anonKey, token = key, body, allowFailure = false, prefer, profile } = {}) {
    const started = performance.now();
    const requestHeaders = headers(key, token);
    if (prefer) requestHeaders.Prefer = prefer;
    if (profile) requestHeaders['Accept-Profile'] = profile;
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000),
    });
    const data = await responseJson(response);
    const result = { ok: response.ok, status: response.status, duration_ms: Math.round(performance.now() - started), data };
    if (!response.ok && !allowFailure) throw new Error(`HTTP ${response.status} em ${method} ${path.split('?')[0]}`);
    return result;
  }
  const admin = (path, options) => http(`/auth/v1/admin${path}`, { key: serviceKey, ...options });
  const serviceRows = (table, query) => http(`/rest/v1/${table}?${query}`, { key: serviceKey });
  const userRows = (session, table, query) => http(`/rest/v1/${table}?${query}`, { key: anonKey, token: session.access_token });
  const rpc = (session, name, body, options = {}) => http(`/rest/v1/rpc/${name}`, {
    method: 'POST', key: anonKey, token: session.access_token, body, ...options,
  });
  const serviceInsert = (table, body) => http(`/rest/v1/${table}`, {
    method: 'POST', key: serviceKey, body, prefer: 'return=representation',
  });

  async function listAllUsers() {
    const users = [];
    let page = 1;
    while (page <= 1000) {
      const result = await admin(`/users?page=${page}&per_page=1000`);
      const batch = Array.isArray(result.data) ? result.data : (result.data?.users ?? []);
      users.push(...batch);
      const nextPage = Number(result.data?.next_page ?? 0);
      if (nextPage > page) { page = nextPage; continue; }
      if (batch.length < 1000) return users;
      page += 1;
    }
    throw new Error('Preflight Auth excedeu o limite seguro de paginação');
  }

  async function count(table, query, selectColumn = 'id') {
    const result = await serviceRows(table, `${query}&select=${selectColumn}`);
    assert(Array.isArray(result.data), `Resposta inesperada no preflight de ${table}`);
    return result.data.length;
  }

  async function preflight() {
    const existingUsers = await listAllUsers();
    assert(!existingUsers.some(user => [AUTH_EMAIL_A, AUTH_EMAIL_B].includes(user.email)), 'PREFLIGHT: e-mail Auth fixture já existe');
    const operations = [FIXTURE.rlsRegister, FIXTURE.crossRegister, FIXTURE.crossUndo,
      FIXTURE.replayRegister, FIXTURE.firstUndo, FIXTURE.secondUndo].join(',');
    const checks = await Promise.all([
      count('local_data_imports', `id=eq.${FIXTURE.marker}`),
      count('vials', `id=in.(${FIXTURE.vialRls},${FIXTURE.vialReplay})`),
      count('routines', `id=in.(${FIXTURE.routineRls},${FIXTURE.routineReplay})`),
      count('routine_versions', `id=in.(${FIXTURE.versionRls},${FIXTURE.versionReplay})`),
      count('applications', `or=(operation_id.in.(${operations}),undo_operation_id.in.(${operations}))`),
      count('vial_movements', `operation_id=in.(${operations})`),
      count('audit_logs', `operation_id=in.(${operations})`),
    ]);
    assert(checks.every(value => value === 0), 'PREFLIGHT: UUID reservado já existe');
  }

  async function createAccount(email, label) {
    const generatedPassword = password();
    assert(typeof generatedPassword === 'string' && generatedPassword.length >= 32, 'Gerador retornou senha insuficientemente forte');
    secrets.push(generatedPassword);
    const created = await admin('/users', { method: 'POST', body: {
      email, password: generatedPassword, email_confirm: true, user_metadata: { pepday_b2_run_marker: runMarker },
    } });
    assert(created.data?.id && created.data.email === email
      && created.data.user_metadata?.pepday_b2_run_marker === runMarker, `Conta ${label} criada sem identidade/marker esperado`);
    state.users.push({ id: created.data.id, email });
    const signed = await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: generatedPassword } });
    assert(signed.data?.access_token && signed.data?.refresh_token, `Login normal da conta ${label} falhou`);
    secrets.push(signed.data.access_token, signed.data.refresh_token);
    assert(!state.sessions.some(session => session.access_token === signed.data.access_token), 'Auth retornou o mesmo JWT para duas contas');
    const session = { id: created.data.id, email, access_token: signed.data.access_token, refresh_token: signed.data.refresh_token };
    const identity = await http('/auth/v1/user', { token: session.access_token });
    assert(identity.data?.id === created.data.id && identity.data?.email === email
      && identity.data?.user_metadata?.pepday_b2_run_marker === runMarker,
    `JWT da conta ${label} não corresponde à identidade/marker criada`);
    state.sessions.push(session);
  }

  async function prepare() {
    for (const [session, label] of state.sessions.map((item, index) => [item, index ? 'B' : 'A'])) {
      await rpc(session, 'complete_onboarding', {
        p_name: `B2 JWT ${label}`, p_country: 'BR', p_timezone: 'America/Sao_Paulo', p_adult: true,
        p_terms_version: 'b2-concurrency', p_privacy_version: 'b2-concurrency', p_marketing: false,
      });
      const trial = await rpc(session, 'start_trial', {});
      assert(['trial', 'pro_active'].includes(trial.data?.status), `Conta ${label} sem TRIAL/PRO`);
    }
  }

  async function setupFixtures() {
    const userA = state.users[0].id;
    const today = new Date().toISOString().slice(0, 10);
    await serviceInsert('local_data_imports', {
      id: FIXTURE.marker, user_id: userA, source_hash: 'd'.repeat(64), source_version: 'b2.1-concurrency', status: 'completed',
      completed_at: new Date().toISOString(), source_snapshot: { fixture: 'pepday-b2.1-real-concurrency',
        package_version: 'v3-automated', run_marker: runMarker, user_a: state.users[0].id, user_b: state.users[1].id },
      verification: { purpose: 'cleanup-provenance' },
    });
    state.markerCreated = true;
    await serviceInsert('vials', [
      { id: FIXTURE.vialRls, user_id: userA, name: 'B2 JWT RLS', initial_mg: 10, remaining_mg: 10, water_ml: 2, prepared_on: today },
      { id: FIXTURE.vialReplay, user_id: userA, name: 'B2 JWT replay undo', initial_mg: 10, remaining_mg: 10, water_ml: 2, prepared_on: today },
    ]);
    await serviceInsert('routines', [
      { id: FIXTURE.routineRls, user_id: userA, vial_id: FIXTURE.vialRls, name: 'B2 JWT RLS', dose_value: 1,
        dose_unit: 'mg', syringe_capacity: 100, frequency: 'daily', start_date: today },
      { id: FIXTURE.routineReplay, user_id: userA, vial_id: FIXTURE.vialReplay, name: 'B2 JWT replay undo', dose_value: 1,
        dose_unit: 'mg', syringe_capacity: 100, frequency: 'daily', start_date: today },
    ]);
    await serviceInsert('routine_versions', [
      [FIXTURE.versionRls, FIXTURE.routineRls, FIXTURE.vialRls, 'B2 JWT RLS'],
      [FIXTURE.versionReplay, FIXTURE.routineReplay, FIXTURE.vialReplay, 'B2 JWT replay undo'],
    ].map(([id, routineId, vialId, name]) => ({ id, user_id: userA, routine_id: routineId, version: 1,
      snapshot: { id: routineId, user_id: userA, vial_id: vialId, name, dose_value: 1, dose_unit: 'mg', syringe_capacity: 100,
        frequency: 'daily', weekdays: [], start_date: today, status: 'active', deleted_at: null } })));
  }

  async function authRls() {
    const [a, b] = state.sessions;
    const today = new Date().toISOString().slice(0, 10);
    const registered = await rpc(a, 'register_application', {
      p_operation_id: FIXTURE.rlsRegister, p_expected_user: a.id, p_routine_id: FIXTURE.routineRls,
      p_routine_version_id: FIXTURE.versionRls, p_vial_id: FIXTURE.vialRls, p_scheduled_date: today, p_applied_at: null,
    });
    assert(registered.data?.replay === false, 'Auth/RLS: registro inicial não retornou replay=false');
    const applicationId = registered.data.application.id;
    const [aVial, bVial, aApp, bApp] = await Promise.all([
      userRows(a, 'vials', `id=eq.${FIXTURE.vialRls}&select=id,remaining_mg`), userRows(b, 'vials', `id=eq.${FIXTURE.vialRls}&select=id,remaining_mg`),
      userRows(a, 'applications', `operation_id=eq.${FIXTURE.rlsRegister}&select=id`), userRows(b, 'applications', `operation_id=eq.${FIXTURE.rlsRegister}&select=id`),
    ]);
    const crossRegister = await rpc(b, 'register_application', {
      p_operation_id: FIXTURE.crossRegister, p_expected_user: b.id, p_routine_id: FIXTURE.routineRls,
      p_routine_version_id: FIXTURE.versionRls, p_vial_id: FIXTURE.vialRls, p_scheduled_date: today, p_applied_at: null,
    }, { allowFailure: true });
    const crossUndo = await rpc(b, 'undo_application', {
      p_undo_operation_id: FIXTURE.crossUndo, p_expected_user: b.id, p_application_id: applicationId, p_undone_at: null,
    }, { allowFailure: true });
    const [finalVial, finalApps, finalMoves] = await Promise.all([
      userRows(a, 'vials', `id=eq.${FIXTURE.vialRls}&select=remaining_mg`),
      userRows(a, 'applications', `operation_id=eq.${FIXTURE.rlsRegister}&select=id`),
      userRows(a, 'vial_movements', `operation_id=eq.${FIXTURE.rlsRegister}&select=id`),
    ]);
    assert(aVial.data.length === 1 && aApp.data.length === 1, 'Auth/RLS: A não lê os próprios dados');
    assert(bVial.data.length === 0 && bApp.data.length === 0, 'Auth/RLS: B leu dados de A');
    assert(!crossRegister.ok && !crossUndo.ok, 'Auth/RLS: mutação cruzada não foi bloqueada');
    assert(Number(finalVial.data[0]?.remaining_mg) === 9 && finalApps.data.length === 1 && finalMoves.data.length === 1,
      'Auth/RLS: tentativa cruzada alterou dados de A');
  }

  async function coordinated(entries) {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const dispatches = new Map();
    const prepared = entries.map(({ name, run }) => (async () => {
      await gate;
      const dispatchedAt = performance.now();
      dispatches.set(name, dispatchedAt);
      const result = await run();
      return { name, dispatchedAt, result };
    })());
    await new Promise(resolve => setImmediate(resolve)); release();
    const settled = await Promise.allSettled(prepared);
    const times = [...dispatches.values()];
    assert(times.length === entries.length, 'Replay/Undo: nem todas as operações foram disparadas');
    const skew = Math.max(...times) - Math.min(...times);
    assert(skew <= MAX_DISPATCH_SKEW_MS, `Replay/Undo: dispatch skew ${skew.toFixed(3)} ms excedeu o limite`);
    const failed = settled.map((item, index) => ({ item, name: entries[index].name }))
      .filter(({ item }) => item.status === 'rejected');
    if (failed.length) {
      const detail = failed.map(({ item, name }) => `${name}: ${item.reason instanceof Error ? item.reason.message : String(item.reason)}`).join(' | ');
      throw new Error(`Replay/Undo: operação concorrente falhou (${detail})`);
    }
    return settled.map(item => item.value);
  }

  async function replayUndo() {
    const a = state.sessions[0];
    const today = new Date().toISOString().slice(0, 10);
    const intent = { p_operation_id: FIXTURE.replayRegister, p_expected_user: a.id, p_routine_id: FIXTURE.routineReplay,
      p_routine_version_id: FIXTURE.versionReplay, p_vial_id: FIXTURE.vialReplay, p_scheduled_date: today, p_applied_at: null };
    const first = await rpc(a, 'register_application', intent);
    assert(first.data?.replay === false, 'Replay/Undo: registro inicial não retornou replay=false');
    const applicationId = first.data.application.id;
    const concurrent = await coordinated([
      { name: 'replay', run: () => rpc(a, 'register_application', intent) },
      { name: 'undo', run: () => rpc(a, 'undo_application', { p_undo_operation_id: FIXTURE.firstUndo,
        p_expected_user: a.id, p_application_id: applicationId, p_undone_at: null }) },
    ]);
    assert(concurrent.find(item => item.name === 'replay').result.data?.replay === true,
      'Replay/Undo: reenvio não retornou replay=true');
    assert(concurrent.find(item => item.name === 'undo').result.data?.replay === false,
      'Replay/Undo: primeiro Undo não retornou replay=false');
    const secondUndo = await rpc(a, 'undo_application', { p_undo_operation_id: FIXTURE.secondUndo,
      p_expected_user: a.id, p_application_id: applicationId, p_undone_at: null }, { allowFailure: true });
    assert(!secondUndo.ok && /já desfeita por outra operação/i.test(secondUndo.data?.message ?? ''),
      'Replay/Undo: segundo Undo com outro UUID não retornou o conflito previsto');
    const [applications, movements, vial] = await Promise.all([
      userRows(a, 'applications', `vial_id=eq.${FIXTURE.vialReplay}&select=id,operation_id,undone_at,undo_operation_id`),
      userRows(a, 'vial_movements', `application_id=eq.${applicationId}&select=kind,delta_mg,balance_before,balance_after`),
      userRows(a, 'vials', `id=eq.${FIXTURE.vialReplay}&select=remaining_mg`),
    ]);
    const applicationMoves = movements.data.filter(item => item.kind === 'application');
    const undoMoves = movements.data.filter(item => item.kind === 'undo');
    assert(applications.data.length === 1 && applications.data[0].undo_operation_id === FIXTURE.firstUndo,
      'Replay/Undo: aplicação duplicada ou Undo divergente');
    assert(movements.data.length === 2 && applicationMoves.length === 1 && undoMoves.length === 1,
      'Replay/Undo: movimento duplicado, segundo desconto ou segundo Undo');
    assert(Number(applicationMoves[0].delta_mg) === -1 && Number(applicationMoves[0].balance_before) === 10
      && Number(applicationMoves[0].balance_after) === 9 && Number(undoMoves[0].delta_mg) === 1
      && Number(undoMoves[0].balance_before) === 9 && Number(undoMoves[0].balance_after) === 10
      && Number(vial.data[0]?.remaining_mg) === 10, 'Replay/Undo: cadeia ou saldo final incorreto');
  }

  async function markerMatches() {
    if (!state.markerCreated || state.users.length !== 2) return false;
    const result = await serviceRows('local_data_imports', `id=eq.${FIXTURE.marker}&user_id=eq.${state.users[0].id}`
      + `&source_hash=eq.${'d'.repeat(64)}&source_version=eq.b2.1-concurrency&select=id,source_snapshot`);
    const marker = result.data?.[0]?.source_snapshot;
    return result.data?.length === 1 && marker?.fixture === 'pepday-b2.1-real-concurrency'
      && marker?.package_version === 'v3-automated' && marker?.run_marker === runMarker
      && marker?.user_a === state.users[0].id && marker?.user_b === state.users[1].id;
  }

  async function authMarkerMatches(user) {
    const result = await admin(`/users/${user.id}`, { allowFailure: true });
    return result.ok && result.data?.email === user.email && result.data?.user_metadata?.pepday_b2_run_marker === runMarker;
  }

  async function cleanup() {
    const domainMatches = await markerMatches();
    const authMatches = await Promise.all(state.users.map(authMarkerMatches));
    assert(authMatches.every(Boolean), 'CLEANUP RECUSADO: run_marker Auth ausente ou divergente');
    if (state.markerCreated) assert(domainMatches, 'CLEANUP RECUSADO: marcador de domínio ausente ou divergente');
    const failures = [];
    for (const user of [...state.users].reverse()) {
      // O endpoint Admin usa hard-delete por padrão; não enviar soft-delete.
      try { await admin(`/users/${user.id}`, { method: 'DELETE' }); }
      catch (error) { failures.push(error); }
    }
    if (failures.length) throw new Error(`${failures.length} conta(s) Auth não puderam ser removidas`);
  }

  async function discoverOwnedAccounts() {
    try {
      const users = await listAllUsers();
      for (const user of users) {
        if ([AUTH_EMAIL_A, AUTH_EMAIL_B].includes(user.email)
          && user.user_metadata?.pepday_b2_run_marker === runMarker
          && !state.users.some(saved => saved.id === user.id)) state.users.push({ id: user.id, email: user.email });
      }
    } catch { /* uma falha de rede pode impedir a recuperação; o resultado final continuará FAIL */ }
  }

  async function verifyCleanup() {
    const ids = state.users.map(user => user.id);
    if (!ids.length) return;
    const idFilter = `in.(${ids.join(',')})`;
    const publicCounts = await Promise.all(PUBLIC_TABLES.map(([table, column, selectColumn]) =>
      count(table, `${column}=${idFilter}`, selectColumn)));
    assert(publicCounts.every(value => value === 0), 'Cleanup deixou vestígio em tabela de domínio');
    const authChecks = await Promise.all(state.users.map(user => admin(`/users/${user.id}`, { allowFailure: true })));
    assert(authChecks.every(result => result.status === 404), 'Cleanup deixou usuário em auth.users');
    for (const table of ['identities', 'sessions', 'refresh_tokens']) {
      const internal = await http(`/rest/v1/${table}?user_id=${idFilter}&select=user_id`, {
        key: serviceKey, profile: 'auth', allowFailure: true,
      });
      if (internal.ok) assert(Array.isArray(internal.data) && internal.data.length === 0,
        `Cleanup deixou vestígio em auth.${table}`);
      else assert([404, 406].includes(internal.status), `Não foi possível validar auth.${table} com segurança`);
    }
    for (const session of state.sessions) {
      const oldAccess = await http('/auth/v1/user', { token: session.access_token, allowFailure: true });
      const oldRefresh = await http('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: { refresh_token: session.refresh_token }, allowFailure: true,
      });
      assert(!oldAccess.ok && !oldRefresh.ok, 'Cleanup deixou sessão ou refresh token utilizável');
    }
  }

  async function run() {
    let failure = null;
    let cleanupFailure = null;
    try {
      await preflight();
      await createAccount(AUTH_EMAIL_A, 'A'); await createAccount(AUTH_EMAIL_B, 'B');
      await prepare(); await setupFixtures(); await authRls(); await replayUndo();
    } catch (error) { failure = error; }
    finally {
      await discoverOwnedAccounts();
      if (state.users.length) {
        try { await cleanup(); await verifyCleanup(); } catch (error) { cleanupFailure = error; }
      }
    }
    if (failure || cleanupFailure) {
      const reasons = [failure, cleanupFailure && new Error(`cleanup: ${cleanupFailure.message}`)].filter(Boolean)
        .map(error => safeReason(error, secrets));
      return { ok: false, result: `FAIL FINAL — ${reasons.join(' | ')}` };
    }
    return { ok: true, result: 'PASS FINAL — AUTH/RLS + REPLAY/UNDO' };
  }

  return { run, _test: { preflight, createAccount, prepare, setupFixtures, authRls, replayUndo,
    coordinated, cleanup, verifyCleanup, state, runMarker } };
}

export async function main(options) {
  let output;
  try { output = await createB2Automation(options).run(); }
  catch (error) {
    const env = options?.env ?? process.env;
    output = { ok: false, result: `FAIL FINAL — ${safeReason(error,
      [env.SUPABASE_ANON_KEY, env.SUPABASE_SERVICE_ROLE_KEY])}` };
  }
  console.log(output.result);
  return output.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
