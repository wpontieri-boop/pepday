export const PLANS=Object.freeze({
  monthly:Object.freeze({key:'monthly',label:'Mensal',price:14.90}),
  annual:Object.freeze({key:'annual',label:'Anual',price:99.90})
});

export function normalizeCheckoutRequest(body){
  const plan=typeof body?.plan==='string'?body.plan.trim().toLowerCase():'';
  const requestId=typeof body?.request_id==='string'?body.request_id.trim().toLowerCase():'';
  if(!PLANS[plan])return null;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId))return null;
  return {plan,requestId};
}

export function checkoutExternalReference(subscriptionId,plan){
  const id=String(subscriptionId||'').trim().toLowerCase();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))return null;
  if(!PLANS[plan])return null;
  return `pepday:${id}:${plan}`;
}

export function checkoutRecurring(plan){
  const config=PLANS[plan];
  if(!config)return null;
  return {
    frequency:plan==='annual'?12:1,
    frequency_type:'months',
    transaction_amount:config.price,
    currency_id:'BRL'
  };
}

export function validCheckoutUrl(value){
  try{
    const url=new URL(String(value||''));
    return url.protocol==='https:'&&(
      url.hostname==='mercadopago.com'||
      url.hostname.endsWith('.mercadopago.com')||
      url.hostname==='mercadopago.com.br'||
      url.hostname.endsWith('.mercadopago.com.br')
    );
  }catch{return false}
}

export function canCreateCheckout(subscription){
  if(!subscription)return false;
  if(subscription.status==='pro_active'&&subscription.provider_subscription_id)return false;
  return true;
}
