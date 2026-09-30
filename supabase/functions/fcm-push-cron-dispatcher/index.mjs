class DispatcherError extends Error {
  constructor(code,status=500){super(code);this.name="DispatcherError";this.code=code;this.status=status}
}

const env=name=>(Deno.env.get(name)||"").trim();

function supabaseSecretKey(){
  const modern=env("SUPABASE_SECRET_KEYS");
  if(modern){
    try{
      const parsed=JSON.parse(modern);
      if(typeof parsed?.default==="string"&&parsed.default)return parsed.default;
    }catch{throw new DispatcherError("SUPABASE_SECRET_CONFIG_INVALID")}
  }
  const legacy=env("SUPABASE_SERVICE_ROLE_KEY");
  if(legacy)return legacy;
  throw new DispatcherError("SUPABASE_SECRET_MISSING");
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

async function rpc(supabaseUrl,key,name,args){
  const response=await fetch(new URL(`/rest/v1/rpc/${name}`,supabaseUrl),{
    method:"POST",
    headers:backendHeaders(key),
    body:JSON.stringify(args)
  });
  let data=null;
  try{data=await response.json()}catch{}
  if(!response.ok)throw new DispatcherError(`SUPABASE_${name.toUpperCase()}_${response.status}`,503);
  return data;
}

function invocationToken(req){
  const value=(req.headers.get("x-pepday-invocation-token")||"").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
    ?value:null;
}
async function forwardToWorker(supabaseUrl,workerSecret){
  if(workerSecret.length<32)throw new DispatcherError("PUSH_WORKER_SECRET_MISSING");
  const response=await fetch(new URL("/functions/v1/fcm-push-worker",supabaseUrl),{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "x-pepday-worker-secret":workerSecret
    },
    body:"{}"
  });
  let data=null;
  try{data=await response.json()}catch{}
  if(!response.ok){
    throw new DispatcherError(`PUSH_WORKER_${response.status}`,response.status>=500?503:502);
  }
  return data&&typeof data==="object"?data:{};
}

export default {
  async fetch(req){
    try{
      if(req.method!=="POST")return safeResponse(405,"METHOD_NOT_ALLOWED");

      const token=invocationToken(req);
      if(!token)return safeResponse(401,"INVALID_INVOCATION_TOKEN");
      const supabaseUrl=env("SUPABASE_URL");
      const key=supabaseSecretKey();
      if(!supabaseUrl)throw new DispatcherError("DISPATCHER_CONFIG_MISSING");

      const auth=await rpc(
        supabaseUrl,key,"consume_push_worker_invocation",{p_token:token}
      );
      if(auth?.outcome!=="accepted"){
        return safeResponse(401,"INVALID_INVOCATION_TOKEN");
      }

      const result=await forwardToWorker(
        supabaseUrl,env("PEPDAY_PUSH_WORKER_SECRET")
      );
      return safeResponse(200,"DISPATCH_COMPLETE",{
        processed:Number(result.processed||0),
        sent:Number(result.sent||0),
        retry:Number(result.retry||0),
        dead:Number(result.dead||0),
        skipped:Number(result.skipped||0),
        empty:Boolean(result.empty)
      });
    }catch(error){
      const status=error instanceof DispatcherError?error.status:500;
      const code=error instanceof DispatcherError?error.code:"UNEXPECTED_ERROR";
      console.error("PepDay FCM cron dispatcher:",code);
      return safeResponse(status,code);
    }
  }
};
