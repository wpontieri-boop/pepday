// Executa somente o delta SQL B1 em PostgreSQL efêmero; nunca conecta ao Supabase.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
if(!process.env.PGLITE_MODULE) throw new Error('Defina PGLITE_MODULE para o dist/index.js do PGlite 0.5.8 local.');
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db=new PGlite();
try {
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;`);
  for(const file of [
    'supabase/migrations/202609090001_block_a.sql',
    'supabase/migrations/202609100002_complete_legacy_import.sql',
    'supabase/migrations/202609110003_block_b1_entitlements.sql'
  ]) await db.exec(await readFile(new URL('../'+file,import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/tests/block_b1_entitlements.sql',import.meta.url),'utf8'));
  console.log('PASS: FREE/TRIAL/PRO, sete dias, idempotência, nova sessão e preservação.');
} catch(error) {
  console.error(error.message);process.exitCode=1;
} finally {await db.close();}
