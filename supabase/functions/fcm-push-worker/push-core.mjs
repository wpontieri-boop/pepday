export const PUSH_EVENTS=Object.freeze([
  'routine_due','refill_due','operational','account_security'
]);

const NOTIFICATIONS=Object.freeze({
  routine_due:Object.freeze({
    title:'PepDay',
    body:'Você tem uma rotina programada para hoje.'
  }),
  refill_due:Object.freeze({
    title:'PepDay',
    body:'Você tem um aviso de reposição no PepDay.'
  }),
  operational:Object.freeze({
    title:'PepDay',
    body:'Há um aviso operacional no PepDay.'
  }),
  account_security:Object.freeze({
    title:'PepDay',
    body:'Há um aviso de segurança na sua conta PepDay.'
  })
});

export function notificationForEvent(eventType){
  const value=NOTIFICATIONS[eventType];
  return value?Object.freeze({...value}):null;
}

export function normalizePushClaim(raw){
  if(raw?.outcome==='empty')return {outcome:'empty'};
  if(raw?.outcome==='skipped')return {outcome:'skipped',reason:String(raw.reason||'')};
  if(raw?.outcome!=='claimed')return null;

  const id=String(raw.id||'').trim().toLowerCase();
  const eventType=String(raw.event_type||'').trim();
  const installationId=String(raw.installation_id||'').trim();
  const attempt=Number(raw.attempt);

  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))return null;
  if(!PUSH_EVENTS.includes(eventType))return null;
  if(!/^[A-Za-z0-9_:\.-]{16,512}$/.test(installationId))return null;
  if(!Number.isInteger(attempt)||attempt<1||attempt>5)return null;

  return Object.freeze({outcome:'claimed',id,eventType,installationId,attempt});
}

export function parseServiceAccount(raw){
  let value;
  try{value=JSON.parse(String(raw||''))}catch{return null}
  const projectId=String(value?.project_id||'').trim();
  const clientEmail=String(value?.client_email||'').trim();
  const privateKey=String(value?.private_key||'').trim();
  if(!/^[a-z0-9][a-z0-9-]{3,80}$/.test(projectId))return null;
  if(!/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(clientEmail))return null;
  if(!privateKey.includes('BEGIN PRIVATE KEY')||!privateKey.includes('END PRIVATE KEY'))return null;
  return Object.freeze({projectId,clientEmail,privateKey});
}

export function fcmEndpoint(projectId){
  const value=String(projectId||'').trim();
  if(!/^[a-z0-9][a-z0-9-]{3,80}$/.test(value))return null;
  return `https://fcm.googleapis.com/v1/projects/${value}/messages:send`;
}

export function deliveryDecision(status,attempt){
  const code=Number(status);
  const tries=Number(attempt);
  if(code===200)return {outcome:'sent',retryAfterSeconds:null};
  const transient=code===408||code===425||code===429||code>=500;
  if(transient&&tries<5){
    const seconds=Math.min(3600,60*(2**Math.max(0,tries-1)));
    return {outcome:'retry',retryAfterSeconds:seconds};
  }
  return {outcome:'dead',retryAfterSeconds:null};
}

export function fcmErrorCode(status,data){
  const details=Array.isArray(data?.error?.details)?data.error.details:[];
  const fcmCode=details.map(item=>String(item?.errorCode||'')).find(Boolean);
  if(fcmCode==='UNREGISTERED')return 'FCM_UNREGISTERED';
  if(fcmCode==='SENDER_ID_MISMATCH')return 'FCM_SENDER_ID_MISMATCH';
  const code=Number(status);
  if(code===401||code===403)return 'FCM_AUTH_ERROR';
  if(code===429)return 'FCM_RATE_LIMIT';
  if(code>=500)return 'FCM_SERVER_ERROR';
  if(code===400)return 'FCM_BAD_REQUEST';
  return `FCM_HTTP_${Number.isFinite(code)?code:0}`;
}

export function validFcmMessageName(value,projectId){
  const text=String(value||'').trim();
  const prefix=`projects/${projectId}/messages/`;
  return text.startsWith(prefix)&&text.length<=600?text:null;
}

export function base64Url(bytes){
  let binary='';
  for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
