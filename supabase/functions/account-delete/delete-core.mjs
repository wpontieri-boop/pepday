export function normalizeDeleteRequest(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  return value.confirm==='EXCLUIR'?Object.freeze({confirm:'EXCLUIR'}):null;
}

export function needsProviderCancellation(subscription){
  if(!subscription||subscription.provider!=='mercado_pago')return false;
  const id=String(subscription.provider_subscription_id||'').trim();
  if(!id)return false;
  if(subscription.provider_status==='canceled')return false;
  if(['expired','none'].includes(subscription.billing_status))return false;
  return true;
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

export function safeDeleteResponse(status,code,extra={}){
  return {status,body:{ok:status>=200&&status<300,code,...extra}};
}
