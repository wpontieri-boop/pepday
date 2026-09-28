export const EMAIL_EVENTS=Object.freeze([
  'account_created',
  'trial_started',
  'trial_ending',
  'trial_ended',
  'payment_approved',
  'renewal_approved',
  'payment_failed',
  'grace_ended',
  'subscription_canceled',
  'subscription_reactivated',
  'account_security'
]);

export function templateEnvName(eventType){
  if(!EMAIL_EVENTS.includes(eventType))return null;
  return `BREVO_TEMPLATE_${eventType.toUpperCase()}`;
}

export function parseTemplateId(value){
  const id=Number(String(value||'').trim());
  return Number.isInteger(id)&&id>0?id:null;
}

export function validEmail(value){
  const email=String(value||'').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null;
}

export function normalizeClaim(raw){
  if(raw?.outcome!=='claimed')return raw?.outcome==='empty'?{outcome:'empty'}:null;
  const id=String(raw.id||'').trim().toLowerCase();
  const eventType=String(raw.event_type||'').trim();
  const email=validEmail(raw?.recipient?.email);
  const name=String(raw?.recipient?.name||'PepDay').trim().slice(0,120)||'PepDay';
  const attempt=Number(raw.attempt);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))return null;
  if(!EMAIL_EVENTS.includes(eventType)||!email||!Number.isInteger(attempt)||attempt<1||attempt>5)return null;
  return {
    outcome:'claimed',
    id,
    eventType,
    attempt,
    recipient:{email,name},
    context:raw.context&&typeof raw.context==='object'?raw.context:{}
  };
}

export function brevoParams(claim,appUrl){
  const c=claim?.context||{};
  return {
    name:claim?.recipient?.name||'PepDay',
    plan:typeof c.plan==='string'?c.plan:'',
    subscription_status:typeof c.subscription_status==='string'?c.subscription_status:'',
    billing_status:typeof c.billing_status==='string'?c.billing_status:'',
    period_end:typeof c.period_end==='string'?c.period_end:'',
    grace_until:typeof c.grace_until==='string'?c.grace_until:'',
    trial_end:typeof c.trial_end==='string'?c.trial_end:'',
    app_url:String(appUrl||'')
  };
}

export function deliveryDecision(status,attempt){
  const code=Number(status);
  const tries=Number(attempt);
  if(code===201)return {outcome:'sent',retryAfterSeconds:null};
  const transient=code===408||code===425||code===429||code>=500;
  if(transient&&tries<5){
    const seconds=Math.min(3600,60*(2**Math.max(0,tries-1)));
    return {outcome:'retry',retryAfterSeconds:seconds};
  }
  return {outcome:'dead',retryAfterSeconds:null};
}

export function validBrevoMessageId(value){
  const id=String(value||'').trim();
  return id.length>0&&id.length<=300?id:null;
}
