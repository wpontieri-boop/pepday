import test from 'node:test';
import assert from 'node:assert/strict';
import {eligibleReminder,makeManualInviteDraft,makeReminderDraft,validPrivateInviteLink} from '../src/partner-onboarding-policy.mjs';

const TOKEN='A'.repeat(54);
const link='https://homologacao.pepday.com.br/parceiros/convite/#invite='+TOKEN;
const base={role:'owner',partnerStatus:'draft',whatsappOptIn:true,contactConfirmed:true,phoneE164:'+5512999998888',privateInviteLink:link,publicName:'Parceiro de teste',explicitOperatorClick:true};
const reminder={status:'pending',whatsappOptIn:true,contactConfirmed:true,sentAt:'2026-10-10T12:00:00.000Z',expiresAt:'2026-10-17T12:00:00.000Z',events:['initial']};

test('never create WhatsApp sharing without explicit human click',()=>{
 assert.throws(()=>makeManualInviteDraft({...base,explicitOperatorClick:false}),/EXPLICIT_ACTION/);
 assert.throws(()=>makeManualInviteDraft({...base,explicitOperatorClick:undefined}),/EXPLICIT_ACTION/);
});
test('commercial role, DRAFT, opt-in and confirmed contact required',()=>{
 for(const value of [{role:'viewer'},{partnerStatus:'active'},{whatsappOptIn:false},{contactConfirmed:false},{optedOut:true}]){
  assert.throws(()=>makeManualInviteDraft({...base,...value}),/PERMISSION_REQUIRED/);
 }
});
test('never use public referral QR or other host as private invite',()=>{
 for(const unsafe of ['https://homologacao.pepday.com.br/cartao/?ref=teste',
 'https://pepday.com.br/parceiros/convite/#invite='+TOKEN,
 'http://homologacao.pepday.com.br/parceiros/convite/#invite='+TOKEN,
 'https://homologacao.pepday.com.br.evil.test/parceiros/convite/#invite='+TOKEN,
 'https://homologacao.pepday.com.br/parceiros/convite/?token='+TOKEN,
 'https://homologacao.pepday.com.br/parceiros/convite/#invite=short',
 'javascript:alert(1)'])
  assert.throws(()=>validPrivateInviteLink(unsafe),/LINK_INVALID/);
});
test('manual share draft is local; no network send, no PII and opt out present',()=>{
 const x=makeManualInviteDraft(base);
 assert.match(x.shareUrl,/^https:\/\/wa\.me\/5512999998888\?text=/);
 assert.match(decodeURIComponent(x.shareUrl),/confirme sua identidade/);
 assert.match(x.message,/PARAR/);
 assert.doesNotMatch(x.message,/CPF|PIX|senha do Admin/);
 assert.equal(validPrivateInviteLink(link),link);
});
test('reject sensitive labels, wrong phones and unsafe input',()=>{
 assert.throws(()=>makeManualInviteDraft({...base,publicName:'CPF 12345678901'}),/INVALID_NAME/);
 assert.throws(()=>makeManualInviteDraft({...base,phoneE164:'000'}),/PHONE_INVALID/);
});
test('48h and 5d thresholds respect UTC clock and never trigger early',()=>{
 assert.equal(eligibleReminder({...reminder,now:new Date('2026-10-12T11:59:59Z')}),null);
 assert.equal(eligibleReminder({...reminder,now:new Date('2026-10-12T12:00:00Z')}),'d2');
 assert.equal(eligibleReminder({...reminder,now:new Date('2026-10-15T12:00:00Z')}),'d5');
});
test('idempotency: no D2 duplicate, no D5 duplicate and no tardy D2 after D5',()=>{
 assert.equal(eligibleReminder({...reminder,now:'2026-10-13T00:00:00Z',events:['initial','d2']}),null);
 assert.equal(eligibleReminder({...reminder,now:'2026-10-15T12:00:00Z',events:['initial','d2']}),'d5');
 assert.equal(eligibleReminder({...reminder,now:'2026-10-16T12:00:00Z',events:['initial','d5']}),null);
});
test('stop reminders after opted-out, revoked, completed, not verified or token expiry',()=>{
 for(const patch of [{optedOut:true},{revoked:true},{completed:true},{status:'completed'},{status:'revoked'},{whatsappOptIn:false},{contactConfirmed:false},{expiresAt:'2026-10-14T12:00:00Z'}]){
  assert.equal(eligibleReminder({...reminder,...patch,now:'2026-10-16T00:00:00Z'}),null);
 }
});
test('missing or invalid dates/events fail closed, no spam',()=>{
 for(const patch of [{sentAt:''},{expiresAt:''},{events:['surprise']},{events:undefined}]){
  const actual=eligibleReminder({...reminder,...patch,now:'2026-10-16T00:00:00Z'});
  assert.equal(actual,null);
 }
});
test('reminders are text-only drafts, not sending mechanism',()=>{
 assert.match(makeReminderDraft({type:'d2',privateInviteLink:link,publicName:'Parceiro de teste'}),/PARAR/);
 assert.match(makeReminderDraft({type:'d5',privateInviteLink:link,publicName:'Parceiro de teste'}),/Último lembrete/);
 assert.throws(()=>makeReminderDraft({type:'foo',privateInviteLink:link,publicName:'Parceiro de teste'}),/TYPE_INVALID/);
});
