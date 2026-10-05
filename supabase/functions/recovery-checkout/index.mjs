import {env,rpc,provider,secretKey,backendHeaders} from '../recovery-worker/backend.mjs';
import {recoveryEnvironment,recoveryAppUrl,introductoryRecurring} from '../recovery-worker/recovery-core.mjs';
import {normalizeCheckoutRequest,checkoutExternalReference,validCheckoutUrl} from '../mercado-pago-checkout/checkout-core.mjs';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Cache-Control':'no-store'};
const response=(status,code,extra={})=>Response.json({code,...extra},{status,headers:cors});
async function lookup(table,field,id,select){
  const url=new URL('/rest/v1/'+table,env('SUPABASE_URL'));
  url.searchParams.set(field,'eq.'+id);url.searchParams.set('select',select);
  const res=await fetch(url,{headers:backendHeaders(secretKey()),signal:AbortSignal.timeout(15000)});
  if(!res.ok)throw new Error('ACCOUNT_LOOKUP_FAILED');const rows=await res.json();
  if(rows.length!==1)throw new Error('ACCOUNT_STATE_INVALID');return rows[0];
}
export default {async fetch(req){
  try{
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
    if(req.method!=='POST')return response(405,'METHOD_NOT_ALLOWED');
    const environment=recoveryEnvironment(env('SUPABASE_URL'),env('MERCADO_PAGO_LIVE_MODE'));
    if(!environment)return response(403,'ENVIRONMENT_MISMATCH');
    const authorization=req.headers.get('authorization')||'';
    if(!/^Bearer [^\s]+$/.test(authorization))return response(401,'AUTH_REQUIRED');
    const publishable=env('SUPABASE_PUBLISHABLE_KEYS')?JSON.parse(env('SUPABASE_PUBLISHABLE_KEYS')).default:env('SUPABASE_ANON_KEY');
    const auth=await fetch(new URL('/auth/v1/user',env('SUPABASE_URL')),{headers:{apikey:publishable,Authorization:authorization},signal:AbortSignal.timeout(15000)});
    if(!auth.ok)return response(401,'AUTH_INVALID');
    const user=await auth.json();
    const request=normalizeCheckoutRequest(await req.json());
    if(!request||request.plan!=='monthly')return response(400,'MONTHLY_OFFER_ONLY');
    const [profile,subscription]=await Promise.all([
      lookup('profiles','id',user.id,'id,role,is_adult_confirmed,terms_accepted_at,privacy_accepted_at,sensitive_data_consent_at'),
      lookup('subscriptions','user_id',user.id,'id')]);
    if(profile.role==='admin'||!profile.is_adult_confirmed||!profile.terms_accepted_at||!profile.privacy_accepted_at||!profile.sensitive_data_consent_at)return response(409,'PROFILE_INCOMPLETE');
    const offer=await rpc('reserve_recovery_offer',{p_user_id:user.id,p_request_id:request.requestId});
    if(offer.outcome!=='reserved')return response(409,'OFFER_INELIGIBLE');
    if(offer.checkout_url&&validCheckoutUrl(offer.checkout_url))return response(200,'CHECKOUT_READY',{checkout_url:offer.checkout_url});
    if(!await rpc('claim_recovery_checkout',{p_campaign_id:offer.campaign_id}))return response(409,'CHECKOUT_IN_PROGRESS');
    const recurring=introductoryRecurring(offer.expires_at);
    if(!recurring)return response(409,'OFFER_EXPIRED');
    const payer=environment==='test'?env('MERCADO_PAGO_TEST_PAYER_EMAIL'):String(user.email||'').trim();
    if(!payer)return response(503,environment==='test'?'TEST_PAYER_NOT_CONFIGURED':'PAYER_EMAIL_NOT_AVAILABLE');
    const checkout=await provider('/preapproval','POST',{
      reason:'PepDay PRO: R$9,90 primeiro mês; depois R$14,90/mês',payer_email:payer,
      external_reference:checkoutExternalReference(subscription.id,'monthly')+':recovery:'+offer.campaign_id,auto_recurring:recurring,
      back_url:recoveryAppUrl(environment)+'?recovery=1',status:'pending'
    },offer.request_id);
    if(!checkout.id||!validCheckoutUrl(checkout.init_point)||Number(checkout.auto_recurring?.transaction_amount)!==9.90){
      if(checkout.id)await provider('/preapproval/'+encodeURIComponent(checkout.id),'PUT',{status:'cancelled'});
      return response(503,'INTRODUCTORY_CONTRACT_NOT_CONFIRMED');
    }
    try{await rpc('bind_recovery_checkout',{p_campaign_id:offer.campaign_id,p_provider_id:String(checkout.id),p_url:checkout.init_point});}
    catch(error){await provider('/preapproval/'+encodeURIComponent(checkout.id),'PUT',{status:'cancelled'});throw error;}
    return response(200,'CHECKOUT_READY',{checkout_url:checkout.init_point,first_price:9.90,recurring_price:14.90,expires_at:offer.expires_at});
  }catch(error){const code=/^[A-Z0-9_]+$/.test(error.message)?error.message:'RECOVERY_CHECKOUT_FAILED';
    console.error('PepDay recovery checkout:',code);return response(503,code);}
}};
