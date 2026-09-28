// Validação sequencial do pacote; NÃO comprova concorrência PostgreSQL real.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildPackage } from './prepare-b22d2f-real-validation.mjs';
if (!process.env.PGLITE_MODULE) throw new Error('Defina PGLITE_MODULE (PGlite 0.5.8).');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const pack = buildPackage({holdSeconds:0});
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create table auth.identities(user_id uuid); create table auth.sessions(user_id uuid); create table auth.refresh_tokens(user_id text);
    create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;`);
  const dir = new URL('../supabase/migrations/',import.meta.url);
  for (const name of (await readdir(dir)).filter(n=>n.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(name,dir),'utf8'));
  await db.exec(pack.setup);
  for (const c of pack.scenarios) { await db.exec(c.sqlA); await db.exec(c.sqlB); }
  await assert.rejects(db.exec(pack.verify),/Lock não comprovado/);
  await db.exec('rollback');
  // Dados sintéticos somente nesta instância descartável, para exercitar o
  // verificador completo. Nunca enviados ao Supabase nem usados como prova real.
  const row=await db.query('select source_snapshot from public.local_data_imports where id=$1',[pack.ids.importId]);
  const snapshot=row.rows[0].source_snapshot;
  for (const c of pack.scenarios) {
    snapshot.evidence[c.name+'_lock']=[{blocker:1,waiter:2,wait_event_type:'Lock'}];
    snapshot.evidence[c.name+'_a'].release='2026-09-28T00:00:02Z';
    snapshot.evidence[c.name+'_b'].started='2026-09-28T00:00:01Z';
    snapshot.evidence[c.name+'_b'].finished='2026-09-28T00:00:03Z';
  }
  await db.query('update public.local_data_imports set source_snapshot=$1 where id=$2',[JSON.stringify(snapshot),pack.ids.importId]);
  await db.exec(pack.verify);
  const key='update_update_b';
  snapshot.evidence[key].result.code='WRONG_CONFLICT';
  await db.query('update public.local_data_imports set source_snapshot=$1 where id=$2',[JSON.stringify(snapshot),pack.ids.importId]);
  await assert.rejects(db.exec(pack.verify),/Resultado B incorreto update_update/);
  await db.exec('rollback');
  // A limpeza deve recusar procedência adulterada, preservando a fixture.
  const forged = pack.cleanup.replace(`"email":"${pack.ids.email}"`, '"email":"forged@example.invalid"');
  await assert.rejects(db.exec(forged),/IDs diferentes/);
  await db.exec('rollback');
  await db.exec(pack.cleanup);
  const result = await db.query(pack.remaining);
  assert.equal(Number(result.rows[0].total_fixtures),0);
  console.log('PASS D2-F pacote local: SQL executável, sem falso PASS real, cleanup protegido e zero resíduos.');
} catch(error) { console.error(error.message); process.exitCode=1; } finally { await db.close(); }
