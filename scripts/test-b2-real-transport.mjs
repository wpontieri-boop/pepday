// B2.1: transporte JWT/RLS e replay concorrente. Executar só em pepday-v3-test.
// Nenhum token, senha ou header é impresso ou persistido.
const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'PEPDAY_B2_JWT_A', 'PEPDAY_B2_JWT_B'];
for (const key of required) if (!process.env[key]) throw new Error(`Variável obrigatória ausente: ${key}`);

const baseUrl = process.env.SUPABASE_URL.replace(/\/$/, '');
const anonKey = process.env.SUPABASE_ANON_KEY;
const tokenA = process.env.PEPDAY_B2_JWT_A;
const tokenB = process.env.PEPDAY_B2_JWT_B;
if (baseUrl !== 'https://fsbqpyyprtymwrmzsacp.supabase.co') {
  throw new Error('SUPABASE_URL não corresponde ao pepday-v3-test autorizado');
}

function payload(token) {
  const part = token.split('.')[1];
  if (!part) throw new Error('JWT inválido');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}
const accountA = payload(tokenA);
const accountB = payload(tokenB);
if (accountA.sub === accountB.sub) throw new Error('Os JWTs pertencem à mesma conta');
if (accountA.iss !== `${baseUrl}/auth/v1` || accountB.iss !== `${baseUrl}/auth/v1`) {
  throw new Error('JWTs não foram emitidos pelo pepday-v3-test');
}
if (accountA.exp * 1000 <= Date.now() || accountB.exp * 1000 <= Date.now()) throw new Error('JWT expirado');
if (accountA.email !== 'pepday-b2-jwt-a@example.invalid' || accountB.email !== 'pepday-b2-jwt-b@example.invalid') {
  throw new Error('JWTs não pertencem aos e-mails fixtures reservados');
}

async function request(token, path, { method = 'GET', body, allowFailure = false } = {}) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text.slice(0, 300) }; }
  const result = { ok: response.ok, status: response.status, duration_ms: Math.round(performance.now() - started), data };
  if (!response.ok && !allowFailure) throw new Error(`HTTP ${response.status}: ${data?.message ?? 'erro sem mensagem'}`);
  return result;
}
const rpc = (token, name, body, options) => request(token, `/rest/v1/rpc/${name}`, { method: 'POST', body, ...options });
const rows = (token, table, query) => request(token, `/rest/v1/${table}?${query}`);
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function prepare() {
  for (const [token, label] of [[tokenA, 'A'], [tokenB, 'B']]) {
    await rpc(token, 'complete_onboarding', {
      p_name: `B2 JWT ${label}`, p_country: 'BR', p_timezone: 'America/Sao_Paulo',
      p_adult: true, p_terms_version: 'b2-concurrency', p_privacy_version: 'b2-concurrency', p_marketing: false,
    });
    const trial = await rpc(token, 'start_trial', {});
    assert(['trial', 'pro_active'].includes(trial.data?.status), `Conta ${label} sem TRIAL/PRO`);
  }
  console.log(JSON.stringify({ resultado: 'PASS — CONTAS JWT PREPARADAS', user_a: accountA.sub, user_b: accountB.sub }));
}

async function authRls() {
  const registerA = await rpc(tokenA, 'register_application', {
    p_operation_id: 'b2640000-0000-4000-8000-000000000001', p_expected_user: accountA.sub,
    p_routine_id: 'd2640000-0000-4000-8000-000000000004', p_routine_version_id: 'c2640000-0000-4000-8000-000000000004',
    p_vial_id: 'e2640000-0000-4000-8000-000000000004', p_scheduled_date: new Date().toISOString().slice(0, 10), p_applied_at: null,
  });
  const applicationId = registerA.data.application.id;
  const [aVial, bVial, aApp, bApp] = await Promise.all([
    rows(tokenA, 'vials', 'id=eq.e2640000-0000-4000-8000-000000000004&select=id,remaining_mg'),
    rows(tokenB, 'vials', 'id=eq.e2640000-0000-4000-8000-000000000004&select=id,remaining_mg'),
    rows(tokenA, 'applications', 'operation_id=eq.b2640000-0000-4000-8000-000000000001&select=id'),
    rows(tokenB, 'applications', 'operation_id=eq.b2640000-0000-4000-8000-000000000001&select=id'),
  ]);
  const crossRegister = await rpc(tokenB, 'register_application', {
    p_operation_id: 'b2640000-0000-4000-8000-000000000002', p_expected_user: accountB.sub,
    p_routine_id: 'd2640000-0000-4000-8000-000000000004', p_routine_version_id: 'c2640000-0000-4000-8000-000000000004',
    p_vial_id: 'e2640000-0000-4000-8000-000000000004', p_scheduled_date: new Date().toISOString().slice(0, 10), p_applied_at: null,
  }, { allowFailure: true });
  const crossUndo = await rpc(tokenB, 'undo_application', {
    p_undo_operation_id: 'b2640000-0000-4000-8000-000000000003', p_expected_user: accountB.sub,
    p_application_id: applicationId, p_undone_at: null,
  }, { allowFailure: true });
  const [finalVial, finalApps, finalMoves] = await Promise.all([
    rows(tokenA, 'vials', 'id=eq.e2640000-0000-4000-8000-000000000004&select=remaining_mg'),
    rows(tokenA, 'applications', 'operation_id=eq.b2640000-0000-4000-8000-000000000001&select=id'),
    rows(tokenA, 'vial_movements', 'operation_id=eq.b2640000-0000-4000-8000-000000000001&select=id'),
  ]);
  assert(aVial.data.length === 1 && aApp.data.length === 1, 'A não lê os próprios dados');
  assert(bVial.data.length === 0 && bApp.data.length === 0, 'RLS expôs dados de A para B');
  assert(!crossRegister.ok && !crossUndo.ok, 'RPC cruzada não foi bloqueada');
  assert(Number(finalVial.data[0].remaining_mg) === 9 && finalApps.data.length === 1 && finalMoves.data.length === 1,
    'Tentativa cruzada alterou saldo ou cardinalidade de A');
  console.log(JSON.stringify({ resultado: 'PASS — AUTH/RLS REAL', cross_register_http: crossRegister.status, cross_undo_http: crossUndo.status }));
}

async function replayUndo() {
  const intent = {
    p_operation_id: 'b2650000-0000-4000-8000-000000000001', p_expected_user: accountA.sub,
    p_routine_id: 'd2650000-0000-4000-8000-000000000005', p_routine_version_id: 'c2650000-0000-4000-8000-000000000005',
    p_vial_id: 'e2650000-0000-4000-8000-000000000005', p_scheduled_date: new Date().toISOString().slice(0, 10), p_applied_at: null,
  };
  const first = await rpc(tokenA, 'register_application', intent);
  const applicationId = first.data.application.id;
  const [replay, undo] = await Promise.all([
    rpc(tokenA, 'register_application', intent),
    rpc(tokenA, 'undo_application', { p_undo_operation_id: 'b2650000-0000-4000-8000-000000000002', p_expected_user: accountA.sub, p_application_id: applicationId, p_undone_at: null }),
  ]);
  const [applications, movements, vial] = await Promise.all([
    rows(tokenA, 'applications', 'operation_id=eq.b2650000-0000-4000-8000-000000000001&select=id,undone_at,undo_operation_id'),
    rows(tokenA, 'vial_movements', `application_id=eq.${applicationId}&select=kind,delta_mg,balance_before,balance_after`),
    rows(tokenA, 'vials', 'id=eq.e2650000-0000-4000-8000-000000000005&select=remaining_mg'),
  ]);
  const applicationMoves = movements.data.filter(item => item.kind === 'application');
  const undoMoves = movements.data.filter(item => item.kind === 'undo');
  assert(replay.ok && undo.ok, 'Replay ou Undo concorrente falhou');
  assert(applications.data.length === 1 && applications.data[0].undone_at && applications.data[0].undo_operation_id === 'b2650000-0000-4000-8000-000000000002', 'Aplicação final não está desfeita exatamente uma vez');
  assert(applicationMoves.length === 1 && undoMoves.length === 1 && Number(vial.data[0].remaining_mg) === 10, 'Movimentos ou saldo final divergentes');
  console.log(JSON.stringify({ resultado: 'PASS — REPLAY CONCORRENTE + UNDO', replay_ms: replay.duration_ms, undo_ms: undo.duration_ms }));
}

const command = process.argv[2];
if (command === 'prepare') await prepare();
else if (command === 'auth-rls') await authRls();
else if (command === 'replay-undo') await replayUndo();
else throw new Error('Uso: node scripts/test-b2-real-transport.mjs prepare|auth-rls|replay-undo');
