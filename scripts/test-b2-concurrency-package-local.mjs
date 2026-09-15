// Valida localmente o pacote de concorrência. Nunca abre rede nem Supabase real.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
if (!process.env.PGLITE_MODULE) throw new Error('Defina PGLITE_MODULE para o dist/index.js do PGlite 0.5.8 local.');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const root = new URL('../', import.meta.url);
const dir = 'supabase/tests/block_b2_real_concurrency/';
const read = file => readFile(new URL(file, root), 'utf8');
const migrations = [
  'supabase/migrations/202609090001_block_a.sql',
  'supabase/migrations/202609100002_complete_legacy_import.sql',
  'supabase/migrations/202609110003_block_b1_entitlements.sql',
  'supabase/migrations/202609140004_block_b2_transactional_applications.sql',
];
const shorten = sql => sql.replace(
  /select pg_sleep\(case when current_setting\('pepday\.b2\.outcome'\)='PASS' then 20 else 0 end\);/g,
  'select pg_sleep(0);',
);
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb not null default '{}');
    create table auth.identities(user_id uuid references auth.users(id) on delete cascade);
    create table auth.sessions(user_id uuid references auth.users(id) on delete cascade);
    create table auth.refresh_tokens(user_id uuid references auth.users(id) on delete cascade);
    create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;`);
  for (const file of migrations) await db.exec(await read(file));
  return db;
}

async function setup(db) { await db.exec(await read(dir + '00_setup_sql.sql')); }
async function run(db, file) { await db.exec(shorten(await read(dir + file))); }
async function result(db, scenario) {
  const rows = (await db.query(await read(dir + '90_verify_sql.sql'))).rows;
  return rows.find(row => row.cenario.startsWith(`${scenario} `))?.resultado;
}

async function isolated(name, test) {
  const db = await database();
  try { await test(db); console.log(`PASS LOCAL — ${name}`); }
  finally { await db.close(); }
}

await isolated('A e B sequenciais resultam FAIL', async db => {
  await setup(db);
  for (const [a, b] of [
    ['01_same_vial_session_a.sql','01_same_vial_session_b.sql'],
    ['02_for_update_session_a.sql','02_for_update_session_b.sql'],
    ['03_same_routine_date_session_a.sql','03_same_routine_date_session_b.sql'],
  ]) { await run(db, a); await run(db, b); }
  for (const scenario of [1, 2, 3]) assert(await result(db, scenario) === 'FAIL', `Cenário ${scenario} sequencial produziu PASS`);
});

await isolated('somente A resulta FAIL', async db => {
  await setup(db);
  for (const file of ['01_same_vial_session_a.sql','02_for_update_session_a.sql','03_same_routine_date_session_a.sql']) await run(db, file);
  for (const scenario of [1, 2, 3]) assert(await result(db, scenario) === 'FAIL', `Cenário ${scenario} sem B produziu PASS`);
});

await isolated('somente B resulta FAIL', async db => {
  await setup(db);
  for (const file of ['01_same_vial_session_b.sql','02_for_update_session_b.sql','03_same_routine_date_session_b.sql']) await run(db, file);
  for (const scenario of [1, 2, 3]) assert(await result(db, scenario) === 'FAIL', `Cenário ${scenario} sem A produziu PASS`);
});

await isolated('B vencedor indevido resulta FAIL', async db => {
  await setup(db);
  await run(db, '03_same_routine_date_session_b.sql');
  await run(db, '03_same_routine_date_session_a.sql');
  assert(await result(db, 3) === 'FAIL', 'Vencedor B indevido produziu PASS');
  const operations = await db.query(`select operation_id from public.applications
    where vial_id='e2630000-0000-4000-8000-000000000003'`);
  assert(operations.rows.length === 1 && operations.rows[0].operation_id === 'b2630000-0000-4000-8000-000000000002',
    'Fixture negativa não reproduziu vitória de B');
});

await isolated('evidências A/B corretas resultam PASS e cleanup zera', async db => {
  await setup(db);
  for (const file of [
    '01_same_vial_session_a.sql','01_same_vial_session_b.sql',
    '02_for_update_session_a.sql','02_for_update_session_b.sql',
    '03_same_routine_date_session_a.sql','03_same_routine_date_session_b.sql',
  ]) await run(db, file);
  await db.exec(`update public.audit_logs set
    action=case operation_id
      when 'b1610000-0000-4000-8000-000000000002' then 'b2c_s1_b_finished_pass'
      when 'b1620000-0000-4000-8000-000000000002' then 'b2c_s2_b_finished_pass'
      when 'b1630000-0000-4000-8000-000000000002' then 'b2c_s3_b_finished_blocked_pass'
      else action end,
    created_at=timestamp with time zone '2026-09-15 12:00:00+00'+case
      when operation_id::text like 'a16%0001' then interval '0 seconds'
      when operation_id::text like 'b16%0001' then interval '2 seconds'
      when operation_id::text like 'a16%0002' then interval '20 seconds'
      when operation_id::text like 'b16%0002' then interval '20.1 seconds' end
    where user_id='f2600000-0000-4000-8000-000000000001'
      and operation_id::text ~ '^[ab]16[123]';`);
  const rows = (await db.query(await read(dir + '90_verify_sql.sql'))).rows;
  assert(rows.length === 3 && rows.every(row => row.resultado === 'PASS'), `Caminho positivo falhou: ${JSON.stringify(rows)}`);
  await db.exec(await read(dir + '99_cleanup_sql.sql'));
  const remaining = await db.query(`select count(*)::int n from auth.users where id='f2600000-0000-4000-8000-000000000001'`);
  assert(remaining.rows[0].n === 0, 'Cleanup positivo deixou fixture');
});

await isolated('cleanup sem marcador é recusado', async db => {
  await db.exec(`insert into auth.users(id,email) values
    ('f2600000-0000-4000-8000-000000000001','pepday-b2-sql-concurrency@example.invalid')`);
  let refused = false;
  try { await db.exec(await read(dir + '99_cleanup_sql.sql')); } catch { refused = true; }
  const remaining = await db.query(`select count(*)::int n from auth.users where id='f2600000-0000-4000-8000-000000000001'`);
  assert(refused && remaining.rows[0].n === 1, 'Cleanup sem marcador não preservou a conta coincidente');
});

await isolated('cleanup JWT sem marcador é recusado', async db => {
  await db.exec(`insert into auth.users(id,email) values
    ('fa640000-0000-4000-8000-000000000004','pepday-b2-jwt-a@example.invalid'),
    ('fb650000-0000-4000-8000-000000000005','pepday-b2-jwt-b@example.invalid')`);
  const cleanup = (await read(dir + '99_cleanup_jwt.template.sql'))
    .replaceAll('REPLACE_WITH_USER_A_UUID','fa640000-0000-4000-8000-000000000004')
    .replaceAll('REPLACE_WITH_USER_B_UUID','fb650000-0000-4000-8000-000000000005')
    .replaceAll('REPLACE_WITH_RUN_MARKER_UUID','92640000-0000-4000-8000-000000000001');
  let refused = false;
  try { await db.exec(cleanup); } catch { refused = true; }
  const remaining = await db.query(`select count(*)::int n from auth.users where id in
    ('fa640000-0000-4000-8000-000000000004','fb650000-0000-4000-8000-000000000005')`);
  assert(refused && remaining.rows[0].n === 2, 'Cleanup JWT sem marcador não preservou contas coincidentes');
});

await isolated('segundo Undo com UUID diferente é bloqueado', async db => {
  await db.exec(await read(dir + '04_05_jwt_preflight.sql'));
  await db.exec(`insert into auth.users(id,email,raw_user_meta_data) values
    ('fa640000-0000-4000-8000-000000000004','pepday-b2-jwt-a@example.invalid','{"pepday_b2_run_marker":"92640000-0000-4000-8000-000000000001"}'),
    ('fb650000-0000-4000-8000-000000000005','pepday-b2-jwt-b@example.invalid','{"pepday_b2_run_marker":"92640000-0000-4000-8000-000000000001"}');
    insert into auth.identities values ('fa640000-0000-4000-8000-000000000004'),('fb650000-0000-4000-8000-000000000005');
    insert into auth.sessions values ('fa640000-0000-4000-8000-000000000004'),('fb650000-0000-4000-8000-000000000005');
    insert into auth.refresh_tokens values ('fa640000-0000-4000-8000-000000000004'),('fb650000-0000-4000-8000-000000000005');
    set role authenticated;
    select set_config('request.jwt.claim.sub','fa640000-0000-4000-8000-000000000004',false);
    select public.complete_onboarding('JWT A','BR','America/Sao_Paulo',true,'b2','b2',false); select public.start_trial();
    select set_config('request.jwt.claim.sub','fb650000-0000-4000-8000-000000000005',false);
    select public.complete_onboarding('JWT B','BR','America/Sao_Paulo',true,'b2','b2',false); select public.start_trial(); reset role;`);
  const replaceUsers = sql => sql
    .replaceAll('REPLACE_WITH_USER_A_UUID','fa640000-0000-4000-8000-000000000004')
    .replaceAll('REPLACE_WITH_USER_B_UUID','fb650000-0000-4000-8000-000000000005')
    .replaceAll('REPLACE_WITH_RUN_MARKER_UUID','92640000-0000-4000-8000-000000000001');
  await db.exec(replaceUsers(await read(dir + '04_05_jwt_setup.template.sql')));
  await db.exec(`set role authenticated;
    select set_config('request.jwt.claim.sub','fa640000-0000-4000-8000-000000000004',false);`);
  const registered = await db.query(`select public.register_application(
    'b2650000-0000-4000-8000-000000000001',auth.uid(),
    'd2650000-0000-4000-8000-000000000005','c2650000-0000-4000-8000-000000000005',
    'e2650000-0000-4000-8000-000000000005',current_date,null) result`);
  const applicationId = registered.rows[0].result.application.id;
  await db.query(`select public.undo_application(
    'b2650000-0000-4000-8000-000000000002',auth.uid(),'${applicationId}',null)`);
  let blocked = false;
  try {
    await db.query(`select public.undo_application(
      'b2650000-0000-4000-8000-000000000003',auth.uid(),'${applicationId}',null)`);
  } catch (error) { blocked = /já desfeita por outra operação/i.test(error.message); }
  await db.exec('reset role;');
  const final = await db.query(`select
    (select remaining_mg from public.vials where id='e2650000-0000-4000-8000-000000000005') saldo,
    (select count(*)::int from public.applications where vial_id='e2650000-0000-4000-8000-000000000005') aplicacoes,
    (select count(*)::int from public.vial_movements where vial_id='e2650000-0000-4000-8000-000000000005') movimentos`);
  assert(blocked && Number(final.rows[0].saldo) === 10 && final.rows[0].aplicacoes === 1 && final.rows[0].movimentos === 2,
    'Segundo Undo alterou cardinalidade ou saldo');
  await db.exec(replaceUsers(await read(dir + '99_cleanup_jwt.template.sql')));
  const authRemaining = await db.query(`select
    (select count(*) from auth.users where id in ('fa640000-0000-4000-8000-000000000004','fb650000-0000-4000-8000-000000000005'))+
    (select count(*) from auth.identities where user_id in ('fa640000-0000-4000-8000-000000000004','fb650000-0000-4000-8000-000000000005'))+
    (select count(*) from auth.sessions where user_id in ('fa640000-0000-4000-8000-000000000004','fb650000-0000-4000-8000-000000000005'))+
    (select count(*) from auth.refresh_tokens where user_id in ('fa640000-0000-4000-8000-000000000004','fb650000-0000-4000-8000-000000000005')) n`);
  assert(Number(authRemaining.rows[0].n) === 0, 'Cleanup JWT deixou vestígio interno de Auth');
});
