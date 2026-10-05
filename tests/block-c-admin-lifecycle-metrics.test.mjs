import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');
const migration='supabase/migrations/20260929021500_block_c_admin_lifecycle_metrics.sql';

test('painel lifecycle mantém acesso admin e exclui admins das métricas comerciais',async()=>{
  const sql=await read(migration);
  assert.match(sql,/where id=u and role='admin'/);
  assert.match(sql,/p\.role<>'admin'/);
  assert.match(sql,/p_days not in \(7,30,90\)/);
  assert.match(sql,/grant execute on function public\.get_admin_acquisition_metrics\(integer\)\s+to authenticated/i);
});

test('RPC entrega estados agregados de trial, recuperação e assinatura',async()=>{
  const sql=await read(migration);
  for(const key of [
    'total_users_now','free_now','trial_active_now','trial_ending_3d_now',
    'trial_expired_no_pro_now','recovery_eligible_now','monthly_active_now',
    'annual_active_now','grace_active_now','cancel_scheduled_now',
    'pro_expired_now','cancellations_in_window'
  ]) assert.match(sql,new RegExp(`'${key}'`));
  assert.match(sql,/st\.marketing_opt_in is true/);
  assert.match(sql,/t\.ends_at<=stamp\+interval '3 days'/);
  assert.match(sql,/count\(distinct e\.subscription_id\)/);
});

test('métricas de recuperação não expõem PII nem dados de rotina',async()=>{
  const sql=await read(migration);
  const returned=sql.slice(sql.indexOf('return jsonb_build_object'));
  assert.doesNotMatch(returned,/'email'|'name'|'user_id'|'routine'|'vial'/i);
  assert.match(sql,/'revenue_available',false/);
  assert.match(sql,/'recovered_campaign_available',false/);
});

test('painel mostra base, trial, retenção e recuperação sem fingir receita',async()=>{
  const html=await read('site/admin/index.html');
  for(const text of [
    'FREE AGORA','TRIAL ATIVO','TRIAL VENCENDO','TRIAL EXPIRADO SEM PRO',
    'ELEGÍVEIS PARA RECUPERAÇÃO','PRO MENSAL ATIVO','PRO ANUAL ATIVO',
    'EM TOLERÂNCIA','CANCELAMENTO AGENDADO','EX-PRO','RECUPERADOS POR CAMPANHA',
    'RECEITA RECEBIDA'
  ]) assert.match(html,new RegExp(text));
  assert.match(html,/Nenhuma campanha promocional é disparada agora/);
  assert.match(html,/consentimento atual de marketing/);
});

test('frontend renderiza todas as métricas lifecycle e mantém placeholders externos',async()=>{
  const source=await read('site/admin/admin.mjs');
  for(const key of [
    'total_users_now','free_now','trial_active_now','trial_ending_3d_now',
    'trial_expired_no_pro_now','recovery_eligible_now','monthly_active_now',
    'annual_active_now','grace_active_now','cancel_scheduled_now',
    'pro_expired_now','cancellations_in_window'
  ]) assert.match(source,new RegExp(`data\\.${key}`));
  assert.match(source,/data\.recovered_campaign_available&&data\.recovered_campaign_count!=null/);
  assert.match(source,/data\.revenue_available&&data\.revenue_received!=null/);
});
