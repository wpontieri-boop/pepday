// Executa B2.2-D2-A em PostgreSQL efêmero; nunca conecta ao Supabase.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

if (!process.env.PGLITE_MODULE) throw new Error('Defina PGLITE_MODULE para o dist/index.js do PGlite 0.5.8 local.');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const root = new URL('../', import.meta.url);
const migrationFiles = [
  'supabase/migrations/202609090001_block_a.sql',
  'supabase/migrations/202609100002_complete_legacy_import.sql',
  'supabase/migrations/202609110003_block_b1_entitlements.sql',
  'supabase/migrations/202609140004_block_b2_transactional_applications.sql',
  'supabase/migrations/202609150005_block_b2_validation_service_role.sql',
  'supabase/migrations/202609160006_block_b22d1_versioned_vials.sql',
];
const d2File = 'supabase/migrations/20260925195332_block_b22d2a_routine_schema_invariants.sql';
const read = file => readFile(new URL(file, root), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function openBase() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;`);
  for (const file of migrationFiles) await db.exec(await read(file));
  return db;
}

async function expectMigrationFailure(label, fixtureSql, expected) {
  const db = await openBase();
  try {
    await db.exec(fixtureSql);
    let failure;
    try { await db.exec(await read(d2File)); }
    catch (error) { failure = error; }
    assert(failure && expected.test(`${failure.message} ${failure.detail ?? ''}`), `${label}: diagnóstico inesperado.`);
    await db.exec('rollback');
    const helper = await db.query(`select to_regprocedure('public.pepday_routine_snapshot(public.routines)') is null rolled_back`);
    assert(helper.rows[0].rolled_back === true, `${label}: migration rejeitada deixou DDL parcial.`);
  } finally { await db.close(); }
}

const user = 'd2a00000-0000-4000-8000-000000000001';
const vial = 'd2a00000-0000-4000-8000-000000000002';
const routine = 'd2a00000-0000-4000-8000-000000000003';
const version = 'd2a00000-0000-4000-8000-000000000004';
const baseFixture = `insert into auth.users(id,email) values('${user}','d2a@example.invalid');
  insert into public.vials(id,user_id,name,initial_mg,remaining_mg,water_ml,prepared_on)
  values('${vial}','${user}','D2-A',10,10,2,date '2026-09-25');
  insert into public.routines(id,user_id,vial_id,name,dose_value,dose_unit,syringe_capacity,
    frequency,weekdays,start_date,version)
  values('${routine}','${user}','${vial}','Rotina D2-A',1,'mg',100,'weekdays',array[5,1,5,3],date '2026-09-25',1);`;

let db = await openBase();
try {
  await db.exec(`${baseFixture}
    insert into public.routine_versions(id,user_id,routine_id,version,snapshot)
    select '${version}',user_id,id,version,to_jsonb(r) from public.routines r where id='${routine}';
    insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
      mutation_type,intent_fingerprint,outcome,result)
    values('${user}','d2a00000-0000-4000-8000-000000000005','vial','${vial}',
      'create','{"legacy":"d1"}','success','{"preserve":true}');`);
  const before = await db.query(`select snapshot::text snapshot from public.routine_versions where id=$1`, [version]);
  await db.exec(await read(d2File));
  const after = await db.query(`select snapshot::text snapshot from public.routine_versions where id=$1`, [version]);
  assert(after.rows[0].snapshot === before.rows[0].snapshot, 'Snapshot legado foi reescrito.');
  await db.exec(await read('supabase/tests/block_b22d2a_schema_invariants.sql'));
  await db.exec(await read('supabase/tests/block_b2_transactional_applications.sql'));
  await db.exec(`insert into auth.users(id,email) values
    ('d1f00000-0000-4000-8000-000000000001','d1-preexisting-d2a@example.invalid');
    insert into public.vials(id,user_id,name,initial_mg,remaining_mg,water_ml,prepared_on)
    values('d1f00000-0000-4000-8000-000000000002','d1f00000-0000-4000-8000-000000000001',
      'Regressão D1 após D2-A',10,10,2,date '2026-09-25');`);
  await db.exec(await read('supabase/tests/block_b22d1_versioned_vials.sql'));
  await db.exec(await read('supabase/tests/complete_legacy_import.sql'));
} finally { await db.close(); }

await expectMigrationFailure('Rotina sem versão corrente', baseFixture,
  /Rotina sem versão corrente correspondente/);

await expectMigrationFailure('Snapshot com identidade incompatível', `${baseFixture}
  insert into public.routine_versions(id,user_id,routine_id,version,snapshot)
  values('${version}','${user}','${routine}',1,
    '{"id":"d2a00000-0000-4000-8000-000000000099","user_id":"${user}","version":1}');`,
  /identidade incompatível em routine_versions/);

await expectMigrationFailure('Application ligada à versão de outra Rotina', `${baseFixture}
  insert into public.routine_versions(id,user_id,routine_id,version,snapshot)
  select '${version}',user_id,id,version,to_jsonb(r) from public.routines r where id='${routine}';
  insert into public.routines(id,user_id,vial_id,name,dose_value,dose_unit,syringe_capacity,
    frequency,start_date,version)
  values('d2a00000-0000-4000-8000-000000000006','${user}','${vial}','Outra',1,'mg',100,'daily',date '2026-09-25',1);
  insert into public.routine_versions(id,user_id,routine_id,version,snapshot)
  select 'd2a00000-0000-4000-8000-000000000007',user_id,id,version,to_jsonb(r)
  from public.routines r where id='d2a00000-0000-4000-8000-000000000006';
  insert into public.applications(id,user_id,operation_id,routine_id,routine_version_id,vial_id,
    scheduled_date,applied_at,dose_value,dose_unit,dose_mg,volume_ml,ui,concentration,balance_before,balance_after)
  values('d2a00000-0000-4000-8000-000000000008','${user}',
    'd2a00000-0000-4000-8000-000000000009','${routine}',
    'd2a00000-0000-4000-8000-000000000007','${vial}',date '2026-09-25',now(),
    1,'mg',1,0.2,20,5,10,9);`, /Application aponta para versão de outra Rotina ou conta/);

console.log('PASS: B2.2-D2-A schema, preflights, snapshots, imutabilidade e regressão legada.');
