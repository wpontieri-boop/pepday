export const TEST_URL='https://fsbqpyyprtymwrmzsacp.supabase.co';
export const PROD_URL='https://oslefjmwfnddxlotalxu.supabase.co';
export function recoveryEnvironment(url,liveMode){
  const normalized=String(url||'').replace(/\/$/,'');
  if(normalized===TEST_URL&&liveMode==='false')return 'test';
  if(normalized===PROD_URL&&liveMode==='true')return 'production';
  return null;
}
export function isRecoveryTest(url,liveMode){return recoveryEnvironment(url,liveMode)==='test'}
export function recoveryAppUrl(environment){
  return environment==='production'?'https://pepday.com.br/app/':environment==='test'?'https://homologacao.pepday.com.br/':null;
}
export function introductoryRecurring(expiresAt,now=Date.now()){
  const expiry=new Date(expiresAt).getTime();
  if(!Number.isFinite(expiry)||expiry<=now||expiry>now+72*3600000)return null;
  // The 72h window is PepDay offer eligibility, not the lifetime of the Mercado Pago subscription.
  // The contract stays monthly/open-ended; after the first approved R$9.90 payment we reset it to R$14.90.
  return {frequency:1,frequency_type:'months',transaction_amount:9.90,currency_id:'BRL'};
}
export function normalRecurringUpdate(paidAt=new Date().toISOString()){
  const base=new Date(paidAt);if(!Number.isFinite(base.getTime()))throw new Error('INVALID_PAYMENT_DATE');
  return {auto_recurring:{transaction_amount:14.90,currency_id:'BRL'}};
}
export function resetConfirmed(provider){
  return Number(provider?.auto_recurring?.transaction_amount)===14.90&&provider?.auto_recurring?.currency_id==='BRL';
}
export function recoveryMessage(stage,source){
  const benefit=source==='card'?'cartão de 30 dias':'teste de 7 dias';
  const messages={
    warning:{subject:'Seu acesso PRO está perto do fim',text:`Seu benefício do ${benefit} termina em {{params.benefit_end}}. Seus dados continuam disponíveis no FREE.`},
    ended:{subject:'Seu PepDay continua disponível no FREE',text:`O benefício do ${benefit} terminou. Você pode continuar usando o FREE e consultar as opções PRO quando quiser.`},
    resume:{subject:'Retome sua rotina no PepDay',text:'Seu PepDay está esperando por você. Acesse sua conta para retomar sua rotina.'},
    offer:{subject:'Volte ao PRO: primeiro mês por R$ 9,90',text:'Oferta individual: primeiro mês R$ 9,90, depois R$ 14,90/mês. Válida até {{params.offer_expires_at}} (72 horas). Uso único por conta, sem acumular com códigos PRO de cortesia. Anual: R$ 99,90/ano.'},
    last:{subject:'Último aviso da oferta de retomada',text:'Sua oferta termina em {{params.offer_expires_at}}. Primeiro mês R$ 9,90; depois R$ 14,90/mês. Uso único e sem acumular com cortesia. Anual permanece R$ 99,90/ano.'}
  };
  return messages[stage]||null;
}
export function recoveryParams(claim,appUrl){
  const format=value=>{const date=new Date(value);return Number.isFinite(date.getTime())
    ?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(date)+' (Brasília)':'';};
  return {name:claim.recipient.name||'PepDay',
  benefit_end:format(claim.benefit_end),offer_expires_at:format(claim.offer_expires_at),
  app_url:appUrl+'?recovery=1',first_price:'9,90',recurring_price:'14,90',annual_price:'99,90'};}
