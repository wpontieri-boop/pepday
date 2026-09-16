// Executa B2.2-D1 em PostgreSQL efêmero; nunca conecta ao Supabase.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
if(!process.env.PGLITE_MODULE) throw new Error('Defina PGLITE_MODULE para o dist/index.js do PGlite 0.5.8 local.');
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db=new PGlite();
let currentFile='bootstrap';
try{
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;`);
  for(const file of [
    'supabase/migrations/202609090001_block_a.sql',
    'supabase/migrations/202609100002_complete_legacy_import.sql',
    'supabase/migrations/202609110003_block_b1_entitlements.sql',
    'supabase/migrations/202609140004_block_b2_transactional_applications.sql',
    'supabase/migrations/202609150005_block_b2_validation_service_role.sql',
    'supabase/migrations/202609160006_block_b22d1_versioned_vials.sql'
  ]){currentFile=file;await db.exec(await readFile(new URL('../'+file,import.meta.url),'utf8'));}
  currentFile='supabase/tests/block_b22d1_versioned_vials.sql';
  await db.exec(await readFile(new URL('../'+currentFile,import.meta.url),'utf8'));
  console.log('PASS: B2.2-D1 Frascos versionados, conflitos, replay, saldo e isolamento.');
}catch(error){
  console.error(`${currentFile}: ${error.message}`);
  if(error.detail)console.error(error.detail);
  if(error.position)console.error(`posição SQL: ${error.position}`);
  process.exitCode=1;
}finally{await db.close();}
