import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  cancellationConfirmed,
  mercadoPagoCancelBody,
  needsProviderCancellation,
  normalizeDeleteRequest,
  validProviderSubscriptionId,
} from '../supabase/functions/account-delete/delete-core.mjs';

const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');

test('export_my_data exige autenticação e retorna somente conjuntos do próprio usuário',async()=>{
  const sql=await read('supabase/migrations/20260929005558_block_d_data_rights.sql');
  assert.match(sql,/u uuid:=auth\.uid\(\)/);
  assert.match(sql,/if u is null then\s+raise exception 'Autenticação necessária'/i);
  for(const key of [
    'profile','settings','subscription','trial','vials','routines',
    'routine_versions','applications','vial_movements','imports','acquisition'
  ]) assert.match(sql,new RegExp(`'${key}'`));
  assert.match(sql,/where v\.user_id=u/);
  assert.match(sql,/where r\.user_id=u/);
  assert.match(sql,/where a\.user_id=u/);
  assert.match(sql,/grant execute on function public\.export_my_data\(\)\s+to authenticated/i);
});

test('exportação não inclui tokens, outboxes, logs internos ou billing_events',async()=>{
  const sql=await read('supabase/migrations/20260929005558_block_d_data_rights.sql');
  const resultSection=sql.slice(sql.indexOf("result:=jsonb_build_object"),sql.indexOf("insert into public.audit_logs"));
  assert.doesNotMatch(resultSection,/push_installations|push_notification_outbox|transactional_email_outbox|audit_logs|billing_events/i);
  assert.doesNotMatch(resultSection,/service_role|private_key|access_token|refresh_token/i);
});

test('exclusão exige confirmação exata EXCLUIR',()=>{
  assert.deepEqual(normalizeDeleteRequest({confirm:'EXCLUIR'}),{confirm:'EXCLUIR'});
  for(const value of [null,{},[],{confirm:'excluir'},{confirm:' EXCLUIR '},{confirm:true}]) {
    assert.equal(normalizeDeleteRequest(value),null);
  }
});

test('assinatura Mercado Pago ativa exige cancelamento antes da exclusão',()=>{
  assert.equal(needsProviderCancellation(null),false);
  assert.equal(needsProviderCancellation({provider:'stripe',provider_subscription_id:'sub-12345678'}),false);
  assert.equal(needsProviderCancellation({provider:'mercado_pago',provider_subscription_id:null}),false);
  assert.equal(needsProviderCancellation({provider:'mercado_pago',provider_subscription_id:'sub-12345678',provider_status:'canceled',billing_status:'canceled'}),false);
  assert.equal(needsProviderCancellation({provider:'mercado_pago',provider_subscription_id:'sub-12345678',provider_status:'authorized',billing_status:'active'}),true);
  assert.equal(needsProviderCancellation({provider:'mercado_pago',provider_subscription_id:'sub-12345678',provider_status:'paused',billing_status:'grace'}),true);
});

test('cancelamento Mercado Pago usa somente status canceled e confirma recurso canônico',()=>{
  assert.deepEqual(mercadoPagoCancelBody(),{status:'canceled'});
  assert.equal(validProviderSubscriptionId('2c938084726fca480172750000000000'),'2c938084726fca480172750000000000');
  assert.equal(validProviderSubscriptionId(''),null);
  assert.equal(validProviderSubscriptionId('../bad'),null);
  assert.equal(cancellationConfirmed({id:'abc123456',status:'canceled'},'abc123456'),true);
  assert.equal(cancellationConfirmed({id:'abc123456',status:'authorized'},'abc123456'),false);
  assert.equal(cancellationConfirmed({id:'other123',status:'canceled'},'abc123456'),false);
});

test('Edge Function autentica usuário, cancela billing e só então apaga auth.users',async()=>{
  const source=await read('supabase/functions/account-delete/index.mjs');
  const auth=source.indexOf('authenticatedUser(');
  const subscription=source.indexOf('subscriptionForUser(');
  const cancel=source.indexOf('cancelMercadoPago(');
  const deletion=source.indexOf('deleteAuthUser(');
  assert.ok(auth>=0&&subscription>auth&&cancel>subscription&&deletion>cancel);
  assert.match(source,/https:\/\/api\.mercadopago\.com\/preapproval\//);
  assert.match(source,/method:"PUT"/);
  assert.match(source,/status:'canceled'|mercadoPagoCancelBody\(\)/);
  assert.match(source,/\/auth\/v1\/admin\/users\//);
  assert.match(source,/should_soft_delete","false"/);
  assert.match(source,/DELETE_CONFIRMATION_REQUIRED/);
});

test('Edge Function responde preflight CORS antes de exigir POST e inclui CORS nas respostas',async()=>{
  const source=await read('supabase/functions/account-delete/index.mjs');
  assert.match(source,/Access-Control-Allow-Origin/);
  assert.match(source,/authorization, x-client-info, apikey, content-type/i);
  const options=source.indexOf('req.method==="OPTIONS"');
  const post=source.indexOf('req.method!=="POST"');
  assert.ok(options>=0&&post>options);
  assert.match(source,/headers:\{\.\.\.CORS_HEADERS,"Cache-Control":"no-store"\}/);
});

test('Edge Function não registra e-mail, token ou payload sensível em logs',async()=>{
  const source=await read('supabase/functions/account-delete/index.mjs');
  const logs=[...source.matchAll(/console\.(?:log|error|warn)\(([^\n]+)\)/g)].map(m=>m[1]).join('\n');
  assert.doesNotMatch(logs,/email|token|authorization|provider_subscription_id|body|user\.id/i);
  assert.doesNotMatch(source,/console\.log/);
});

test('configuração declara account-delete como função com validação própria de JWT',async()=>{
  const config=await read('supabase/config.toml');
  assert.match(config,/\[functions\.account-delete\][^]*verify_jwt = false[^]*account-delete\/index\.mjs/);
  assert.match(config,/valida o JWT do usuário diretamente no Supabase Auth/i);
});

test('Perfil expõe exportação e exclusão com confirmação digitada',async()=>{
  const html=await read('index.html');
  for(const id of ['accountExportData','accountDeleteOpen','accountDeleteConfirm','accountDeleteText','accountDeleteConfirmBtn']) {
    assert.match(html,new RegExp(`id="${id}"`));
  }
  assert.match(html,/Exporte os dados confirmados na sua conta em JSON/i);
  assert.match(html,/Digite <b>EXCLUIR<\/b> para confirmar/i);
  assert.match(html,/Se houver assinatura recorrente ativa, o PepDay tentará cancelá-la antes/i);
});

test('UI exporta pela RPC e limpa escopo local somente após exclusão remota confirmada',async()=>{
  const [ui,account]=await Promise.all([read('src/account-ui.mjs'),read('src/account.mjs')]);
  assert.match(account,/exportData:\s*\(\)\s*=>\s*unwrap\(client\.rpc\('export_my_data'\)\)/);
  assert.match(ui,/cloud\.account\.exportData\(\)/);
  assert.match(ui,/functions\.invoke\('account-delete'/);
  const invoke=ui.indexOf("functions.invoke('account-delete'");
  const confirmed=ui.indexOf("data?.code!=='ACCOUNT_DELETED'");
  const localClear=ui.indexOf('repository.clearUserData()',confirmed);
  assert.ok(invoke>=0&&confirmed>invoke&&localClear>confirmed);
  assert.match(ui,/pepday:local-data-cleared/);
});

test('limpeza local inclui todas as stores sensíveis do escopo ativo',async()=>{
  const source=await read('src/pepday-repository.mjs');
  const block=source.slice(source.indexOf('async clearUserData()'),source.indexOf('async confirmedCounts()'));
  for(const store of [
    'vials','routines','routineVersions','applications','vialMovements',
    'outbox','conflicts','drafts','meta','migrationReceipts'
  ]) assert.match(block,new RegExp(`'${store}'`));
});
