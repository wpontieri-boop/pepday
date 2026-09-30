import { firebasePublicConfig } from './firebase-public-config.mjs';

const FIREBASE_APP_URL='https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js';
const FIREBASE_MESSAGING_URL='https://www.gstatic.com/firebasejs/12.3.0/firebase-messaging.js';

let modulesPromise=null;
let registrationPromise=null;

function tokenLooksValid(value){
  return /^[A-Za-z0-9_:\.-]{16,512}$/.test(String(value||'').trim());
}

export function pushSupported(){
  return Boolean(
    typeof window!=='undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

async function modules(){
  if(!modulesPromise){
    modulesPromise=Promise.all([
      import(FIREBASE_APP_URL),
      import(FIREBASE_MESSAGING_URL)
    ]).then(([app,messaging])=>({app,messaging}));
  }
  return modulesPromise;
}

async function messagingRegistration(){
  if(!registrationPromise){
    registrationPromise=navigator.serviceWorker.register('./firebase-messaging-sw.js',{
      scope:'./push/',
      updateViaCache:'none'
    });
  }
  return registrationPromise;
}

async function messagingInstance(){
  const {app,messaging}=await modules();
  const existing=app.getApps().find(item=>item.options?.appId===firebasePublicConfig.appId);
  const firebaseApp=existing||app.initializeApp(firebasePublicConfig);
  return {messaging:messaging.getMessaging(firebaseApp),sdk:messaging};
}

async function currentToken(){
  if(!pushSupported()||Notification.permission!=='granted')return null;
  const [{messaging,sdk},serviceWorkerRegistration]=await Promise.all([
    messagingInstance(),
    messagingRegistration()
  ]);
  const token=await sdk.getToken(messaging,{
    vapidKey:firebasePublicConfig.vapidKey,
    serviceWorkerRegistration
  });
  return tokenLooksValid(token)?token:null;
}

export async function enablePush(client){
  if(!pushSupported())return {outcome:'unsupported'};
  let permission=Notification.permission;
  if(permission==='default')permission=await Notification.requestPermission();
  if(permission!=='granted')return {outcome:'denied'};
  const token=await currentToken();
  if(!token)return {outcome:'token_unavailable'};
  const {data,error}=await client.rpc('register_push_installation',{p_installation_id:token});
  if(error)throw error;
  return {outcome:data?.outcome==='registered'?'registered':'registered'};
}

export async function disablePush(client){
  if(!pushSupported())return {outcome:'unsupported'};
  if(Notification.permission!=='granted')return {outcome:'disabled',changed:0};
  const [{messaging,sdk},token]=await Promise.all([messagingInstance(),currentToken()]);
  let changed=0;
  if(token){
    const {data,error}=await client.rpc('disable_push_installation',{p_installation_id:token});
    if(error)throw error;
    changed=Number(data?.changed||0);
  }
  try{await sdk.deleteToken(messaging)}catch{}
  return {outcome:'disabled',changed};
}

export async function savePushPreferences(client,preferences){
  const payload={
    p_routine_reminders:preferences.routine===true,
    p_refill_alerts:preferences.refill===true,
    p_operational_notices:preferences.operational===true,
    p_account_security_notices:preferences.security===true
  };
  const {data,error}=await client.rpc('update_push_preferences',payload);
  if(error)throw error;
  return data;
}

export function notificationPermission(){
  return pushSupported()?Notification.permission:'unsupported';
}
