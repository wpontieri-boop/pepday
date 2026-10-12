// TEST-only HTTP wrapper, fail closed. No Graph API dispatch, provider tokens,
// webhook owner delivery or partner reply path. Nothing is enabled by default.
import {classifyMetaWebhook} from './gateway-core.mjs';
const isText=(value,min=1,max=200)=>typeof value==='string'&&value.length>=min&&value.length<=max;
const denied=(status=403)=>new Response(null,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const jsonOk=()=>new Response('{"ok":true}',{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
async function smallRaw(request,max=65536){
 const reader=request.body?.getReader();if(!reader)throw Error('META_BODY_REQUIRED');
 const blocks=[];let count=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;count+=value.length;if(count>max){await reader.cancel();throw Error('META_BODY_TOO_LARGE')}blocks.push(value)}}finally{reader.releaseLock()}
 const out=new Uint8Array(count);let offset=0;for(const value of blocks){out.set(value,offset);offset+=value.length}return out;
}
function safeTokenMatch(actual,expected){
 if(!isText(actual)||!isText(expected)||actual.length!==expected.length)return false;
 let delta=0;for(let i=0;i<actual.length;i++)delta|=actual.charCodeAt(i)^expected.charCodeAt(i);
 return delta===0;
}
export function metaHttpHandler({mode='disabled',appSecret='',verifyToken='',phoneNumberId='',wabaId='',ownerWaId='',partnerWaIds=new Set(),
 onOptOut=async()=>{},onStatus=async()=>{},onOwner=async()=>{},eventIsNew=async()=>true,
 centralEnabled=false,ownerStepUp=false,processWebhook=classifyMetaWebhook}={}){
 return async request=>{
  // This endpoint is NOT an onboarding activation switch. Mode is test-only
  // and cannot be changed with a request body, header or query parameter.
  if(mode!=='test_synthetic'||!isText(appSecret,24)||!isText(verifyToken,24)||
    !/^[0-9]{5,30}$/.test(phoneNumberId)||!/^[0-9]{5,30}$/.test(wabaId))return denied(503);
  let url;try{url=new URL(request.url)}catch{return denied(400)}
  if(url.pathname!=='/functions/v1/meta-whatsapp-gateway')return denied(404);
  if(request.method==='GET'){
   if(url.searchParams.size!==3||url.searchParams.get('hub.mode')!=='subscribe'||
      !safeTokenMatch(url.searchParams.get('hub.verify_token'),verifyToken))return denied();
   const challenge=url.searchParams.get('hub.challenge');
   if(!isText(challenge,1,256)||/[\u0000-\u001f]/.test(challenge))return denied();
   return new Response(challenge,{status:200,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
  }
  if(request.method!=='POST')return denied(405);
  if(url.search)return denied(400);
  if(!(request.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))return denied(415);
  const signature=request.headers.get('x-hub-signature-256');
  try{
   const rawBody=await smallRaw(request);
   await processWebhook({rawBody,signature,appSecret,phoneNumberId,wabaId,ownerWaId,partnerWaIds,
    centralEnabled,ownerStepUp,onOptOut,onStatus,onOwner,eventIsNew});
   return jsonOk();
  }catch{return denied()}
 };
}
