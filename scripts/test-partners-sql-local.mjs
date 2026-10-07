import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db=new PGlite();
const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8');
try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema auth;create schema vault;
    create table vault.decrypted_secrets(name text,decrypted_secret text);
    insert into vault.decrypted_secrets values('pepday_supabase_project_url','https://fsbqpyyprtymwrmzsacp.supabase.co');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create table profiles(id uuid primary key,role text);
    create table admin_memberships(user_id uuid primary key,access_level text,active boolean,password_configured boolean);
    create table admin_audit_logs(id uuid default gen_random_uuid(),actor_user_id uuid,action text,metadata jsonb,created_at timestamptz default now());
    create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz default now(),not_after timestamptz);
    create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid,status text,factor_type text);`);
  const team=await read('supabase/migrations/20261004230000_admin_team_roles_mfa.sql');
  const start=team.indexOf('create or replace function public.admin_assert_access');
  await db.exec(team.slice(start,team.indexOf('end $$;',start)+7));
  await db.exec(await read('supabase/migrations/20261006213126_partners_p1_test.sql'));
  await db.exec(await read('supabase/migrations/20261007013353_partners_p1_ux_session.sql'));
  const result=await db.exec((await read('supabase/tests/partners_p1_local.sql'))+(await read('supabase/tests/partners_p1_assertions.sql')));
  assert.ok(result);
  await db.exec((await read('supabase/tests/partners_p1_local.sql'))+(await read('supabase/tests/partners_p1_ux_assertions.sql')));
  console.log('P1 PostgreSQL: all assertions PASS (rollback, synthetic data only)');
}catch(e){console.error(e.message,e.code,e.detail||'',e.where||'',e.position,e.internalPosition,e.internalQuery||'',e.query?.slice(Math.max(0,Number(e.position)-200),Number(e.position)+200));process.exitCode=1}finally{await db.close()}
