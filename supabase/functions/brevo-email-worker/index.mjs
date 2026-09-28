import {
  brevoParams,
  deliveryDecision,
  normalizeClaim,
  parseTemplateId,
  templateEnvName,
  validBrevoMessageId,
} from "./email-core.mjs";

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

async function internalSecretOk(req){
  const expected=env("PEPDAY_EMAIL_WORKER_SECRET");
  const supplied=(req.headers.get("x-pepday-worker-secret")||"").trim();
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

function templateIdFor(eventType){
  const envName=templateEnvName(eventType);
  return envName?parseTemplateId(env(envName)):null;
}

function errorCodeForBrevo(status){
  const code=Number(status);
  if(code===408)return "BREVO_TIMEOUT";
  if(code===425)return "BREVO_TOO_EARLY";
  if(code===429)return "BREVO_RATE_LIMIT";
  if(code>=500)return "BREVO_SERVER_ERROR";
  if(code===400)return "BREVO_BAD_REQUEST";
  if(code===401||code===403)return "BREVO_AUTH_ERROR";
  return `BREVO_HTTP_${Number.isFinite(code)?code:0}`;
}

async function sendBrevo(claim,templateId,apiKey,appUrl){
  const response=await fetch("https://api.brevo.com/v3/smtp/email",{
    method:"POST",
    headers:{
      "api-key":apiKey,
      accept:"application/json",
      "content-type":"application/json"
    },
    body:JSON.stringify({
      to:[claim.recipient],
      templateId,
      params:brevoParams(claim,appUrl),
      tags:["pepday",claim.eventType]
    })
  });
  let data=null;
  try{data=await response.json()}catch{}
  return {status:response.status,messageId:validBrevoMessageId(data?.messageId)};
}

async function complete(supabaseUrl,key,claim,decision,messageId,errorCode){
  return await rpc(supabaseUrl,key,"complete_transactional_email",{
    p_id:claim.id,
    p_worker_id:claim.workerId,
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
      const brevoApiKey=env("BREVO_API_KEY");
      const appUrl=env("PEPDAY_PUBLIC_URL");
      if(!supabaseUrl||!brevoApiKey||!appUrl)throw new WorkerError("EMAIL_WORKER_CONFIG_MISSING");

      let parsedUrl;
      try{parsedUrl=new URL(appUrl)}catch{throw new WorkerError("PEPDAY_PUBLIC_URL_INVALID")}
      if(parsedUrl.protocol!=="https:")throw new WorkerError("PEPDAY_PUBLIC_URL_INVALID");

      const workerId=crypto.randomUUID();
      const summary={processed:0,sent:0,retry:0,dead:0,empty:false};

      for(let i=0;i<5;i++){
        const raw=await rpc(supabaseUrl,key,"claim_transactional_email",{p_worker_id:workerId});
        const claim=normalizeClaim(raw);

        if(claim?.outcome==="empty"){
          summary.empty=summary.processed===0;
          break;
        }
        if(!claim||claim.outcome!=="claimed")throw new WorkerError("EMAIL_CLAIM_INVALID",503);

        claim.workerId=workerId;
        summary.processed++;

        const templateId=templateIdFor(claim.eventType);
        if(!templateId){
          const decision={outcome:"retry",retryAfterSeconds:3600};
          await complete(supabaseUrl,key,claim,decision,null,"TEMPLATE_NOT_CONFIGURED");
          summary.retry++;
          continue;
        }

        let delivery;
        try{
          delivery=await sendBrevo(claim,templateId,brevoApiKey,appUrl);
        }catch{
          const decision=deliveryDecision(503,claim.attempt);
          await complete(supabaseUrl,key,claim,decision,null,"BREVO_NETWORK_ERROR");
          summary[decision.outcome]++;
          continue;
        }

        const decision=deliveryDecision(delivery.status,claim.attempt);
        const errorCode=decision.outcome==="sent"?null:errorCodeForBrevo(delivery.status);
        const messageId=decision.outcome==="sent"?delivery.messageId:null;

        if(decision.outcome==="sent"&&!messageId){
          const fallback=deliveryDecision(503,claim.attempt);
          await complete(supabaseUrl,key,claim,fallback,null,"BREVO_MESSAGE_ID_MISSING");
          summary[fallback.outcome]++;
          continue;
        }

        await complete(supabaseUrl,key,claim,decision,messageId,errorCode);
        summary[decision.outcome]++;
      }

      return safeResponse(200,"WORKER_COMPLETE",summary);
    }catch(error){
      const status=error instanceof WorkerError?error.status:500;
      const code=error instanceof WorkerError?error.code:"UNEXPECTED_ERROR";
      console.error("PepDay Brevo worker:",code);
      return safeResponse(status,code);
    }
  }
};
