// Runner único da validação PostgreSQL real B2.2-D1. Não usa HTTP nem service_role.
// SUPABASE_DB_URL deve ser fornecida somente pelo ambiente e nunca é impressa.
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generatePackage } from './prepare-b22d1-real-validation.mjs';

const PROJECT_REF = 'fsbqpyyprtymwrmzsacp';
const OLD_RUN_MARKER = '72ed54ae-4295-454e-8597-a21d1c505691';
const PASS = 'PASS FINAL — B2.2-D1 REAL CONCURRENCY';
const DEFAULT_TIMEOUTS = Object.freeze({ connectMs: 20000, queryMs: 45000, closeMs: 5000 });

export function validateDatabaseUrl(value) {
  if (!value) throw new Error('SUPABASE_DB_URL ausente.');
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('SUPABASE_DB_URL inválida.'); }
  if (!['postgres:','postgresql:'].includes(parsed.protocol)) throw new Error('SUPABASE_DB_URL inválida.');
  const direct = parsed.hostname === `db.${PROJECT_REF}.supabase.co`;
  const pooler = parsed.hostname.endsWith('.pooler.supabase.com')
    && (parsed.username === `postgres.${PROJECT_REF}` || parsed.searchParams.get('options')?.includes(PROJECT_REF));
  if (!direct && !pooler) throw new Error('SUPABASE_DB_URL não pertence ao pepday-v3-test.');
  if (!parsed.password) throw new Error('SUPABASE_DB_URL sem credencial de banco.');
  return value;
}

export function sanitizeError(error) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[CONNECTION_REDACTED]')
    .replace(/(password|token|secret|apikey|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/[\r\n]+/g, ' ').slice(0, 500);
}

export function withTimeout(promise, timeoutMs, label, onTimeout = () => {}) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      try { onTimeout(); } catch { /* timeout continua sendo a causa */ }
      reject(new Error(`Timeout em ${label}.`));
    }, timeoutMs);
    Promise.resolve(promise).then(value => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(value);
    }, error => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function runOverlapped(sessionA, sessionB, sqlA, sqlB, delayMs = 1000) {
  const settle = promise => Promise.resolve(promise).then(
    value => ({ status: 'fulfilled', value }),
    reason => ({ status: 'rejected', reason }),
  );
  // Registra o rejection handler antes da janela de disparo de B.
  const a = settle(sessionA.query(sqlA));
  await new Promise(resolve => setTimeout(resolve, delayMs));
  const b = settle(sessionB.query(sqlB));
  const settled = await Promise.all([a, b]);
  const rejected = settled.find(result => result.status === 'rejected');
  if (rejected) throw rejected.reason;
  return settled.map(result => result.value);
}

function terminateSocket(client) {
  try { client?.connection?.stream?.destroy(); } catch { /* já encerrado */ }
}

async function rollbackQuietly(db, state, timeoutMs) {
  if (!state.connected || state.broken) return;
  try { await db.query('rollback', undefined, 'rollback', timeoutMs); }
  catch { /* conexão encerrada ou transação já inválida */ }
}

function resultRows(result) {
  return (Array.isArray(result) ? result : [result]).flatMap(item => item?.rows ?? []);
}

async function inspectAndRecoverOldRun(admin, marker = OLD_RUN_MARKER) {
  const markerRows = await admin.query(`select i.id,i.user_id,i.source_hash,i.source_snapshot,u.email,
      u.raw_user_meta_data from public.local_data_imports i
    left join auth.users u on u.id=i.user_id
    where i.source_snapshot->>'run_marker'=$1`, [marker]);
  const authRows = await admin.query(`select id,email,raw_user_meta_data from auth.users
    where raw_user_meta_data->>'pepday_b22d1_run_marker'=$1`, [marker]);
  if (markerRows.rowCount === 0 && authRows.rowCount === 0) return { status: 'clean' };
  if (markerRows.rowCount !== 1 || authRows.rowCount !== 1) {
    throw new Error('Run anterior possui resíduo sem procedência unívoca; cleanup automático recusado.');
  }
  const row = markerRows.rows[0];
  const auth = authRows.rows[0];
  const ids = row.source_snapshot?.fixture_ids;
  if (row.source_snapshot?.fixture !== 'pepday-b22d1-real-concurrency'
    || row.source_snapshot?.run_marker !== marker
    || ids?.user_id !== String(row.user_id)
    || String(auth.id) !== String(row.user_id)
    || auth.raw_user_meta_data?.pepday_b22d1_run_marker !== marker
    || auth.email !== row.email) {
    throw new Error('Run anterior não passou nas guardas de procedência; cleanup automático recusado.');
  }
  const unexpected = await admin.query(`select
    (select count(*) from public.vials where user_id=$1 and id<>$2)+
    (select count(*) from public.domain_mutation_operations where user_id=$1
      and operation_id<>all($3::uuid[]))+
    (select count(*) from public.routines where user_id=$1)+
    (select count(*) from public.routine_versions where user_id=$1)+
    (select count(*) from public.applications where user_id=$1)+
    (select count(*) from public.vial_movements where user_id=$1) n`,
  [row.user_id, ids.vial_id, [ids.create_op_a, ids.create_op_b, ids.update_op_a, ids.delete_op_b]]);
  if (Number(unexpected.rows[0].n) !== 0) {
    throw new Error('Run anterior contém dados inesperados; cleanup automático recusado.');
  }
  await admin.query('begin');
  try {
    const deleted = await admin.query(`delete from auth.users where id=$1 and email=$2
      and raw_user_meta_data->>'pepday_b22d1_run_marker'=$3 returning id`,
    [row.user_id, auth.email, marker]);
    if (deleted.rowCount !== 1) throw new Error('Conta do run anterior não foi removida exatamente uma vez.');
    await admin.query('commit');
  } catch (error) {
    try { await admin.query('rollback'); } catch { /* preserva erro original */ }
    throw error;
  }
  return { status: 'cleaned' };
}

async function verifyOldRunGone(admin, marker = OLD_RUN_MARKER) {
  const result = await admin.query(`select
    (select count(*) from public.local_data_imports where source_snapshot->>'run_marker'=$1)+
    (select count(*) from auth.users where raw_user_meta_data->>'pepday_b22d1_run_marker'=$1) n`, [marker]);
  if (Number(result.rows[0].n) !== 0) throw new Error('Run anterior ainda possui fixtures identificáveis.');
}

export async function executeRealValidation({ Client, connectionString, delayMs = 1000,
  timeouts = DEFAULT_TIMEOUTS } = {}) {
  validateDatabaseUrl(connectionString);
  const generated = await generatePackage();
  const read = file => readFile(join(generated.outputDir, file), 'utf8');
  const common = { connectionString, ssl: { rejectUnauthorized: false }, application_name: 'pepday-b22d1-real' };
  const admin = new Client(common);
  const sessionA = new Client({ ...common, application_name: 'pepday-b22d1-session-a' });
  const sessionB = new Client({ ...common, application_name: 'pepday-b22d1-session-b' });
  const states = [admin, sessionA, sessionB].map(client => ({ client, connected: false, broken: false }));
  for (const state of states) state.client.on?.('error', () => { state.broken = true; });
  const dbFor = (state, label) => ({
    query(sql, params, operation = label, timeoutMs = timeouts.queryMs) {
      if (!state.connected || state.broken) return Promise.reject(new Error(`Conexão ${label} indisponível.`));
      return withTimeout(state.client.query(sql, params), timeoutMs, operation,
        () => { state.broken = true; terminateSocket(state.client); });
    },
  });
  const [adminDb, sessionADb, sessionBDb] = states.map((state, index) =>
    dbFor(state, ['admin','A','B'][index]));
  let mainError = null;
  let cleanupError = null;
  try {
    const connections = await Promise.all(states.map((state, index) =>
      withTimeout(state.client.connect(), timeouts.connectMs, `conexão ${['admin','A','B'][index]}`,
        () => { state.broken = true; terminateSocket(state.client); })
        .then(() => { state.connected = true; return state; }, error => { state.broken = true; throw error; }))
      .map(promise => Promise.resolve(promise).then(value => ({ status: 'fulfilled', value }),
        reason => ({ status: 'rejected', reason }))));
    const failedConnection = connections.find(result => result.status === 'rejected');
    if (failedConnection) throw failedConnection.reason;
    await inspectAndRecoverOldRun(adminDb);
    await verifyOldRunGone(adminDb);
    await adminDb.query(await read('00_preflight.sql'), undefined, 'preflight');
    await adminDb.query(await read('10_prepare.sql'), undefined, 'prepare');
    await runOverlapped(sessionADb, sessionBDb,
      await read('20_create_session_a.sql'), await read('21_create_session_b.sql'), delayMs);
    await runOverlapped(sessionADb, sessionBDb,
      await read('30_update_delete_session_a.sql'), await read('31_update_delete_session_b.sql'), delayMs);
    const verified = resultRows(await adminDb.query(await read('90_verify.sql'), undefined, 'verificação'));
    if (!verified.some(row => String(row.veredito ?? '').startsWith('PASS — lock real observado'))) {
      throw new Error('90_verify não retornou o veredito esperado.');
    }
  } catch (error) {
    mainError = error;
  } finally {
    await Promise.all(states.map((state, index) => rollbackQuietly(
      [adminDb, sessionADb, sessionBDb][index], state, Math.min(timeouts.queryMs, 5000))));
    try {
      const marker = await adminDb.query(`select count(*)::int n from public.local_data_imports
        where id=$1 and user_id=$2 and source_hash=$3
          and source_snapshot->>'run_marker'=$4`, [generated.values.MARKER_ID,
        generated.values.USER_ID, generated.values.SOURCE_HASH, generated.values.RUN_MARKER],
      'localização da fixture para cleanup');
      if (Number(marker.rows[0].n) === 1) {
        const cleaned = resultRows(await adminDb.query(await read('99_cleanup.sql'), undefined, 'cleanup'));
        if (!cleaned.some(row => Number(row.total_fixtures) === 0
          && String(row.resultado ?? '').startsWith('PASS — cleanup'))) {
          throw new Error('Cleanup não confirmou zero fixtures.');
        }
      }
    } catch (error) { cleanupError = error; }
    await Promise.all(states.map(state => withTimeout(state.client.end(), timeouts.closeMs,
      'encerramento de conexão', () => terminateSocket(state.client)).catch(() => undefined)));
    await rm(generated.outputDir, { recursive: true, force: true });
  }
  if (mainError || cleanupError) {
    const parts = [];
    if (mainError) parts.push(`falha principal: ${sanitizeError(mainError)}`);
    if (cleanupError) parts.push(`falha de cleanup: ${sanitizeError(cleanupError)}`);
    throw new Error(parts.join('; '));
  }
  return PASS;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  let final;
  try {
    const connectionString = validateDatabaseUrl(process.env.SUPABASE_DB_URL);
    const { Client } = await import('pg');
    final = await executeRealValidation({ Client, connectionString });
  } catch (error) {
    final = `FAIL FINAL — ${sanitizeError(error)}`;
    process.exitCode = 1;
  }
  console.log(final);
}
