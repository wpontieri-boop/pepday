// Ferramenta opcional isolada: não conecta ao Supabase nem executa a suite antiga.
// PGLITE_MODULE deve apontar para dist/index.js de @electric-sql/pglite instalado.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
if(!process.env.PGLITE_MODULE) throw new Error('Defina PGLITE_MODULE para o módulo PGlite local.');
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db=new PGlite();
try {
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;`);
  // Reconstitui o esquema de base apenas no banco efêmero para testar o delta.
  for(const file of ['supabase/migrations/202609090001_block_a.sql','supabase/migrations/202609100002_complete_legacy_import.sql']){
    await db.exec(await readFile(new URL('../'+file,import.meta.url),'utf8'));
  }
  const results=await db.exec(await readFile(new URL('../supabase/tests/complete_legacy_import.sql',import.meta.url),'utf8'));
  console.log(results.flatMap(r=>r.rows).filter(r=>r.resultado));
} catch(error) {
  // Nunca imprimir query, fixture completa ou conteúdo privado por padrão.
  console.error(error.message); process.exitCode=1;
} finally {await db.close();}
