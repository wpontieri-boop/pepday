const encoder=new TextEncoder();

function clean(value){return typeof value==='string'?value.trim():''}

export function parseSignature(header){
  const out={ts:'',v1:''};
  for(const part of clean(header).split(',')){
    const index=part.indexOf('=');
    if(index<1)continue;
    const key=part.slice(0,index).trim(),value=part.slice(index+1).trim();
    if(key==='ts')out.ts=value;
    if(key==='v1')out.v1=value;
  }
  return out;
}

export function signatureManifest({dataId='',requestId='',ts=''}) {
  const parts=[];
  const id=clean(String(dataId||'')).toLowerCase();
  const request=clean(requestId),stamp=clean(ts);
  if(id)parts.push(`id:${id};`);
  if(request)parts.push(`request-id:${request};`);
  if(stamp)parts.push(`ts:${stamp};`);
  return parts.join('');
}

function hexBytes(hex){
  if(!/^[a-f0-9]{64}$/i.test(hex))return null;
  return Uint8Array.from(hex.match(/../g).map(byte=>Number.parseInt(byte,16)));
}

export async function verifyMercadoPagoSignature({secret,xSignature,xRequestId,dataId,cryptoImpl=globalThis.crypto}){
  if(!clean(secret)||!cryptoImpl?.subtle)return false;
  const {ts,v1}=parseSignature(xSignature),signature=hexBytes(v1);
  if(!ts||!signature)return false;
  const manifest=signatureManifest({dataId,requestId:xRequestId,ts});
  if(!manifest)return false;
  try{
    const key=await cryptoImpl.subtle.importKey(
      'raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']
    );
    return await cryptoImpl.subtle.verify('HMAC',key,signature,encoder.encode(manifest));
  }catch{return false}
}

export function parsePepDayReference(value){
  const match=clean(String(value??'')).match(/^pepday:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?::(monthly|annual))?$/i);
  return match?{subscriptionId:match[1].toLowerCase(),plan:match[2]?.toLowerCase()||null}:null;
}

export function planFromCanonicalSubscription(preapproval,{monthlyPlanId='',annualPlanId=''}={}){
  const providerPlan=clean(String(preapproval?.preapproval_plan_id??''));
  if(providerPlan&&providerPlan===clean(monthlyPlanId))return 'monthly';
  if(providerPlan&&providerPlan===clean(annualPlanId))return 'annual';
  return parsePepDayReference(preapproval?.external_reference)?.plan||null;
}

export function paidPeriod(invoice,preapproval){
  const startRaw=invoice?.debit_date||invoice?.date_created;
  const endRaw=preapproval?.next_payment_date;
  const start=new Date(startRaw),end=new Date(endRaw);
  if(!startRaw||!endRaw||!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start)return null;
  return {start:start.toISOString(),end:end.toISOString()};
}

export function effectFromAuthorizedPayment(invoice,subscription){
  const status=clean(String(invoice?.payment?.status??invoice?.summarized??'')).toLowerCase();
  if(status==='approved')return 'payment_approved';
  if(['pending','in_process','authorized','scheduled'].includes(status))return 'payment_pending';
  if(['rejected','cancelled','canceled','refunded','charged_back'].includes(status)){
    return subscription?.started_at||['monthly','annual'].includes(subscription?.plan)
      ?'renewal_failed':'payment_rejected';
  }
  return null;
}

export function effectFromPreapproval(preapproval,subscription){
  const status=clean(String(preapproval?.status??'')).toLowerCase();
  if(status==='canceled'||status==='cancelled')return 'subscription_canceled';
  if(status==='paused')return 'subscription_paused';
  if(status==='pending')return 'payment_pending';
  if(status==='authorized'&&(subscription?.cancel_at_period_end===true||['canceled','paused'].includes(subscription?.provider_status))){
    return 'subscription_reactivated';
  }
  return null;
}

export function canonicalEventDate(body,resource){
  for(const value of [body?.date_created,resource?.last_modified,resource?.date_created]){
    if(!value)continue;
    const date=new Date(value);
    if(Number.isFinite(date.getTime()))return date.toISOString();
  }
  return null;
}

export function normalizeNotification(body,url){
  if(!body||typeof body!=='object')return null;
  const type=clean(String(body.type??''));
  if(!['subscription_preapproval','subscription_authorized_payment'].includes(type))return null;
  const eventId=clean(String(body.id??'')),action=clean(String(body.action??'')),bodyDataId=clean(String(body.data?.id??''));
  const queryDataId=clean(url.searchParams.get('data.id')||url.searchParams.get('data_id')||'');
  const dataId=queryDataId||bodyDataId;
  if(!eventId||!action||!dataId)return null;
  if(queryDataId&&bodyDataId&&queryDataId.toLowerCase()!==bodyDataId.toLowerCase())return null;
  return {eventId,type,action,dataId,liveMode:body.live_mode===true};
}
