import {config} from '../config.js';
const KEY='pepday.test.fsbqpyyprtymwrmzsacp.referral.v1';
const valid=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function isReferralTest(settings=config,location=globalThis.location){
  return settings.environment==='test'&&settings.projectRef==='fsbqpyyprtymwrmzsacp'&&location?.hostname==='homologacao.pepday.com.br';
}
// This capability is the only referral data kept across reload/auth/onboarding.
export function readReferralToken(storage=globalThis.localStorage){
  try{const token=storage?.getItem(KEY);return valid(token)?token:null}catch{return null}
}
export function forgetReferralToken(storage=globalThis.localStorage){try{storage?.removeItem(KEY)}catch{}}
export function saveReferralToken(token,storage=globalThis.localStorage){
  if(!valid(token))throw new Error('Indicação inválida.');
  try{storage.setItem(KEY,token);return true}catch{return false}
}
export async function referralAction(action,{ref='',source='link',confirmSwap=false,eventId=null,storage=globalThis.localStorage,fetcher=fetch}={}){
  const previous=readReferralToken(storage);
  // An explicit no-referral choice applies locally even if the network is unavailable.
  if(action==='clear')forgetReferralToken(storage);
  const res=await fetcher(config.supabaseUrl+'/functions/v1/partner-referral',{
    method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',
    body:JSON.stringify({action,ref,source,previous_token:previous||'',confirm_swap:confirmSwap,event_id:eventId})
  });
  if(!res.ok)throw new Error('Indicação temporariamente indisponível.');
  const data=await res.json();
  // Another tab may have replaced this capability while the request was pending.
  if(readReferralToken(storage)!==(action==='clear'?null:previous))return {...data,code:'LOCAL_SELECTION_CHANGED'};
  if(data.enabled===false){forgetReferralToken(storage);return data}
  if(data.token&&!saveReferralToken(data.token,storage))throw new Error('Permita o armazenamento do navegador para guardar a indicação. Você pode continuar sem ela.');
  if(action==='clear'||['INTENT_UNAVAILABLE','INTENT_EXPIRED_OR_MISSING'].includes(data.code))forgetReferralToken(storage);
  return data;
}
