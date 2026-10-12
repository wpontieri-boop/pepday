// PepDay TEST — regras PURAS de convite e lembrete de parceiros.
// NÃO gera tokens, NÃO concede autenticação, NÃO envia WhatsApp nem altera o banco.
// Produção, portal/OTP e integração WhatsApp precisam de etapas próprias.
const TEST_ORIGIN='https://homologacao.pepday.com.br';
const INVITE_PATH='/parceiros/convite/';
const MILLIS_PER_HOUR=60*60*1000;
const EARLIEST={d2:48,d5:120};
const PROFILES=new Set(['owner','admin']);
const VALID_TYPES=new Set(['initial','d2','d5']);
const parsedDate=value=>{const t=Date.parse(value);return Number.isFinite(t)?t:null;};
const harmlessLabel=value=>{
 const raw=String(value||'').replace(/[\r\n\t\u0000-\u001f]/g,' ').trim();
 if(!raw||raw.length>80||/@/.test(raw)||/\b\d{11,}\b/.test(raw))throw Error('PARTNER_INVITE_INVALID_NAME');
 return raw;
};
export function validPrivateInviteLink(link){
 let url;
 try{url=new URL(String(link||''))}catch{throw Error('PARTNER_INVITE_LINK_INVALID')}
 if(url.origin!==TEST_ORIGIN||url.protocol!=='https:'||url.pathname!==INVITE_PATH||
   url.username||url.password||url.search||!/^#invite=[A-Za-z0-9_-]{43,128}$/.test(url.hash))
  throw Error('PARTNER_INVITE_LINK_INVALID');
 return url.toString();
}
function contactReady({role,partnerStatus,whatsappOptIn,contactConfirmed,optedOut}){
 return PROFILES.has(role)&&partnerStatus==='draft'&&whatsappOptIn===true&&contactConfirmed===true&&optedOut!==true;
}
export function makeManualInviteDraft({role,partnerStatus,whatsappOptIn,contactConfirmed,optedOut=false,phoneE164,privateInviteLink,publicName,explicitOperatorClick=false}){
 if(explicitOperatorClick!==true)throw Error('PARTNER_INVITE_EXPLICIT_ACTION_REQUIRED');
 if(!contactReady({role,partnerStatus,whatsappOptIn,contactConfirmed,optedOut}))
   throw Error('PARTNER_INVITE_PERMISSION_REQUIRED');
 const digits=String(phoneE164||'').replace(/^\+/,'');
 if(!/^[1-9][0-9]{10,14}$/.test(digits))throw Error('PARTNER_INVITE_PHONE_INVALID');
 const name=harmlessLabel(publicName);
 const link=validPrivateInviteLink(privateInviteLink);
 const text='Olá! Você recebeu um convite privado para concluir o cadastro da parceria '+name+' no PepDay. Abra o link, confirme sua identidade e confira as informações antes de aceitar. Este link não substitui o código de indicação público e não ativa a parceria: '+link+' Se não quiser receber mensagens, responda PARAR.';
 return {message:text,shareUrl:'https://wa.me/'+digits+'?text='+encodeURIComponent(text)};
}
export function eligibleReminder({status,whatsappOptIn,contactConfirmed,optedOut=false,revoked=false,completed=false,sentAt,expiresAt,events=[],now=new Date()}){
 if(status!=='pending'||whatsappOptIn!==true||contactConfirmed!==true||optedOut||revoked||completed)return null;
 const start=parsedDate(sentAt),expire=parsedDate(expiresAt);
 const current=now instanceof Date?now.getTime():parsedDate(now);
 if(start===null||expire===null||!Number.isFinite(current)||current<start||current>=expire)return null;
 if(!Array.isArray(events)||!events.includes('initial')||events.some(v=>!['initial','d2','d5'].includes(v)))return null;
 const elapsed=(current-start)/MILLIS_PER_HOUR;
 if(events.includes('d5'))return null;
 if(elapsed>=EARLIEST.d5)return 'd5';
 if(elapsed>=EARLIEST.d2&&!events.includes('d2'))return 'd2';
 return null;
}
export function makeReminderDraft({type,privateInviteLink,publicName}){
 if(!VALID_TYPES.has(type)||type==='initial')throw Error('PARTNER_REMINDER_TYPE_INVALID');
 const name=harmlessLabel(publicName),link=validPrivateInviteLink(privateInviteLink);
 return type==='d2'
  ?'Olá! O cadastro da parceria '+name+' no PepDay ainda está pendente. Se desejar concluir, acesse seu link privado: '+link+' Se preferir não receber mensagens, responda PARAR.'
  :'Olá! Último lembrete desta sequência: seu cadastro da parceria '+name+' ainda pode ser concluído pelo link privado, caso esteja válido: '+link+' Se não quiser receber mensagens, responda PARAR.';
}
