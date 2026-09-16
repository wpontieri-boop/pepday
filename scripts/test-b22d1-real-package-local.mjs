// Valida sintaxe/guardas do pacote em PostgreSQL efêmero. Nunca abre rede.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generatePackage } from './prepare-b22d1-real-validation.mjs';

if (!process.env.PGLITE_MODULE) throw new Error('Defina PGLITE_MODULE para o dist/index.js do PGlite 0.5.8 local.');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const root = new URL('../', import.meta.url);
const migrations = [
  'supabase/migrations/202609090001_block_a.sql',
  'supabase/migrations/202609100002_complete_legacy_import.sql',
  'supabase/migrations/202609110003_block_b1_entitlements.sql',
  'supabase/migrations/202609140004_block_b2_transactional_applications.sql',
  'supabase/migrations/202609150005_block_b2_validation_service_role.sql',
  'supabase/migrations/202609160006_block_b22d1_versioned_vials.sql',
];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const parent = await mkdtemp(join(tmpdir(), 'pepday-d1-real-local-'));
const outputDir = join(parent, 'run');
const db = new PGlite();

try {
  await generatePackage({ outputDir });
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb not null default '{}');
    create table auth.identities(user_id uuid references auth.users(id) on delete cascade);
    create table auth.sessions(user_id uuid references auth.users(id) on delete cascade);
    create table auth.refresh_tokens(user_id uuid references auth.users(id) on delete cascade);
    create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;`);
  for (const file of migrations) await db.exec(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
  const read = file => readFile(join(outputDir, file), 'utf8');
  await db.exec(await read('00_preflight.sql'));
  await db.exec(await read('10_prepare.sql'));
  for (const file of ['20_create_session_a.sql','21_create_session_b.sql',
    '30_update_delete_session_a.sql','31_update_delete_session_b.sql']) {
    await db.exec((await read(file)).replaceAll('select pg_sleep(12);', 'select pg_sleep(0);'));
  }
  let sequentialRejected = false;
  try { await db.exec(await read('90_verify.sql')); }
  catch (error) { sequentialRejected = /lock real .* não observado|execução sequencial/i.test(error.message); }
  assert(sequentialRejected, '90_verify aceitou A/B sequenciais.');
  await db.exec(await read('99_cleanup.sql'));
  const remaining = await db.query(`select
    (select count(*) from auth.users)+
    (select count(*) from public.profiles)+
    (select count(*) from public.domain_mutation_operations)+
    (select count(*) from public.vials) n`);
  assert(Number(remaining.rows[0].n) === 0, 'Cleanup local deixou fixture.');
  console.log('PASS LOCAL — pacote D1 compila, execução sequencial falha e cleanup zera fixtures.');
} finally {
  await db.close();
  await rm(parent, { recursive: true, force: true });
}
