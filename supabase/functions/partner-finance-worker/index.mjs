import {env,rpc} from '../recovery-worker/backend.mjs';
import {testEnvironment,reconcileSource} from './finance-core.mjs';
// No POST/PUT/DELETE call to Mercado Pago exists in this worker.
async function get(path,extraHeaders={}){
 const response=await fetch('https://api.mercadopago.com'+path,{headers:{Authorization:'Bearer '+env('MERCADO_PAGO_ACCESS_TOKEN'),...extraHeaders},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('CANONICAL_PROVIDER_UNAVAILABLE');return response.json();
}
export default {async fetch(req){
 const headers={'Cache-Control':'no-store'};
 if(!testEnvironment(env('SUPABASE_URL'),env('MERCADO_PAGO_LIVE_MODE')))return Response.json({code:'TEST_ONLY'},{status:403,headers});
 if(req.method!=='POST')return Response.json({code:'METHOD_NOT_ALLOWED'},{status:405,headers});
 const token=req.headers.get('x-pepday-invocation-token')||'';
 if(!/^[0-9a-f-]{36}$/.test(token))return Response.json({code:'INVALID_INVOCATION'},{status:401,headers});
 try{
  if(!await rpc('consume_partner_finance_invocation',{p_token:token}))return Response.json({code:'INVALID_INVOCATION'},{status:401,headers});
  const sources=await rpc('partner_finance_sources'),summary={sources:sources.length,reconciled:0,review:0};
  // Server rotates a bounded batch, including sources with failed reconciliation.
  for(const source of sources.slice(0,20)){
   try{const result=await reconcileSource(source,{get,ingest:(id,p)=>rpc('partner_ingest_payment',{p_subscription:id,p_payment:p}),release:id=>rpc('partner_release_commissions',{p_partner:id})});if(result.history_complete)summary.reconciled++;else{await rpc('partner_finance_source_failed',{p_subscription:source.subscription_id});summary.review++}}
   catch{await rpc('partner_finance_source_failed',{p_subscription:source.subscription_id});summary.review++}
  }
  return Response.json({code:'TEST_FINANCE_COMPLETE',...summary},{headers});
 }catch{return Response.json({code:'FINANCE_UNAVAILABLE'},{status:503,headers})}
}};
