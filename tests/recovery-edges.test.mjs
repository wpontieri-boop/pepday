import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../supabase/functions/recovery-worker/index.mjs';
import checkout from '../supabase/functions/recovery-checkout/index.mjs';
import {applyRecoveryBilling,reconcileRecoveryInvoice} from '../supabase/functions/mercado-pago-webhook/recovery-billing.mjs';
const id='10000000-0000-4000-8000-000000000001';
const testUrl='https://fsbqpyyprtymwrmzsacp.supabase.co';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
async function mocked(fn,fetcher,values={}){
  const oldDeno=globalThis.Deno,oldFetch=globalThis.fetch;
  const env={SUPABASE_URL:testUrl,MERCADO_PAGO_LIVE_MODE:'false',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_fixture',SUPABASE_ANON_KEY:'fixture_public',MERCADO_PAGO_TEST_PAYER_EMAIL:'sandbox@example.invalid',...values};
  globalThis.Deno={env:{get:key=>env[key]}};globalThis.fetch=fetcher;
  try{return await fn();}finally{globalThis.Deno=oldDeno;globalThis.fetch=oldFetch;}
}
const invocation=()=>new Request(testUrl+'/functions/v1/recovery-worker',{method:'POST',headers:{'x-pepday-invocation-token':id},body:'{}'});
test('recovery worker refuses PROD before any network request',async()=>{
  await mocked(async()=>assert.equal((await worker.fetch(invocation())).status,403),()=>{throw new Error('Unexpected network');},{SUPABASE_URL:'https://oslefjmwfnddxlotalxu.supabase.co'});
});
test('lost recovery webhook uses the existing idempotent canonical billing RPC',async()=>{
  let called=0;
  await mocked(()=>reconcileRecoveryInvoice(id,{id:'provider',external_reference:`pepday:${id}:monthly:recovery:${id}`,next_payment_date:'2026-11-05T18:00:00Z'},
    {id:'invoice-first',debit_date:'2026-10-05T18:00:00Z',date_created:'2026-10-05T18:00:00Z',payment:{status:'approved'}}),async(url,init)=>{
      called++;assert.match(String(url),/apply_billing_event$/);const body=JSON.parse(init.body);
      assert.equal(body.p_provider_event_id,'recovery-reconcile:invoice-first');assert.equal(body.p_subscription_id,id);
      assert.equal(body.p_plan,'monthly');assert.equal(body.p_effect,'payment_approved');assert.equal(body.p_period_end,'2026-11-05T18:00:00.000Z');return json({outcome:'applied'});
    });
  assert.equal(called,1);
});
test('worker invocation tokens cannot be replayed',async()=>{
  const calls=[];
  await mocked(async()=>assert.equal((await worker.fetch(invocation())).status,401),async url=>{calls.push(String(url));return json(false);});
  assert.equal(calls.length,1);assert.match(calls[0],/consume_recovery_invocation/);
});
for(const [scenario,allowed,transport] of [['consent revoked',false,'ok'],['delivery accepted',true,'ok'],['delivery uncertain',true,'timeout'],['provider rate limit',true,'rate']]){
  test('recovery send: '+scenario,async()=>{
    let claimed=false,sends=0,completion;
    await mocked(async()=>assert.equal((await worker.fetch(invocation())).status,200),async(url,init)=>{
      const path=new URL(url).pathname,body=JSON.parse(init.body||'{}');
      if(path.endsWith('consume_recovery_invocation'))return json(true);
      if(path.endsWith('prepare_recovery_campaigns'))return json({outcome:'prepared'});
      if(path.endsWith('recovery_provider_state'))return json({config:{},pending:[]});
      if(path.endsWith('claim_recovery_email')){if(claimed)return json({outcome:'empty'});claimed=true;
        return json({outcome:'claimed',id,campaign_id:id,recipient:{email:'fixture@example.invalid',name:'Fixture'},attempt:1,stage:'offer',source:'card',template_id:42,offer_expires_at:'2026-10-08T18:00:00Z'});}
      if(path.endsWith('validate_recovery_email'))return json(allowed);
      if(path==='/v3/smtp/email'){
        sends++;assert.equal(body.headers.idempotencyKey,id);assert.equal(body.templateId,42);
        assert.match(body.params.app_url,/homologacao.*recovery=1/);assert.deepEqual(body.tags,['pepday-test','recovery-v1','card','offer']);
        if(transport==='timeout')throw new Error('Simulated ambiguous transport');
        return transport==='rate'?json({code:'rate_limit'},429):json({messageId:'fixture-message'},201);
      }
      if(path.endsWith('complete_recovery_email')){completion=body;return json(null);}
      throw new Error('Unexpected endpoint '+path);
    });
    assert.equal(sends,allowed?1:0);
    assert.equal(completion.p_outcome,!allowed?'suppressed':transport==='timeout'?'dead':transport==='rate'?'retry':'sent');
  });
}
const checkoutRequest=plan=>new Request(testUrl+'/functions/v1/recovery-checkout',{method:'POST',headers:{Authorization:'Bearer fixture-jwt'},body:JSON.stringify({plan,request_id:id})});
for(const outcome of ['ineligible','reserved'])test('offer checkout: '+outcome,async()=>{
  let providerCalls=0,bound=false;
  const expiry=new Date(Math.floor((Date.now()+3600000)/1000)*1000).toISOString();
  await mocked(async()=>assert.equal((await checkout.fetch(checkoutRequest('monthly'))).status,outcome==='reserved'?200:409),async(url,init)=>{
    const path=new URL(url).pathname,body=JSON.parse(init?.body||'{}');
    if(path==='/auth/v1/user')return json({id,email:'fixture@example.invalid'});
    if(path==='/rest/v1/profiles')return json([{id,role:'user',is_adult_confirmed:true,terms_accepted_at:expiry,privacy_accepted_at:expiry,sensitive_data_consent_at:expiry}]);
    if(path==='/rest/v1/subscriptions')return json([{id}]);
    if(path.endsWith('reserve_recovery_offer')){assert.equal(body.p_user_id,id);return json({outcome,campaign_id:id,request_id:id,expires_at:expiry});}
    if(path.endsWith('claim_recovery_checkout'))return json(true);
    if(path==='/preapproval'){
      providerCalls++;assert.equal(init.headers['X-Idempotency-Key'],id);assert.equal(body.auto_recurring.transaction_amount,9.90);assert.equal(body.auto_recurring.end_date,expiry);
      assert.equal(body.payer_email,'sandbox@example.invalid');assert.match(body.external_reference,/:monthly:recovery:/);
      return json({id:'fixture-provider',init_point:'https://www.mercadopago.com.br/subscriptions/checkout?fixture=1',auto_recurring:body.auto_recurring});
    }
    if(path.endsWith('bind_recovery_checkout')){bound=true;return json(null);}
    throw new Error('Unexpected endpoint '+path);
  });
  assert.equal(providerCalls,outcome==='reserved'?1:0);assert.equal(bound,outcome==='reserved');
});
test('offer endpoint does not discount annual plan',async()=>{
  let calls=0;await mocked(async()=>assert.equal((await checkout.fetch(checkoutRequest('annual'))).status,400),async()=>{calls++;return json({id});});assert.equal(calls,1);
});
test('ordinary subscription webhook skips recovery entirely',async()=>{
  await mocked(()=>applyRecoveryBilling({id:'normal',external_reference:`pepday:${id}:monthly`},{payment:{status:'approved'}}),()=>{throw new Error('Unexpected network');});
});
test('first approved invoice resets amount and extends rolling renewal boundary before billing continues',async()=>{
  const calls=[];
  const updated=await mocked(()=>applyRecoveryBilling({id:'fixture',external_reference:`pepday:${id}:monthly:recovery:${id}`},{id:'invoice',payment:{status:'approved'},transaction_amount:9.90,debit_date:'2026-10-05T18:00:00Z'}),async(url,init)=>{
    const path=new URL(url).pathname,body=JSON.parse(init.body);calls.push(path);
    if(path.endsWith('record_recovery_payment'))return json({outcome:'converted',reset_needed:true});
    if(path==='/preapproval/fixture'){assert.deepEqual(body,{auto_recurring:{transaction_amount:14.90,currency_id:'BRL',end_date:'2026-12-06T18:00:00.000Z'}});return json(body);}
    if(path.endsWith('update_recovery_provider_state'))return json(null);
    throw new Error('Unexpected endpoint '+path);
  });
  assert.equal(updated.auto_recurring.transaction_amount,14.90);assert.equal(calls.length,3);
});
