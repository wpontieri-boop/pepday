import {isReferralTest,readReferralToken,forgetReferralToken} from './partner-referral.mjs';
const STORAGE_KEY='pepday.acquisition.v1';

function safeStorage(storage){
  try{
    storage.setItem('__pepday_test__','1');
    storage.removeItem('__pepday_test__');
    return storage;
  }catch{return null}
}

export function readAcquisition(storage=globalThis.localStorage){
  const target=safeStorage(storage);
  if(!target)return null;
  try{
    const value=JSON.parse(target.getItem(STORAGE_KEY)||'null');
    if(!value||value.source!=='card'||value.medium!=='qr'||value.campaign!=='cartao-v1'||value.landingPath!=='/cartao/')return null;
    if(typeof value.firstSeenAt!=='string'||!Number.isFinite(new Date(value.firstSeenAt).getTime()))return null;
    return Object.freeze({...value});
  }catch{return null}
}

export function captureCardAcquisition(storage=globalThis.localStorage,now=new Date()){
  const target=safeStorage(storage);
  if(!target)return null;
  const current=readAcquisition(target);
  if(current)return current;
  const date=now instanceof Date?now:new Date(now);
  const firstSeenAt=Number.isFinite(date.getTime())?date.toISOString():new Date().toISOString();
  const marker=Object.freeze({
    source:'card',
    medium:'qr',
    campaign:'cartao-v1',
    landingPath:'/cartao/',
    firstSeenAt
  });
  try{target.setItem(STORAGE_KEY,JSON.stringify(marker));return marker}catch{return null}
}

export async function claimPendingCardAcquisition(client,storage=globalThis.localStorage,{location=globalThis.location}={}){
  const marker=readAcquisition(storage);
  if(!marker||!client?.rpc)return null;
  const p2=isReferralTest(undefined,location),token=p2?readReferralToken(storage):null;
  const {data,error}=await client.rpc(p2?'claim_partner_card_acquisition':'claim_card_acquisition',{
    p_first_seen_at:marker.firstSeenAt,...(p2?{p_intent_token:token}:{})
  });
  if(error)throw error;
  if(data?.benefit?.code==='CARD_PRO_NEEDS_ONBOARDING')return data;
  try{safeStorage(storage)?.removeItem(STORAGE_KEY)}catch{}
  if(p2&&readReferralToken(storage)===token)forgetReferralToken(storage);
  return data||null;
}

export async function markCardBenefitUsed(client){
  if(!client?.rpc)return null;
  const {data,error}=await client.rpc('mark_card_pro_usage');
  if(error)throw error;
  return data||null;
}
