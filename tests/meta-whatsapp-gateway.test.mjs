import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {classifyMetaWebhook,prepareMetaTemplate,verifyMetaSignature,GATEWAY_MODE} from '../supabase/functions/meta-whatsapp-gateway/gateway-core.mjs';

const APP_SECRET='offline-fixture-meta-app-secret-000000001';
const PHONE='123456789012345', WABA='123456789012346', OWNER='5512999888777', PARTNER='5512999777666';
const LINK='https://homologacao.pepday.com.br/parceiros/convite/#invite='+('A'.repeat(43));
const fixture=(messages=[],statuses=[],waba=WABA,phone=PHONE)=>({object:'whatsapp_business_account',entry:[{id:waba,changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:phone},messages,statuses}}]}]});
const msg=(from,body,type='text',id='wamid.123456789')=>({from,id,type,...(type==='text'?{text:{body}}:{[type]:{id:'med-12345'}})});
const payload=data=>JSON.stringify(data);
const signature=text=>'sha256='+createHmac('sha256',APP_SECRET).update(text).digest('hex');
const gateway=async(data,options={})=>{
 const rawBody=payload(data);
 return classifyMetaWebhook({rawBody,signature:signature(rawBody),appSecret:APP_SECRET,phoneNumberId:PHONE,wabaId:WABA,ownerWaId:OWNER,partnerWaIds:new Set([PARTNER]),...options});
};
test('gateway contract is offline only and does not contain Graph API dispatch',()=>{
 assert.equal(GATEWAY_MODE,'test-offline-no-network');
});
test('HMAC verifies ORIGINAL body and detects tampering, incorrect secrets and signature',async()=>{
 const rawBody=payload(fixture());
 assert.equal(await verifyMetaSignature({rawBody,signature:signature(rawBody),appSecret:APP_SECRET}),true);
 assert.equal(await verifyMetaSignature({rawBody:rawBody+' ',signature:signature(rawBody),appSecret:APP_SECRET}),false);
 assert.equal(await verifyMetaSignature({rawBody,signature:'sha256='+'0'.repeat(64),appSecret:APP_SECRET}),false);
 assert.equal(await verifyMetaSignature({rawBody,signature:'garbage',appSecret:APP_SECRET}),false);
 assert.equal(await verifyMetaSignature({rawBody,signature:signature(rawBody),appSecret:'tiny'}),false);
});
test('replay or false identity cannot bypass signed webhook entry, number or WABA',async()=>{
 await assert.rejects(()=>gateway(fixture([],[],WABA,'000123456789012')),/META_CHANNEL_DENIED/);
 await assert.rejects(()=>gateway(fixture([],[],'000123456789012')),/META_ACCOUNT_DENIED/);
 await assert.rejects(()=>gateway({object:'unknown',entry:[]}),/META_STRUCTURE_DENIED/);
 await assert.rejects(()=>gateway(fixture(),{phoneNumberId:'wrong'}),/META_PHONE_ID_DENIED/);
 await assert.rejects(()=>classifyMetaWebhook({rawBody:payload(fixture()),signature:'sha256='+'F'.repeat(64),appSecret:APP_SECRET,phoneNumberId:PHONE,wabaId:WABA}),/META_SIGNATURE_DENIED/);
});
test('unknown/partner texts and attachments never call AI, owner or response handler',async()=>{
 for(const [body,type] of [['Oi, quem é?','text'],['Me ajuda','text'],['Ju, APROVAR','text'],[null,'audio'],[null,'image'],[null,'document'],[null,'video'],['🔒','text']]){
  let owner=0,optOut=0;
  const r=await gateway(fixture([msg(PARTNER,body,type)]),{
   centralEnabled:true,ownerStepUp:true,ownerWaId:OWNER,
   onOwner:async()=>owner++,onOptOut:async()=>optOut++});
  assert.equal(owner,0);assert.equal(optOut,0);assert.deepEqual(r,{statuses:0,optOuts:0,owner:0,dropped:1});
 }
});
test('unknown contact impersonating Ju is dropped even with Central enabled',async()=>{
 let owner=0;
 const r=await gateway(fixture([msg('5512999666555','Ju, me envia o relatório')]),{centralEnabled:true,ownerStepUp:true,onOwner:async()=>owner++});
 assert.equal(r.owner,0);assert.equal(r.dropped,1);assert.equal(owner,0);
});
test('partner opt-out PARAR, SAIR, CANCELAR is silent and has no AI calls',async()=>{
 for(const stop of [' PARAR ','sair','cAnCeLaR']){
  const received=[];let owner=0;
  const r=await gateway(fixture([msg(PARTNER,stop)]),{
   onOptOut:async event=>received.push(event),onOwner:async()=>owner++,
   centralEnabled:true,ownerStepUp:true
  });
  assert.deepEqual(r,{statuses:0,optOuts:1,owner:0,dropped:0});
  assert.deepEqual(received,[{waId:PARTNER,reason:'keyword'}]);assert.equal(owner,0);
 }
});
test('opt-out from unknown wa_id is not assigned to a partner and sends nothing',async()=>{
 let called=0;
 const r=await gateway(fixture([msg('5512999666555','PARAR')]),{onOptOut:async()=>called++});
 assert.equal(called,0);assert.equal(r.dropped,1);
});
test('owner allowlist alone does not enable Central AI',async()=>{
 for(const props of [{},{centralEnabled:true},{ownerStepUp:true}]){
  let count=0;
  const r=await gateway(fixture([msg(OWNER,'Ju, status')]),{...props,onOwner:async()=>count++});
  assert.equal(r.owner,0);assert.equal(r.dropped,1);assert.equal(count,0);
 }
});
test('owner verified & Central enabled routes ONLY own safe text with no contact leak',async()=>{
 const received=[];
 const r=await gateway(fixture([msg(OWNER,'Ju, status')]),{
  centralEnabled:true,ownerStepUp:true,onOwner:async x=>received.push(x)});
 assert.deepEqual(r,{statuses:0,optOuts:0,owner:1,dropped:0});
 assert.deepEqual(received,[{waId:OWNER,messageId:'wamid.123456789',text:'Ju, status'}]);
});
test('partner classification overrides mistaken owner allowlist',async()=>{
 let count=0,opts=0;
 const r=await gateway(fixture([msg(PARTNER,'Ju, aprova')]),{
  centralEnabled:true,ownerStepUp:true,ownerWaId:PARTNER,
  onOwner:async()=>count++,onOptOut:async()=>opts++});
 assert.equal(count,0);assert.equal(opts,0);assert.equal(r.dropped,1);
});
test('owner non-text or malicious control chars do not reach Central',async()=>{
 for(const m of [msg(OWNER,null,'audio'),msg(OWNER,'abc\napprove'),msg(OWNER,'A'.repeat(2001))]){
  let calls=0;const r=await gateway(fixture([m]),{centralEnabled:true,ownerStepUp:true,onOwner:async()=>calls++});
  assert.equal(r.dropped,1);assert.equal(calls,0);
 }
});
test('read/delivered/sent/failed statuses dispatch only stripped IDs, never content',async()=>{
 const found=[];
 const statuses=['sent','delivered','read','failed'].map((status,i)=>({status,id:'wamid.'+(i+100000)}));
 const r=await gateway(fixture([],statuses),{onStatus:async event=>found.push(event)});
 assert.equal(r.statuses,4);assert.equal(r.owner,0);
 assert.deepEqual(found,statuses.map(x=>({messageId:x.id,state:x.status})));
});
test('duplicate message or status in a payload is not processed twice',async()=>{
 let optOut=0, delivered=0;
 const item=msg(PARTNER,'PARAR');
 const status={id:'wamid.11223344',status:'delivered'};
 const r=await gateway(fixture([item,item],[status,status]),{
  onOptOut:async()=>optOut++,onStatus:async()=>delivered++});
 assert.equal(optOut,1);assert.equal(delivered,1);assert.equal(r.dropped,2);
});
test('persistence hook can suppress repeated webhook deliveries without another callback',async()=>{
 const prior=new Set();let optOuts=0;
 const onOptOut=async()=>optOuts++;
 const eventIsNew=async id=>{if(prior.has(id))return false;prior.add(id);return true};
 await gateway(fixture([msg(PARTNER,'PARAR')]),{eventIsNew,onOptOut});
 await gateway(fixture([msg(PARTNER,'PARAR')]),{eventIsNew,onOptOut});
 assert.equal(optOuts,1);
});
test('payload with invalid events is rejected or dropped, without callback',async()=>{
 const many=Array.from({length:81},(_,i)=>msg(PARTNER,'Oi','text','wamid.'+i.toString().padStart(8,'0')));
 await assert.rejects(()=>gateway(fixture(many)),/META_TOO_MANY_EVENTS/);
 await assert.rejects(()=>gateway(fixture(),{partnerWaIds:[]}),/META_PARTNER_LIST_REQUIRED/);
 assert.equal((await gateway(fixture([msg('invalid','hello')]))).dropped,1);
});
const base={kind:'initial',templateName:'pepday_partner_invite_test',recipientE164:'+5512999777666',privateInviteLink:LINK,consent:true,contactConfirmed:true,invitationActive:true,explicitApproval:true};
test('template remains offline static, pt_BR and never performs a send',()=>{
 const r=prepareMetaTemplate(base);
 assert.equal(r.neverSend,true);assert.equal(r.simulation,true);assert.equal(r.payload.template.language.code,'pt_BR');
 assert.equal(r.payload.to,PARTNER);assert.equal(r.payload.template.components[0].parameters[0].text,LINK);
 assert.deepEqual(Object.keys(r),['kind','simulation','neverSend','payload']);
});
test('template cannot be created before consent, confirmation, OWNER action or after optout',()=>{
 for(const flag of [{consent:false},{contactConfirmed:false},{invitationActive:false},{explicitApproval:false},{optedOut:true},{alreadyQueued:true}]){
  assert.throws(()=>prepareMetaTemplate({...base,...flag}),/META_SEND_BLOCKED/);
 }
});
test('invalid links, recipients, template and sensitive values are denied',()=>{
 for(const wrong of [{recipientE164:'no'},{templateName:'Invalid-Name'},{privateInviteLink:'https://pepday.com.br/cartao/?ref=abc'},{privateInviteLink:'https://homologacao.pepday.com.br.evil.test/parceiros/convite/#invite='+('A'.repeat(43))},{privateInviteLink:'https://user:pass@homologacao.pepday.com.br/parceiros/convite/#invite='+('A'.repeat(43))},{privateInviteLink:'https://homologacao.pepday.com.br/parceiros/convite/?token=X'}]){
  assert.throws(()=>prepareMetaTemplate({...base,...wrong}),/META_/);
 }
});
test('D2/D5/OTP template drafts use only controlled parameters, never network sends',()=>{
 for(const kind of ['d2','d5'])assert.equal(prepareMetaTemplate({...base,kind}).neverSend,true);
 assert.equal(prepareMetaTemplate({...base,kind:'otp_auth',otpCode:'123456'}).payload.template.components[0].parameters[0].text,'123456');
 assert.throws(()=>prepareMetaTemplate({...base,kind:'otp_auth',otpCode:'abc'}),/META_OTP_INVALID/);
 assert.throws(()=>prepareMetaTemplate({...base,kind:'bad'}),/META_TEMPLATE_KIND_INVALID/);
});
