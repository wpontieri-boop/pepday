// Executa B2.2-D2-B em PostgreSQL efêmero; nunca conecta ao Supabase.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

if (!process.env.PGLITE_MODULE) {
  throw new Error('Defina PGLITE_MODULE para o dist/index.js do PGlite 0.5.8 local.');
}

const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const db = new PGlite();
let currentFile = 'bootstrap';

try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;`);

  for (const file of [
    'supabase/migrations/202609090001_block_a.sql',
    'supabase/migrations/202609100002_complete_legacy_import.sql',
    'supabase/migrations/202609110003_block_b1_entitlements.sql',
    'supabase/migrations/202609140004_block_b2_transactional_applications.sql',
    'supabase/migrations/202609150005_block_b2_validation_service_role.sql',
    'supabase/migrations/202609160006_block_b22d1_versioned_vials.sql',
    'supabase/migrations/20260925195332_block_b22d2a_routine_schema_invariants.sql',
    'supabase/migrations/20260925210000_block_b22d2b_create_routines.sql',
  ]) {
    currentFile = file;
    await db.exec(await read(file));
  }

  currentFile = 'supabase/tests/block_b22d2b_create_routines.sql';
  await db.exec(await read(currentFile));

  // Regressões executadas sobre o schema final D2-B, não apenas em migrations anteriores.
  currentFile = 'fixtures de regressão D2-A/D1';
  await db.exec(`insert into auth.users(id,email) values
      ('d2a00000-0000-4000-8000-000000000001','d2a-after-d2b@example.invalid'),
      ('d1f00000-0000-4000-8000-000000000001','d1-after-d2b@example.invalid');
    insert into public.vials(id,user_id,name,initial_mg,remaining_mg,water_ml,prepared_on) values
      ('d2a00000-0000-4000-8000-000000000002','d2a00000-0000-4000-8000-000000000001',
        'D2-A após D2-B',10,10,2,date '2026-09-25'),
      ('d1f00000-0000-4000-8000-000000000002','d1f00000-0000-4000-8000-000000000001',
        'D1 após D2-B',10,10,2,date '2026-09-25');
    insert into public.routines(id,user_id,vial_id,name,dose_value,dose_unit,syringe_capacity,
      frequency,weekdays,start_date,version)
    values('d2a00000-0000-4000-8000-000000000003','d2a00000-0000-4000-8000-000000000001',
      'd2a00000-0000-4000-8000-000000000002','Rotina D2-A após D2-B',1,'mg',100,
      'weekdays',array[5,1,5,3],date '2026-09-25',1);
    insert into public.routine_versions(id,user_id,routine_id,version,snapshot)
    select 'd2a00000-0000-4000-8000-000000000004',user_id,id,version,
      public.pepday_routine_snapshot(r) from public.routines r
      where id='d2a00000-0000-4000-8000-000000000003';
    insert into public.domain_mutation_operations(user_id,operation_id,entity_type,entity_id,
      mutation_type,intent_fingerprint,outcome,result)
    values('d2a00000-0000-4000-8000-000000000001','d2a00000-0000-4000-8000-000000000005',
      'vial','d2a00000-0000-4000-8000-000000000002','create','{"legacy":"d1"}',
      'success','{"preserve":true}');`);

  for (const file of [
    'supabase/tests/block_b22d2a_schema_invariants.sql',
    'supabase/tests/block_b22d1_versioned_vials.sql',
    'supabase/tests/block_b2_transactional_applications.sql',
    'supabase/tests/block_b1_entitlements.sql',
    'supabase/tests/complete_legacy_import.sql',
  ]) {
    currentFile = file;
    await db.exec(await read(file));
  }

  console.log('PASS: B2.2-D2-B e regressões D2-A, D1, B2.1, B1 e importação legada.');
} catch (error) {
  console.error(`${currentFile}: ${error.message}`);
  if (error.detail) console.error(error.detail);
  if (error.position) console.error(`posição SQL: ${error.position}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
