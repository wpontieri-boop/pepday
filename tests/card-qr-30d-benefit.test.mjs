import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  captureCardAcquisition,
  readAcquisition,
  claimPendingCardAcquisition,
  markCardBenefitUsed
} from '../src/acquisition.mjs';
import {entitlementPresentation,postTrialExperience} from '../src/entitlement.mjs';

const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');

class MemoryStorage{
  constructor(){this.map=new Map()}
  setItem(key,value){this.map.set(key,String(value))}
  getItem(key){return this.map.has(key)?this.map.get(key):null}
  removeItem(key){this.map.delete(key)}
}

test('migration cria benefício 30d único e backend-only',async()=>{
  const sql=await read('supabase/migrations/20261001184711_card_qr_30d_benefit.sql');
  assert.match(sql,/create table public\.card_pro_grants/i);
  assert.match(sql,/user_id uuid not null unique references public\.profiles/i);
  assert.match(sql,/duration_days integer not null default 30 check \(duration_days=30\)/i);
  assert.match(sql,/ends_at=starts_at\+interval '30 days'/i);
  assert.match(sql,/alter table public\.card_pro_grants enable row level security/i);
  assert.match(sql,/revoke all on public\.card_pro_grants from public,anon,authenticated,service_role/i);
});
test('claim do cartão concede 30d mesmo para trial já usado e bloqueia apenas PRO pago ativo',async()=>{
  const sql=await read('supabase/migrations/20261001184711_card_qr_30d_benefit.sql');
  const start=sql.indexOf('create or replace function public.claim_card_acquisition');
  const end=sql.indexOf('create or replace function public.mark_card_pro_usage');
  const claim=sql.slice(start,end);
  assert.match(claim,/CARD_PRO_GRANTED/);
  assert.match(claim,/s\.status='pro_active' and s\.provider='mercado_pago' and paid_end>stamp/i);
  assert.doesNotMatch(claim,/trial_used[^\n]*(raise|blocked|not eligible)/i);
  assert.match(claim,/on conflict\(user_id\) do nothing/i);
  assert.match(claim,/card_pro_30d_granted/);
  assert.doesNotMatch(claim,/update public\.subscriptions/i);
  assert.doesNotMatch(claim,/billing_events/i);
});

test('benefício substitui trial futuro sem adulterar a linha de trial',async()=>{
  const sql=await read('supabase/migrations/20261001184711_card_qr_30d_benefit.sql');
  const start=sql.indexOf('create or replace function public.start_trial');
  const end=sql.indexOf('create or replace function public.claim_card_acquisition');
  const fn=sql.slice(start,end);
  assert.match(fn,/exists\(select 1 from public\.card_pro_grants where user_id=u\)/i);
  assert.ok(fn.indexOf('card_pro_grants')<fn.indexOf('if t.trial_used'));
  assert.match(fn,/return public\.get_entitlement\(\)/i);
});

test('entitlement prioriza cartão após assinatura paga e antes de promo/trial',async()=>{
  const sql=await read('supabase/migrations/20261001184711_card_qr_30d_benefit.sql');
  const start=sql.indexOf('create or replace function public.get_entitlement');
  const end=sql.indexOf('create or replace function public.start_trial');
  const fn=sql.slice(start,end);
  assert.match(fn,/source','card'/);
  assert.match(fn,/trial_available',false/);
  assert.ok(fn.indexOf("source','subscription'")<fn.indexOf("source','card'"));
  assert.ok(fn.indexOf("source','card'")<fn.indexOf("source','promo'"));
  assert.match(fn,/g\.id is not null[^]*status','pro_expired'[^]*source','card'/i);
});
test('uso do benefício é registrado sem conteúdo de saúde',async()=>{
  const sql=await read('supabase/migrations/20261001184711_card_qr_30d_benefit.sql');
  const start=sql.indexOf('create or replace function public.mark_card_pro_usage');
  const end=sql.indexOf('create or replace function public.get_admin_card_campaign_metrics');
  const fn=sql.slice(start,end);
  assert.match(fn,/first_used_at=coalesce\(first_used_at,stamp\)/i);
  assert.match(fn,/last_used_at=stamp/i);
  assert.match(fn,/card_pro_30d_first_used/i);
  assert.doesNotMatch(fn,/routine|vial|dose|substance|health/i);
});

test('painel agrega ativação, uso, fim e conversão mensal/anual do cartão',async()=>{
  const [sql,html,admin]=await Promise.all([
    read('supabase/migrations/20261001184711_card_qr_30d_benefit.sql'),
    read('site/admin/index.html'),
    read('site/admin/admin.mjs')
  ]);
  assert.match(sql,/get_admin_card_campaign_metrics/i);
  assert.match(sql,/paid_monthly_after_grant/);
  assert.match(sql,/paid_annual_after_grant/);
  for(const id of ['cardBenefitGranted','cardBenefitUsed','cardBenefitActive','cardBenefitEnded','cardBenefitPaid','cardBenefitPlans']){
    assert.match(html,new RegExp(`id="${id}"`));
  }
  assert.match(html,/QR → 30 DIAS PRO/);
  assert.match(html,/30 DIAS PRO → PAGO/);
  assert.match(admin,/get_admin_card_campaign_metrics/);
  assert.match(admin,/renderCardCampaign/);
});
test('exportação do titular inclui o benefício do cartão',async()=>{
  const sql=await read('supabase/migrations/20261001184711_card_qr_30d_benefit.sql');
  assert.match(sql,/'card_pro_benefit'/);
  assert.match(sql,/'campaign',g\.campaign/);
  assert.match(sql,/'first_used_at',g\.first_used_at/);
  assert.match(sql,/grant execute on function public\.export_my_data\(\) to authenticated/i);
});

test('cliente reivindica campanha uma vez, limpa marcador local e registra uso',async()=>{
  const storage=new MemoryStorage();
  captureCardAcquisition(storage,new Date('2026-10-01T18:00:00Z'));
  const calls=[];
  const client={rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='claim_card_acquisition')return {
      data:{benefit:{code:'CARD_PRO_GRANTED',active:true},entitlement:{source:'card',pro:true}},
      error:null
    };
    if(name==='mark_card_pro_usage')return {data:{recorded:true,first_use:true},error:null};
    return {data:null,error:{message:'unexpected'}};
  }};
  const claimed=await claimPendingCardAcquisition(client,storage);
  assert.equal(claimed.benefit.code,'CARD_PRO_GRANTED');
  assert.equal(readAcquisition(storage),null);
  const usage=await markCardBenefitUsed(client);
  assert.equal(usage.recorded,true);
  assert.deepEqual(calls.map(call=>call.name),['claim_card_acquisition','mark_card_pro_usage']);
});
test('apresentação deixa claro 30 dias, sem cobrança e retorno ao FREE',()=>{
  const active={
    status:'pro_active',pro:true,signedIn:true,source:'card',
    trial_used:true,trial_available:false,
    starts_at:'2026-10-01T18:00:00Z',ends_at:'2026-10-31T18:00:00Z'
  };
  const presentation=entitlementPresentation(active);
  assert.match(presentation.label,/CARTÃO 30 DIAS/);
  assert.match(presentation.description,/Sem cartão e sem cobrança automática/i);

  const expired=postTrialExperience({
    ...active,status:'pro_expired',pro:false,ends_at:'2026-09-30T18:00:00Z'
  });
  assert.equal(expired.visible,true);
  assert.match(expired.title,/30 dias PRO terminaram/i);
  assert.match(expired.message,/voltou ao PepDay FREE/i);
});

test('landing do cartão comunica exatamente a oferta aprovada',async()=>{
  const html=await read('cartao/index.html');
  assert.match(html,/30 dias de PepDay PRO grátis/i);
  assert.match(html,/Sem cartão .* Sem cobrança automática .* Benefício único por conta/i);
  assert.match(html,/substitui o teste padrão de 7 dias/i);
  assert.match(html,/volta ao FREE/i);
});
