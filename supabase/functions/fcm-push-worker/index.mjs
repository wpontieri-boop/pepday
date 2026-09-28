import {
  base64Url,
  deliveryDecision,
  fcmEndpoint,
  fcmErrorCode,
  normalizePushClaim,
  notificationForEvent,
  parseServiceAccount,
  validFcmMessageName,
} from "./push-core.mjs";

class WorkerError extends Error {
  constructor(code,status=500){super(code);this.name="WorkerError";this.code=code;this.status=status}
}

const env=name=>(Deno.env.get(name)||"").trim();

function supabaseSecretKey(){
  const modern=env("SUPABASE_SECRET_KEYS");
  if(modern){
    try{
      const parsed=JSON.parse(modern);
      if(typeof parsed?.default==="string"&&parsed.default)return parsed.default;
    }catch{throw new WorkerError("SUPABASE_SECRET_CONFIG_INVALID")}
  }
  const legacy=env("SUPABASE_SERVICE_ROLE_KEY");
  if(legacy)return legacy;
  throw new WorkerError("SUPABASE_SECRET_MISSING");
}

function backendHeaders(key){
  const headers={apikey:key,"Content-Type":"application/json"};
  if(!key.startsWith("sb_secret_"))headers.Authorization=`Bearer ${key}`;
  return headers;
}

function safeResponse(status,code,extra={}){
  return Response.json({ok:status>=200&&status<300,code,...extra},{
    status,
    headers:{"Cache-Control":"no-store"}
  });
}

async function secureSecretMatch(expected,supplied){
  if(expected.length<32||supplied.length<32)return false;
  const encoder=new TextEncoder();
  const [a,b]=await Promise.all([
    crypto.subtle.digest("SHA-256",encoder.encode(expected)),
    crypto.subtle.digest("SHA-256",encoder.encode(supplied))
  ]);
  const left=new Uint8Array(a),right=new Uint8Array(b);
  let diff=left.length^right.length;
  for(let i=0;i<left.length;i++)diff|=left[i]^(right[i]||0);
  return diff===0;
}

async function internalSecretOk(req){
  return await secureSecretMatch(
    env("PEPDAY_PUSH_WORKER_SECRET"),
    (req.headers.get("x-pepday-worker-secret")||"").trim()
  );
}

async function rpc(supabaseUrl,key,name,args){
  const response=await fetch(new URL(`/rest/v1/rpc/${name}`,supabaseUrl),{
    method:"POST",
    headers:backendHeaders(key),
    body:JSON.stringify(args)
  });
  let data=null;
  try{data=await response.json()}catch{}
  if(!response.ok)throw new WorkerError(`SUPABASE_${name.toUpperCase()}_${response.status}`,503);
  return data;
}

function pemToPkcs8(pem){
  const base64=String(pem||"")
    .replace(/-----BEGIN PRIVATE KEY-----/g,"")
    .replace(/-----END PRIVATE KEY-----/g,"")
    .replace(/\s+/g,"");
  if(!base64)return null;
  try{
    const binary=atob(base64);
    const bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    return bytes.buffer;
  }catch{return null}
}

async function serviceAccountAssertion(account){
  const keyBytes=pemToPkcs8(account.privateKey);
  if(!keyBytes)throw new WorkerError("FIREBASE_PRIVATE_KEY_INVALID");

  const signingKey=await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},
    false,
    ["sign"]
  );

  const now=Math.floor(Date.now()/1000);
  const encoder=new TextEncoder();
  const header=base64Url(encoder.encode(JSON.stringify({alg:"RS256",typ:"JWT"})));
  const claims=base64Url(encoder.encode(JSON.stringify({
    iss:account.clientEmail,
    scope:"https://www.googleapis.com/auth/firebase.messaging",
    aud:"https://oauth2.googleapis.com/token",
    iat:now,
    exp:now+3600
  })));
  const unsigned=`${header}.${claims}`;
  const signature=await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    signingKey,
    encoder.encode(unsigned)
  );
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

async function accessToken(account){
  const assertion=await serviceAccountAssertion(account);
  const response=await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",
    headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({
      grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  let data=null;
  try{data=await response.json()}catch{}
  if(!response.ok||typeof data?.access_token!=="string"||!data.access_token){
    throw new WorkerError(`FIREBASE_OAUTH_${response.status}`,503);
  }
  return data.access_token;
}

async function sendFcm(claim,account,token,appUrl){
  const notification=notificationForEvent(claim.eventType);
  if(!notification)throw new WorkerError("FCM_NOTIFICATION_TYPE_INVALID");

  const endpoint=fcmEndpoint(account.projectId);
  if(!endpoint)throw new WorkerError("FIREBASE_PROJECT_ID_INVALID");

  const response=await fetch(endpoint,{
    method:"POST",
    headers:{
      Authorization:`Bearer ${token}`,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      message:{
        token:claim.installationId,
        notification,
        webpush:{
          fcm_options:{link:appUrl}
        }
      }
    })
  });

  let data=null;
  try{data=await response.json()}catch{}
  return {
    status:response.status,
    messageName:validFcmMessageName(data?.name,account.projectId),
    errorCode:fcmErrorCode(response.status,data)
  };
}

async function complete(supabaseUrl,key,claim,workerId,decision,messageId,errorCode){
  return await rpc(supabaseUrl,key,"complete_push_notification",{
    p_id:claim.id,
    p_worker_id:workerId,
    p_outcome:decision.outcome,
    p_provider_message_id:messageId||null,
    p_error_code:errorCode||null,
    p_retry_after_seconds:decision.retryAfterSeconds||null
  });
}

export default {
  async fetch(req){
    try{
      if(req.method!=="POST")return safeResponse(405,"METHOD_NOT_ALLOWED");
      if(!(await internalSecretOk(req)))return safeResponse(401,"INVALID_WORKER_SECRET");

      const supabaseUrl=env("SUPABASE_URL");
      const key=supabaseSecretKey();
      const account=parseServiceAccount(env("FIREBASE_SERVICE_ACCOUNT_JSON"));
      const appUrl=env("PEPDAY_PUBLIC_URL");

      if(!supabaseUrl||!account||!appUrl)throw new WorkerError("PUSH_WORKER_CONFIG_MISSING");

      let publicUrl;
      try{publicUrl=new URL(appUrl)}catch{throw new WorkerError("PEPDAY_PUBLIC_URL_INVALID")}
      if(publicUrl.protocol!=="https:")throw new WorkerError("PEPDAY_PUBLIC_URL_INVALID");

      const oauthToken=await accessToken(account);
      const workerId=crypto.randomUUID();
      const summary={processed:0,sent:0,retry:0,dead:0,skipped:0,empty:false};

      for(let i=0;i<10;i++){
        const raw=await rpc(supabaseUrl,key,"claim_push_notification",{p_worker_id:workerId});
        const claim=normalizePushClaim(raw);

        if(claim?.outcome==="empty"){
          summary.empty=summary.processed===0;
          break;
        }
        if(claim?.outcome==="skipped"){
          summary.skipped++;
          continue;
        }
        if(!claim||claim.outcome!=="claimed")throw new WorkerError("PUSH_CLAIM_INVALID",503);

        summary.processed++;
        let delivery;
        try{
          delivery=await sendFcm(claim,account,oauthToken,publicUrl.href);
        }catch(error){
          if(error instanceof WorkerError)throw error;
          const decision=deliveryDecision(503,claim.attempt);
          await complete(
            supabaseUrl,key,claim,workerId,decision,null,"FCM_NETWORK_ERROR"
          );
          summary[decision.outcome]++;
          continue;
        }

        const decision=deliveryDecision(delivery.status,claim.attempt);
        if(decision.outcome==="sent"&&!delivery.messageName){
          const fallback=deliveryDecision(503,claim.attempt);
          await complete(
            supabaseUrl,key,claim,workerId,fallback,null,"FCM_MESSAGE_ID_MISSING"
          );
          summary[fallback.outcome]++;
          continue;
        }

        await complete(
          supabaseUrl,
          key,
          claim,
          workerId,
          decision,
          decision.outcome==="sent"?delivery.messageName:null,
          decision.outcome==="sent"?null:delivery.errorCode
        );
        summary[decision.outcome]++;
      }

      return safeResponse(200,"WORKER_COMPLETE",summary);
    }catch(error){
      const status=error instanceof WorkerError?error.status:500;
      const code=error instanceof WorkerError?error.code:"UNEXPECTED_ERROR";
      console.error("PepDay FCM worker:",code);
      return safeResponse(status,code);
    }
  }
};
