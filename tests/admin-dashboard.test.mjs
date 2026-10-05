import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../site/admin/admin.mjs',import.meta.url),'utf8');
function render(environment='production'){
  const nodes=new Map();
  const context=vm.createContext({Intl,Date,config:{environment},document:{getElementById(id){
    if(!nodes.has(id))nodes.set(id,{textContent:''});return nodes.get(id);
  }}});
  vm.runInContext(source.slice(source.indexOf('const $='),source.indexOf('if(!globalThis.supabase'))+
    source.slice(source.indexOf('function renderPwaMetrics'),source.indexOf('function renderPromoCodes')),context);
  return {context,text:id=>nodes.get(id)?.textContent};
}
test('painel identifica PROD e TEST pela configuração e não promete campanha ativa',()=>{
  for(const [env,label] of [['production','produção'],['test','homologação']]){
    const r=render(env);r.context.renderMetrics({metrics_version:2,window_days:30});
    assert.match(r.text('environmentSummary'),new RegExp(label));
    assert.match(r.text('integrationsSummary'),/pendentes/);
  }
});
test('base mostra estados exclusivos e segmenta recuperação com consentimento',()=>{
  const r=render();r.context.renderMetrics({metrics_version:2,free_now:3,card_active_now:1,
    promo_active_now:2,paid_active_now:4,trial_active_now:5,recovery_card_eligible_now:2,
    recovery_trial_eligible_now:1,recovery_eligible_now:3,recovery_without_consent_now:6});
  for(const [id,value] of Object.entries({freeNow:'3',cardActiveNow:'1',promoActiveNow:'2',
    basePaidActive:'4',trialActive:'5',recoveryEligible:'3',recoveryWithoutConsent:'6'}))assert.equal(r.text(id),value);
  assert.equal(r.text('recoveryCardDetail'),'2 com consentimento');
});
test('backend antigo não reapresenta FREE incorreto ou inventa zeros nos novos campos',()=>{
  const r=render();r.context.renderMetrics({free_now:4});r.context.renderCardCampaign({qr_to_grant_percent:100});
  assert.equal(r.text('freeNow'),'—');assert.equal(r.text('cardActiveNow'),'—');
  assert.equal(r.text('cardTrialRate'),'—');assert.match(r.text('metricsStatus'),/atualização do banco/);
});
test('receita e recuperação só exibem valores fornecidos, distinguindo zero de indisponível',()=>{
  const r=render();r.context.renderMetrics({metrics_version:2,revenue_available:true,recovered_campaign_available:true});
  assert.equal(r.text('revenueReceived'),'—');assert.equal(r.text('campaignRecovered'),'—');
  r.context.renderMetrics({metrics_version:2,revenue_available:true,revenue_received:149.9,
    recovered_campaign_available:true,recovered_campaign_count:2,approved_charges_in_window:3});
  assert.match(r.text('revenueReceived'),/149,90/);assert.equal(r.text('campaignRecovered'),'2');
  assert.equal(r.text('approvedCharges'),'3');
});
test('taxas mostram coorte e base vazia permanece indisponível',()=>{
  const r=render();r.context.renderCardCampaign({metrics_version:2,qr_to_grant_percent:null,grant_to_paid_percent:null});
  assert.equal(r.text('cardTrialRate'),'—');
  r.context.renderCardCampaign({metrics_version:2,qr_to_grant_percent:100,grant_to_paid_percent:50,
    cohort_activated:1,cohort_attributed:1,cohort_paid:1,cohort_granted:2});
  assert.equal(r.text('cardTrialRate'),'100,0%');assert.equal(r.text('cardPaidRate'),'50,0%');
  assert.match(r.text('cardConversionBasis'),/1 de 2 benefícios/);
});
test('HTML mantém equipe intacta e não duplica IDs dos indicadores',async()=>{
  const html=await readFile(new URL('../site/admin/index.html',import.meta.url),'utf8');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size);
  assert.doesNotMatch(html,/quando Brevo e Mercado Pago estiverem ativos|quando o Mercado Pago for conectado/);
});
