// Synthetic persistent ingress only. Whole payload validates before one atomic database RPC.
import {classifyMetaWebhook} from './gateway-core.mjs';
import {metaHttpHandler} from './http-core.mjs';
const TEST_URL='https://fsbqpyyprtymwrmzsacp.supabase.co';
const digest=async t=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t))),b=>b.toString(16).padStart(2,'0')).join('');
export function persistentMetaHandler({url,secret,config={},contactBindings=new Map(),fetcher=fetch}={}){
 if(url!==TEST_URL||!secret||!(contactBindings instanceof Map))return async()=>new Response(null,{status:503});
 // Mapping comes from trusted server configuration, never from webhook/body/headers.
 for(const [wa,label] of contactBindings)if(!/^[1-9][0-9]{9,14}$/.test(wa)||!/^QA-CONTACT-[A-Z0-9_-]{1,40}$/.test(label))throw Error('META_SYNTHETIC_BINDING_DENIED');
 return metaHttpHandler({...config,centralEnabled:false,ownerStepUp:false,ownerWaId:'',
 processWebhook:async opts=>{
  const events=[];let current=null;
  await classifyMetaWebhook({...opts,centralEnabled:false,ownerStepUp:false,ownerWaId:'',partnerWaIds:new Set(contactBindings.keys()),
   eventIsNew:async key=>{current={event_hash:await digest(key),kind:'drop'};events.push(current);return true},
   onOptOut:async e=>{current.kind='opt_out';current.contact_label=contactBindings.get(e.waId)},
   onStatus:async e=>{current.kind='status';current.delivery_hash=await digest(e.messageId);current.state=e.state},
   onOwner:async()=>{throw Error('META_CENTRAL_DISABLED')}
  });
  if(events.length>100)throw Error('META_BATCH_TOO_LARGE');
  const response=await fetcher(TEST_URL+'/rest/v1/rpc/partner_whatsapp_ingest_test',{method:'POST',
   headers:{apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({p_events:events})});
  if(!response.ok)throw Error('META_PERSISTENCE_FAILED');
  const result=await response.json();
  if(result?.ok!==true||result.real_send!==false||result.reply_count!==0||result.ai_calls!==0)throw Error('META_PERSISTENCE_FAILED');
 }
 });
}
