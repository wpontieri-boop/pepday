import {env,rpc,provider} from './backend.mjs';
import {recoveryEnvironment,recoveryAppUrl,introductoryRecurring,normalRecurringUpdate,resetConfirmed,recoveryMessage,recoveryParams} from './recovery-core.mjs';
import {deliveryDecision,validBrevoMessageId,validEmail} from '../brevo-email-worker/email-core.mjs';
import {reconcileRecoveryInvoice} from '../mercado-pago-webhook/recovery-billing.mjs';

async function brevo(path,method='GET',body){
  const response=await fetch('https://api.brevo.com/v3/'+path,{method,
    headers:{'api-key':env('BREVO_API_KEY'),'Content-Type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  return {status:response.status,data:await response.json().catch(()=>null)};
}
async function configureRecovery(environment,templates,providerReady){
  const name=environment==='test'?'configure_recovery_test':'configure_recovery';
  return await rpc(name,{p_templates:templates,p_provider_ready:providerReady});
}
async function setup(environment){
  const state=await rpc('recovery_provider_state');
  const templates={...state.config.template_ids};
  const original=await brevo('smtp/templates/'+env('BREVO_TEMPLATE_ACCOUNT_CREATED'));
  if(original.status!==200||!original.data?.sender?.email)throw new Error('RECOVERY_SENDER_NOT_CONFIGURED');
  const prefix=environment==='production'?'PepDay PROD recovery-v1':'PepDay TEST recovery-v1';
  for(const stage of ['warning','ended','resume','offer','last']){
    if(templates[stage])continue;
    const listing=await brevo('smtp/templates?limit=100&offset=0');
    const existing=listing.data?.templates?.find(t=>t.name===`${prefix} ${stage}`);
    if(existing){templates[stage]=existing.id;continue;}
    const message=recoveryMessage(stage,'trial');
    const text=message.text.replace(/teste de 7 dias/g,'{{params.benefit_name}}');
    const result=await brevo('smtp/templates','POST',{sender:{name:original.data.sender.name||'PepDay',email:original.data.sender.email},
      templateName:`${prefix} ${stage}`,subject:message.subject,isActive:true,
      htmlContent:`<html><body><p>Olá, {{params.name}}.</p><p>${text}</p><p><a href="{{params.app_url}}">Abrir minha conta PepDay</a></p><p>Você recebe esta mensagem porque autorizou comunicações de marketing. Desative esse consentimento no Perfil do PepDay quando quiser.</p></body></html>`});
    if(result.status!==201||!result.data?.id){
      const category=String(result.data?.message||'').match(/sender|email|html|template|subject|quota|limit|permission/i)?.[0]?.toUpperCase()||'UNKNOWN';
      throw new Error('RECOVERY_TEMPLATE_'+result.status+'_'+String(result.data?.code||'UNKNOWN').toUpperCase().replace(/[^A-Z0-9_]/g,'_')+'_'+category);
    }
    templates[stage]=result.data.id;
    await configureRecovery(environment,templates,false);
  }
  let ready=false,probeId=null,probeUpdate=null,probeCanceled=false;
  if(environment==='test'){
    const prior=await provider('/preapproval/search?external_reference=pepday-recovery-capability-probe&limit=100');
    for(const probe of prior.results||[]){
      if(probe.external_reference==='pepday-recovery-capability-probe'&&!['cancelled','canceled'].includes(probe.status))
        await provider('/preapproval/'+encodeURIComponent(probe.id),'PUT',{status:'cancelled'});
    }
    let created;
    try{
      created=await provider('/preapproval','POST',{reason:'PepDay TEST recovery capability probe (no charge)',
        payer_email:env('MERCADO_PAGO_TEST_PAYER_EMAIL'),external_reference:'pepday-recovery-capability-probe',
        auto_recurring:introductoryRecurring(new Date(Date.now()+71*3600000).toISOString()),
        back_url:recoveryAppUrl(environment),status:'pending'},crypto.randomUUID());
      if(!created.id||Number(created.auto_recurring?.transaction_amount)!==9.90)throw new Error('RECOVERY_INTRO_PRICE_NOT_CONFIRMED');
      const update=normalRecurringUpdate();
      const updated=await provider('/preapproval/'+encodeURIComponent(created.id),'PUT',update);
      probeUpdate={amount:updated.auto_recurring?.transaction_amount,currency:updated.auto_recurring?.currency_id};
      ready=resetConfirmed(updated);
      probeId=created.id;
    }finally{
      if(created?.id){await provider('/preapproval/'+encodeURIComponent(created.id),'PUT',{status:'cancelled'});probeCanceled=true;}
    }
  }else{
    const account=await provider('/users/me');
    ready=Boolean(account?.id);
  }
  await configureRecovery(environment,templates,ready);
  return {
    code:ready?(environment==='test'?'TEST_SETUP_READY':'PROD_SETUP_READY'):'PROVIDER_REQUIRES_VALIDATION',
    template_ids:templates,provider_ready:ready,
    ...(environment==='test'?{probe_id:probeId,probe_canceled:probeCanceled,probe_update:probeUpdate}:{provider_account_verified:ready})
  };
}
async function reconcile(){
  const state=await rpc('recovery_provider_state');let reset=0,canceled=0;
  for(const campaign of state.pending.slice(0,20)){
    try{
      let id=campaign.provider_subscription_id;
      if(!id){
        const reference=`pepday:${campaign.subscription_id}:monthly:recovery:${campaign.id}`;
        const search=await provider('/preapproval/search?external_reference='+encodeURIComponent(reference)+'&limit=100');
        const matches=(search.results||[]).filter(p=>p.external_reference===reference);
        if(matches.length!==1)continue;
        const found=matches[0];
        await rpc('recover_recovery_checkout',{p_campaign_id:campaign.id,p_provider_id:String(found.id),p_url:found.init_point});id=String(found.id);
      }
      const canonical=await provider('/preapproval/'+encodeURIComponent(id));
      const invoices=await provider('/authorized_payments/search?preapproval_id='+encodeURIComponent(id));
      const paid=(invoices.results||[]).filter(i=>i.payment?.status==='approved')
        .sort((a,b)=>new Date(a.debit_date||a.date_created)-new Date(b.debit_date||b.date_created));
      if(!campaign.redeemed_at&&paid.length){
        const first=paid.find(i=>Number(i.transaction_amount??i.payment?.transaction_amount)===9.90
          &&new Date(i.debit_date||i.date_created)>=new Date(campaign.offer_starts_at)
          &&new Date(i.debit_date||i.date_created)<new Date(campaign.offer_expires_at));
        if(first){
          const result=await rpc('record_recovery_payment',{p_provider_id:id,p_invoice_id:String(first.id),p_amount:9.90,p_paid_at:first.debit_date||first.date_created});
          if(['converted','duplicate'].includes(result.outcome))campaign.redeemed_at=first.debit_date||first.date_created;
        }
      }
      if(campaign.redeemed_at&&!['cancelled','canceled','paused'].includes(canonical.status)){
        const latest=paid.at(-1);const update=normalRecurringUpdate(latest?.debit_date||latest?.date_created||campaign.redeemed_at);
        const updated=resetConfirmed(canonical)?canonical:await provider('/preapproval/'+encodeURIComponent(id),'PUT',update);
        if(!resetConfirmed(updated))continue;
        await rpc('update_recovery_provider_state',{p_provider_id:id,p_outcome:'reset'});reset++;
        if(latest)await reconcileRecoveryInvoice(campaign.subscription_id,updated,latest);
      }else if(!campaign.redeemed_at){
        if(new Date(campaign.offer_expires_at)<=new Date()||campaign.stop_reason==='CONSENT_REVOKED'){
          await provider('/preapproval/'+encodeURIComponent(id),'PUT',{status:'cancelled'});
          await rpc('update_recovery_provider_state',{p_provider_id:id,p_outcome:'canceled'});canceled++;
        }else if(canonical.status==='authorized')await rpc('update_recovery_provider_state',{p_provider_id:id,p_outcome:'authorized'});
      }
      await rpc('mark_recovery_provider_checked',{p_campaign_id:campaign.id});
    }catch{console.error('PepDay recovery: PROVIDER_RECONCILIATION_RETRY');}
  }
  return {reset,canceled};
}
export default {async fetch(req){
  try{
    if(req.method!=='POST')return Response.json({code:'METHOD_NOT_ALLOWED'},{status:405});
    const environment=recoveryEnvironment(env('SUPABASE_URL'),env('MERCADO_PAGO_LIVE_MODE'));
    if(!environment)return Response.json({code:'ENVIRONMENT_MISMATCH'},{status:403});
    const token=req.headers.get('x-pepday-invocation-token')||'';
    if(!/^[0-9a-f-]{36}$/i.test(token)||!await rpc('consume_recovery_invocation',{p_token:token}))return Response.json({code:'INVALID_INVOCATION_TOKEN'},{status:401});
    const body=await req.json().catch(()=>({}));
    if(body.action==='setup')return Response.json(await setup(environment));
    await rpc('prepare_recovery_campaigns');
    const summary={...(await reconcile()),sent:0,skipped:0,failed:0};
    const workerId=crypto.randomUUID();
    for(let i=0;i<5;i++){
      const claim=await rpc('claim_recovery_email',{p_worker_id:workerId});
      if(['empty','provider_not_ready','template_missing'].includes(claim.outcome))break;
      if(claim.outcome!=='claimed'){summary.skipped++;continue;}
      let outcome='dead',messageId=null;
      if(validEmail(claim.recipient?.email)&&await rpc('validate_recovery_email',{p_id:claim.id,p_worker_id:workerId})){
        try{
          const result=await brevo('smtp/email','POST',{to:[claim.recipient],templateId:claim.template_id,
            params:{...recoveryParams(claim,recoveryAppUrl(environment)),benefit_name:claim.source==='card'?'cartão de 30 dias':'teste de 7 dias'},
            tags:[environment==='production'?'pepday-prod':'pepday-test','recovery-v1',claim.source,claim.stage],headers:{idempotencyKey:claim.id}});
          messageId=validBrevoMessageId(result.data?.messageId);
          outcome=result.status===201&&!messageId?'dead':deliveryDecision(result.status,claim.attempt).outcome;
        }catch{outcome='dead';}
      }else outcome='suppressed';
      await rpc('complete_recovery_email',{p_id:claim.id,p_worker_id:workerId,p_outcome:outcome,p_message_id:messageId});
      if(outcome==='sent')summary.sent++;else summary.failed++;
    }
    return Response.json({code:environment==='production'?'PROD_RECOVERY_COMPLETE':'TEST_RECOVERY_COMPLETE',...summary});
  }catch(error){
    const code=/^[A-Z0-9_]+$/.test(error.message)?error.message:'RECOVERY_WORKER_FAILED';
    console.error('PepDay recovery:',code);return Response.json({code},{status:503});
  }
}};
