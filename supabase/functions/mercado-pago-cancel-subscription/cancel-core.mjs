export function normalizeCancelRequest(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  return value.confirm==='CANCELAR'?Object.freeze({confirm:'CANCELAR'}):null;
}

export function validProviderSubscriptionId(value){
  const id=String(value||'').trim();
  return /^[A-Za-z0-9_-]{8,200}$/.test(id)?id:null;
}

export function mercadoPagoCancelBody(){
  return Object.freeze({status:'canceled'});
}

export function cancellationConfirmed(resource,expectedId){
  return String(resource?.id||'')===String(expectedId||'')
    && String(resource?.status||'')==='canceled';
}

export function cancellationState(subscription){
  if(!subscription||subscription.provider!=='mercado_pago')return 'not_applicable';
  if(!validProviderSubscriptionId(subscription.provider_subscription_id))return 'not_applicable';
  if(subscription.provider_status==='canceled'||subscription.billing_status==='canceled')return 'already_canceled';
  if(['expired','none'].includes(subscription.billing_status))return 'not_applicable';
  return 'cancel';
}
