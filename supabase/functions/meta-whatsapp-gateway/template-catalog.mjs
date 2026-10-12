// Drafts for future manual submission, NOT Meta-approved templates or send payloads.
export const META_TEMPLATE_DRAFTS=Object.freeze([
 {kind:'initial',name:'pepday_partner_invite_v1',language:'pt_BR',proposedCategory:'UTILITY',
  body:'PepDay: conclua seu cadastro de parceiro pelo link individual {{1}}. Este número envia avisos automáticos e não responde mensagens. Suporte: {{2}}. Para cancelar novos avisos, responda PARAR.'},
 {kind:'d2',name:'pepday_partner_reminder_d2_v1',language:'pt_BR',proposedCategory:'UTILITY',
  body:'PepDay: seu cadastro de parceiro está pendente. Se desejar continuar, acesse {{1}}. Este número não responde mensagens. Suporte: {{2}}. Para cancelar novos avisos, responda PARAR.'},
 {kind:'d5',name:'pepday_partner_reminder_d5_v1',language:'pt_BR',proposedCategory:'UTILITY',
  body:'PepDay: lembrete final deste convite de cadastro. Acesse {{1}} enquanto o convite estiver válido. Este número não responde mensagens. Suporte: {{2}}. Para cancelar novos avisos, responda PARAR.'},
 {kind:'otp_auth',name:'pepday_partner_otp_v1',language:'pt_BR',proposedCategory:'AUTHENTICATION',
  body:null,requiresOfficialAuthenticationComponents:true}
].map(x=>Object.freeze({...x,approval:'pending_meta',realSend:false})));
export function templateActivationCheck(record){
 const reasons=['REAL_SEND_DISABLED'];
 if(!META_TEMPLATE_DRAFTS.some(x=>x.kind===record?.kind))reasons.push('UNKNOWN_KIND');
 if(record?.metaApproval!=='APPROVED')reasons.push('META_APPROVAL_PENDING');
 if(!record?.phoneNumberId||!record?.wabaId)reasons.push('CHANNEL_PENDING');
 if(!record?.supportUrl||!/^https:\/\//.test(record.supportUrl))reasons.push('SUPPORT_PENDING');
 return {enabled:false,reasons};
}
