// PepDay TEST — Meta webhook policy. No HTTP dispatch, Graph API calls or LLM use.
// Outbound templates are only offline drafts; partner inbound MUST NOT get responses.
const encoder=new TextEncoder();
const WA_ID=/^[1-9][0-9]{9,14}$/;
const MID=/^[a-zA-Z0-9_.:-]{8,240}$/;
const STATES=new Set(['sent','delivered','read','failed']);
const STOP=new Set(['PARAR','SAIR','CANCELAR']);
const TYPES=new Set(['initial','d2','d5','otp_auth']);
export const GATEWAY_MODE='test-offline-no-network';
function requireText(s,re,error){if(typeof s!=='string'||!re.test(s))throw Error(error);return s}
function bytesOf(raw){if(raw instanceof Uint8Array)return raw;if(raw instanceof ArrayBuffer)return new Uint8Array(raw);if(typeof raw==='string')return encoder.encode(raw);throw Error('META_RAW_BODY_REQUIRED')}
function safeEqual(a,b){if(typeof a!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
export async function verifyMetaSignature({rawBody,signature,appSecret}){
 if(typeof appSecret!=='string'||appSecret.length<24||typeof signature!=='string'||!/^sha256=[0-9a-fA-F]{64}$/.test(signature))return false;
 const raw=bytesOf(rawBody);if(!raw.length||raw.length>65536)return false;
 const key=await crypto.subtle.importKey('raw',encoder.encode(appSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const digest=new Uint8Array(await crypto.subtle.sign('HMAC',key,raw));
 return safeEqual(signature.slice(7).toLowerCase(),Array.from(digest,b=>b.toString(16).padStart(2,'0')).join(''));
}
function isStop(m){
 if(m?.type!=='text'||typeof m.text?.body!=='string')return false;
 const t=m.text.body.trim().toLocaleUpperCase('pt-BR');
 return t.length<=20&&STOP.has(t);
}
function safeOwnerText(m){
 if(m?.type!=='text'||typeof m.text?.body!=='string')return null;
 const t=m.text.body;
 return t&&t.length<=2000&&!/[\u0000-\u001f]/.test(t)?t:null;
}
// Injectable observers are all inert by default. Production must provide persistent
// deduplication and auth; this module never responds to a partner, even opt-out.
export async function classifyMetaWebhook({
 rawBody,signature,appSecret,phoneNumberId,wabaId,ownerWaId,partnerWaIds=new Set(),
 centralEnabled=false,ownerStepUp=false,
 onOptOut=async()=>{},onStatus=async()=>{},onOwner=async()=>{},
 eventIsNew=async()=>true
}){
 if(!await verifyMetaSignature({rawBody,signature,appSecret}))throw Error('META_SIGNATURE_DENIED');
 requireText(phoneNumberId,/^[0-9]{5,30}$/,'META_PHONE_ID_DENIED');
 requireText(wabaId,/^[0-9]{5,30}$/,'META_WABA_DENIED');
 if(!(partnerWaIds instanceof Set))throw Error('META_PARTNER_LIST_REQUIRED');
 let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytesOf(rawBody)))}catch{throw Error('META_JSON_INVALID')}
 if(data?.object!=='whatsapp_business_account'||!Array.isArray(data.entry)||data.entry.length>20)throw Error('META_STRUCTURE_DENIED');
 const summary={statuses:0,optOuts:0,owner:0,dropped:0};
 const seen=new Set();
 for(const entry of data.entry){
  if(entry?.id!==wabaId||!Array.isArray(entry.changes)||entry.changes.length>30)throw Error('META_ACCOUNT_DENIED');
  for(const c of entry.changes){
   if(c?.field!=='messages'||c.value?.messaging_product!=='whatsapp'||c.value?.metadata?.phone_number_id!==phoneNumberId)throw Error('META_CHANNEL_DENIED');
   const statuses=Array.isArray(c.value.statuses)?c.value.statuses:[];
   const messages=Array.isArray(c.value.messages)?c.value.messages:[];
   if(statuses.length>80||messages.length>80)throw Error('META_TOO_MANY_EVENTS');
   for(const s of statuses){
    if(!MID.test(s?.id||'')||!STATES.has(s?.status)){summary.dropped++;continue}
    const key='status:'+s.id+':'+s.status;
    if(seen.has(key)||!await eventIsNew(key)){summary.dropped++;continue}
    seen.add(key);
    await onStatus({messageId:s.id,state:s.status});
    summary.statuses++;
   }
   for(const m of messages){
    if(!MID.test(m?.id||'')||!WA_ID.test(m?.from||'')){summary.dropped++;continue}
    const key='message:'+m.id;
    if(seen.has(key)||!await eventIsNew(key)){summary.dropped++;continue}
    seen.add(key);
    const from=m.from;
    // Partner classification has precedence over owner allowlist on mistakes.
    if(partnerWaIds.has(from)){
     if(isStop(m)){await onOptOut({waId:from,reason:'keyword'});summary.optOuts++}
     else summary.dropped++;
     continue;
    }
    if(from===ownerWaId&&centralEnabled===true&&ownerStepUp===true){
     const text=safeOwnerText(m);
     if(text!==null){await onOwner({waId:from,messageId:m.id,text});summary.owner++;continue}
    }
    summary.dropped++;
   }
  }
 }
 return summary;
}
// Creates local template payloads ONLY. No network send, logging or persistence.
export function prepareMetaTemplate({
 kind,templateName,recipientE164,privateInviteLink,otpCode,
 consent=false,contactConfirmed=false,optedOut=false,
 explicitApproval=false,invitationActive=false,alreadyQueued=false
}){
 if(!TYPES.has(kind))throw Error('META_TEMPLATE_KIND_INVALID');
 if(!consent||!contactConfirmed||optedOut||!explicitApproval||!invitationActive||alreadyQueued)throw Error('META_SEND_BLOCKED');
 requireText(templateName,/^[a-z][a-z0-9_]{2,120}$/,'META_TEMPLATE_NAME_INVALID');
 const to=requireText(recipientE164,/^\+[1-9][0-9]{9,14}$/,'META_PHONE_INVALID').slice(1);
 let value;
 if(kind==='otp_auth')value=requireText(otpCode,/^[0-9]{6}$/,'META_OTP_INVALID');
 else{
  let link;try{link=new URL(String(privateInviteLink||''))}catch{throw Error('META_LINK_INVALID')}
  if(link.origin!=='https://homologacao.pepday.com.br'||link.protocol!=='https:'||link.username||link.password||link.pathname!=='/parceiros/convite/'||link.search||!/^#invite=[A-Za-z0-9_-]{43,128}$/.test(link.hash))throw Error('META_LINK_INVALID');
  value=link.href;
 }
 return Object.freeze({kind,simulation:true,neverSend:true,payload:{messaging_product:'whatsapp',to,type:'template',template:{name:templateName,language:{code:'pt_BR'},components:[{type:'body',parameters:[{type:'text',text:value}]}]}}});
}
