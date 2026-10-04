import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');
const migration='supabase/migrations/20261004230000_admin_team_roles_mfa.sql';

test('equipe administrativa separa OWNER ADMIN e VIEWER com OWNER único',async()=>{
  const sql=await read(migration);
  assert.match(sql,/create table public\.admin_memberships/i);
  assert.match(sql,/access_level in \('owner','admin','viewer'\)/i);
  assert.match(sql,/admin_memberships_single_active_owner/i);
  assert.match(sql,/values\(seed_id,'owner',true,false,seed_id\)/i);
  assert.match(sql,/p_access_level not in \('admin','viewer'\)/i);
  assert.match(sql,/O OWNER não pode ser removido/i);
});

test('backend administrativo exige MFA AAL2 e bloqueia escrita do VIEWER',async()=>{
  const sql=await read(migration);
  assert.match(sql,/auth\.jwt\(\)->>'aal'/);
  assert.match(sql,/<>\s*'aal2'/);
  assert.match(sql,/Autenticação em dois fatores necessária/i);
  assert.match(sql,/p_write and level='viewer'/i);
  assert.match(sql,/Acesso somente leitura/i);
  assert.match(sql,/p_owner_only and level<>'owner'/i);
});

test('RPCs antigas ficam atrás de wrappers endurecidos sem duplicar regra comercial',async()=>{
  const sql=await read(migration);
  for(const name of [
    'get_admin_acquisition_metrics','get_admin_pwa_metrics','get_admin_card_campaign_metrics',
    'get_admin_promo_codes','get_admin_promo_redemptions','admin_generate_promo_code',
    'admin_set_promo_code_active'
  ]) assert.match(sql,new RegExp(`rename to ${name}_legacy`,'i'));
  assert.match(sql,/admin_assert_access\(false,false\)/);
  assert.match(sql,/admin_assert_access\(true,false\)/);
  assert.match(sql,/revoke all on function public\.admin_generate_promo_code_legacy/i);
});

test('painel usa senha normal e OTP somente no primeiro acesso',async()=>{
  const [html,js]=await Promise.all([read('site/admin/index.html'),read('site/admin/admin.mjs')]);
  assert.match(html,/id="loginForm"/);
  assert.match(html,/id="password"[^>]*minlength="12"/);
  assert.match(html,/Configurar primeiro acesso/);
  assert.match(html,/2FA OBRIGATÓRIO/);
  assert.match(js,/signInWithPassword/);
  assert.match(js,/signInWithOtp\(\{email,options:\{shouldCreateUser:false\}\}\)/);
  assert.match(js,/bootstrap&&context\.password_configured/);
  assert.match(js,/challengeAndVerify/);
  assert.match(js,/getAuthenticatorAssuranceLevel/);
  assert.match(js,/admin-auth/);
  assert.doesNotMatch(js,/projectRef\}-auth`/);
});

test('OWNER gerencia equipe e VIEWER não recebe controles de escrita',async()=>{
  const [html,js]=await Promise.all([read('site/admin/index.html'),read('site/admin/admin.mjs')]);
  assert.match(html,/id="teamAdmin"/);
  assert.match(html,/id="teamLevel"/);
  assert.match(html,/OWNER, ADMIN e VIEWER/);
  assert.match(js,/adminContext\?\.can_manage_team/);
  assert.match(js,/adminContext\?\.can_write/);
  assert.match(js,/admin-team-invite/);
  assert.match(js,/admin_disable_team_member/);
  assert.match(js,/if\(adminContext\?\.can_write\)actions\.append\(toggle\)/);
});

test('função de equipe cria conta administrativa sem expor service key ao navegador',async()=>{
  const [fn,config]=await Promise.all([
    read('supabase/functions/admin-team-invite/index.mjs'),
    read('supabase/config.toml')
  ]);
  assert.match(fn,/\/auth\/v1\/admin\/users/);
  assert.match(fn,/get_admin_team/);
  assert.match(fn,/admin_set_team_member/);
  assert.match(fn,/email_confirm:true/);
  assert.match(fn,/OWNER_MFA_REQUIRED/);
  assert.match(config,/\[functions\.admin-team-invite\][^]*verify_jwt = false/);
  assert.doesNotMatch(await read('site/admin/admin.mjs'),/SUPABASE_SERVICE_ROLE_KEY|sb_secret_/);
});

test('auditoria administrativa registra ator alvo ação e horário',async()=>{
  const sql=await read(migration);
  assert.match(sql,/create table public\.admin_audit_logs/i);
  assert.match(sql,/actor_user_id uuid not null/i);
  assert.match(sql,/target_user_id uuid/i);
  assert.match(sql,/admin_team_member_upserted/);
  assert.match(sql,/promo_code_status_changed/);
  assert.match(sql,/get_admin_audit_logs/);
});
