import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const read=path=>readFile(resolve(root,path),'utf8');

test('migration cria codigos e resgates promocionais backend-only',async()=>{
  const sql=await read('supabase/migrations/20260929172504_promo_codes_access.sql');
  assert.match(sql,/create table public\.promo_codes/i);
  assert.match(sql,/create table public\.promo_redemptions/i);
  assert.match(sql,/duration_days in \(30,60,90\)/i);
  assert.match(sql,/user_id uuid not null unique/i);
  assert.match(sql,/max_redemptions/i);
  assert.match(sql,/exclusive_user_id/i);
  assert.match(sql,/alter table public\.promo_codes enable row level security/i);
  assert.match(sql,/revoke all on public\.promo_codes from public,anon,authenticated,service_role/i);
  assert.match(sql,/revoke all on public\.promo_redemptions from public,anon,authenticated,service_role/i);
});

test('resgate e unico por conta e nao fabrica assinatura paga',async()=>{
  const sql=await read('supabase/migrations/20260929172504_promo_codes_access.sql');
  const start=sql.indexOf('create or replace function public.redeem_promo_code');
  const end=sql.indexOf('create or replace function public.admin_create_promo_code');
  const redeem=sql.slice(start,end);
  assert.match(redeem,/exists\(select 1 from public\.promo_redemptions where user_id=u\)/i);
  assert.match(redeem,/promo_start:=case when t\.trial_used and t\.ends_at>stamp then t\.ends_at else stamp end/i);
  assert.match(redeem,/redemption_count>=pc\.max_redemptions/i);
  assert.match(redeem,/pc\.exclusive_user_id is not null and pc\.exclusive_user_id<>u/i);
  assert.doesNotMatch(redeem,/update public\.subscriptions/i);
  assert.doesNotMatch(redeem,/billing_events/i);
  assert.match(redeem,/insert into public\.audit_logs\(user_id,action\) values\(u,'promo_redeemed'\)/i);
});

test('entitlement reconhece promo como PRO temporario separado de billing',async()=>{
  const sql=await read('supabase/migrations/20260929172504_promo_codes_access.sql');
  assert.match(sql,/source','promo'/);
  assert.match(sql,/promo_code',r\.code_snapshot/);
  assert.match(sql,/starts_at<=stamp and ends_at>stamp/i);
  const source=await read('src/entitlement.mjs');
  assert.match(source,/normalized\.source === 'promo'/);
  assert.match(source,/PEPDAY PRO — CÓDIGO PROMOCIONAL/);
  assert.match(source,/Acesso PRO promocional ativo/);
});

test('admin controla criacao, validade, exclusividade, ativacao e auditoria de usos',async()=>{
  const sql=await read('supabase/migrations/20260929172504_promo_codes_access.sql');
  for(const fn of [
    'admin_create_promo_code',
    'admin_set_promo_code_active',
    'get_admin_promo_codes',
    'get_admin_promo_redemptions'
  ]) assert.match(sql,new RegExp(`function public\\.${fn}`,'i'));
  assert.match(sql,/role='admin'/i);
  assert.match(sql,/lower\(email\)=lower\(trim\(p_exclusive_email\)\)/i);
  assert.match(sql,/grant execute on function public\.admin_create_promo_code[^]*to authenticated/i);
  assert.match(sql,/grant execute on function public\.get_admin_promo_redemptions\(text\) to authenticated/i);
});

test('app oferece campo de codigo e usa somente RPC autenticada',async()=>{
  const html=await read('index.html');
  const ui=await read('src/account-ui.mjs');
  assert.match(html,/id="promoRedeemForm"/);
  assert.match(html,/id="promoCode"/);
  assert.match(html,/id="promoRedeemButton"/);
  assert.match(ui,/client\.rpc\('redeem_promo_code',\{p_code:code\}\)/);
  assert.doesNotMatch(ui,/promo_codes[^\n]*(insert|update|delete)/i);
  assert.doesNotMatch(ui,/promo_redemptions[^\n]*(insert|update|delete)/i);
});

test('painel gera codigos unicos 30, 60 e 90 dias e permite copiar e auditar uso',async()=>{
  const html=await read('site/admin/index.html');
  const js=await read('site/admin/admin.mjs');
  const migration=await read('supabase/migrations/20260929222437_unique_promo_codes.sql');
  for(const days of ['30','60','90']){
    assert.match(html,new RegExp(`data-promo-preset="${days}"`));
  }
  assert.doesNotMatch(html,/id="promoAdminCode"/);
  assert.doesNotMatch(html,/id="promoAdminLimit"/);
  assert.match(html,/Gerar c.digo .nico/u);
  assert.match(html,/Validade do código/);
  assert.match(html,/Até quando o código pode ser resgatado/);
  assert.match(html,/id="promoAdminExpiry"[^>]*required/);
  assert.match(html,/id="promoAdminEmail"/);
  assert.match(js,/promoExpiryFromNow/);
  assert.match(js,/date\.setDate\(date\.getDate\(\)\+Number\(days\|\|0\)\)/);
  assert.match(js,/syncPromoExpiry\(\)/);
  assert.match(html,/id="promoCodeSearch"/);
  assert.match(js,/promoRows=Array\.isArray\(data\)\?data:\[\]/);
  assert.match(js,/promoCodeSearch'\)\?\.addEventListener\('input'/);
  assert.match(js,/toUpperCase\(\)\.includes\(query\)/);
  assert.match(js,/Nenhum código encontrado/);
  assert.match(js,/admin_generate_promo_code/);
  assert.match(js,/navigator\.clipboard\.writeText/);
  assert.match(js,/Copiar c.digo/u);
  assert.match(js,/DISPON.VEL/u);
  assert.match(js,/UTILIZADO/);
  assert.match(js,/EXPIRADO/);
  assert.match(js,/get_admin_promo_redemptions/);
  assert.match(migration,/generated_code:='AMIGO'\|\|p_duration_days\|\|'-'/);
  assert.match(migration,/max_redemptions,expires_at/);
  assert.match(migration,/generated_code,p_duration_days,1,p_expires_at/);
  assert.match(migration,/where code in \('AMIGO30','AMIGO60','AMIGO90'\)/);
  assert.match(migration,/revoke execute on function public\.admin_create_promo_code[^]*from authenticated/);
});
