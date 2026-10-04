import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');

test('RPC admin exige role=admin e aceita apenas janelas aprovadas',async()=>{
  const sql=await read('supabase/migrations/20260928215536_block_c_admin_acquisition_metrics.sql');
  assert.match(sql,/where id=u and role='admin'/);
  assert.match(sql,/p_days not in \(7,30,90\)/);
  assert.match(sql,/grant execute on function public\.get_admin_acquisition_metrics\(integer\)\s+to authenticated/i);
  assert.match(sql,/raise exception 'Acesso administrativo necessário' using errcode='42501'/);
});

test('RPC retorna somente métricas agregadas do funil',async()=>{
  const sql=await read('supabase/migrations/20260928215536_block_c_admin_acquisition_metrics.sql');
  for(const key of [
    'new_accounts','card_accounts','other_accounts','trials_started','card_trials',
    'paid_conversions','card_paid_conversions','paid_active_now',
    'card_to_trial_percent','card_to_paid_percent'
  ]) assert.match(sql,new RegExp(`'${key}'`));
  assert.doesNotMatch(sql,/jsonb_build_object\([^]*'email'/i);
  assert.doesNotMatch(sql,/jsonb_build_object\([^]*'name'/i);
});

test('painel admin explica corretamente que cartão não significa scan anônimo',async()=>{
  const html=await read('site/admin/index.html');
  assert.match(html,/contas atribuídas/i);
  assert.match(html,/Ainda não contamos scans anônimos do QR/i);
  assert.match(html,/gestão de códigos promocionais mostra somente os dados mínimos da conta/i);
  assert.match(html,/nenhuma rotina, frasco ou dado de saúde é exibido/i);
});

test('painel usa sessão Supabase compartilhada e não cria conta nova',async()=>{
  const source=await read('site/admin/admin.mjs');
  assert.match(source,/storageKey:\s*`pepday-\$\{config\.environment\}-\$\{config\.projectRef\}-auth`/);
  assert.match(source,/shouldCreateUser:false/);
  assert.match(source,/get_admin_acquisition_metrics/);
  assert.match(source,/p_days:days/);
  assert.doesNotMatch(source,/service_role|SUPABASE_SERVICE_ROLE_KEY|sb_secret_/i);
});

test('painel oferece 7, 30 e 90 dias e mostra funil QR para 30 dias PRO e pago',async()=>{
  const html=await read('site/admin/index.html');
  for(const days of ['7','30','90']) assert.match(html,new RegExp(`data-days="${days}"`));
  assert.match(html,/QR → 30 DIAS PRO/);
  assert.match(html,/30 DIAS PRO → PAGO/);
  assert.match(html,/CONVERSÕES PRO/);
});

test('servidor local expõe /site/admin/ sem alterar a Home do app',async()=>{
  const [server,app]=await Promise.all([read('scripts/dev-server.mjs'),read('index.html')]);
  assert.match(server,/rawPath==='site\/admin'\|\|rawPath==='site\/admin\/'\?'site\/admin\/index\.html'/);
  assert.match(server,/'site\/admin\/index\.html','site\/admin\/admin\.css','site\/admin\/admin\.mjs'/);
  assert.match(app,/id="calculator"/);
});
