import {
  cancellationConfirmed,
  mercadoPagoCancelBody,
  needsProviderCancellation,
  normalizeDeleteRequest,
  validProviderSubscriptionId,
} from "./delete-core.mjs";

class DeleteError extends Error{
  constructor(code,status=400){super(code);this.name="DeleteError";this.code=code;this.status=status}
}

const CORS_HEADERS=Object.freeze({
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
});

const env=name=>(Deno.env.get(name)||"").trim();

function jsonEnvKey(name){
  const raw=env(name);
  if(!raw)return "";
  try{
    const parsed=JSON.parse(raw);
    return typeof parsed?.default==="string"?parsed.default:"";
  }catch{return ""}
}

function publishableKey(){
  return jsonEnvKey("SUPABASE_PUBLISHABLE_KEYS")||env("SUPABASE_ANON_KEY");
}

function secretKey(){
  return jsonEnvKey("SUPABASE_SECRET_KEYS")||env("SUPABASE_SERVICE_ROLE_KEY");
}

function backendHeaders(key){
  const headers={apikey:key,"Content-Type":"application/json"};
  if(!key.startsWith("sb_secret_"))headers.Authorization=`Bearer ${key}`;
  return headers;
}

function response(status,code,extra={}){
  return Response.json({ok:status>=200&&status<300,code,...extra},{
    status,headers:{...CORS_HEADERS,"Cache-Control":"no-store"}
  });
}

function bearerToken(req){
  const value=(req.headers.get("authorization")||"").trim();
  const match=value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim()||"";
}

async function fetchJson(url,init,code,status=503,{allowEmpty=false}={}){
  const res=await fetch(url,init);
  let data=null;
  try{data=await res.json()}catch{}
  if(!res.ok)throw new DeleteError(`${code}_${res.status}`,status);
  if(data===null&&!allowEmpty)throw new DeleteError(`${code}_EMPTY`,status);
  return data;
}

async function authenticatedUser(supabaseUrl,publishable,token){
  if(!token)throw new DeleteError("AUTH_REQUIRED",401);
  const user=await fetchJson(
    new URL("/auth/v1/user",supabaseUrl).href,
    {headers:{apikey:publishable,Authorization:`Bearer ${token}`}},
    "AUTH_INVALID",
    401
  );
  if(!user?.id)throw new DeleteError("AUTH_INVALID",401);
  return user;
}

async function subscriptionForUser(supabaseUrl,key,userId){
  const url=new URL("/rest/v1/subscriptions",supabaseUrl);
  url.searchParams.set("select","provider,provider_subscription_id,provider_status,billing_status");
  url.searchParams.set("user_id",`eq.${userId}`);
  url.searchParams.set("limit","2");
  const rows=await fetchJson(url.href,{headers:backendHeaders(key)},"SUBSCRIPTION_LOOKUP");
  if(!Array.isArray(rows)||rows.length>1)throw new DeleteError("SUBSCRIPTION_STATE_INVALID",409);
  return rows[0]||null;
}

async function cancelMercadoPago(accessToken,providerSubscriptionId){
  const id=validProviderSubscriptionId(providerSubscriptionId);
  if(!id)throw new DeleteError("PROVIDER_SUBSCRIPTION_INVALID",409);
  if(!accessToken)throw new DeleteError("BILLING_CANCELLATION_UNAVAILABLE",503);

  const resource=await fetchJson(
    `https://api.mercadopago.com/preapproval/${encodeURIComponent(id)}`,
    {
      method:"PUT",
      headers:{
        Authorization:`Bearer ${accessToken}`,
        "Content-Type":"application/json"
      },
      body:JSON.stringify(mercadoPagoCancelBody())
    },
    "MP_CANCEL_SUBSCRIPTION"
  );

  if(!cancellationConfirmed(resource,id)){
    throw new DeleteError("MP_CANCELLATION_NOT_CONFIRMED",503);
  }
}

async function deleteAuthUser(supabaseUrl,key,userId){
  const url=new URL(`/auth/v1/admin/users/${encodeURIComponent(userId)}`,supabaseUrl);
  url.searchParams.set("should_soft_delete","false");
  const res=await fetch(url.href,{
    method:"DELETE",
    headers:backendHeaders(key)
  });
  if(!res.ok)throw new DeleteError(`AUTH_DELETE_${res.status}`,503);
}

export default{
  async fetch(req){
    try{
      if(req.method==="OPTIONS")return new Response("ok",{status:200,headers:CORS_HEADERS});
      if(req.method!=="POST")return response(405,"METHOD_NOT_ALLOWED");
      const size=Number(req.headers.get("content-length")||0);
      if(Number.isFinite(size)&&size>2048)return response(413,"REQUEST_TOO_LARGE");

      const supabaseUrl=env("SUPABASE_URL");
      const publishable=publishableKey();
      const adminKey=secretKey();
      if(!supabaseUrl||!publishable||!adminKey)throw new DeleteError("ACCOUNT_DELETE_CONFIG_MISSING",500);

      let body;
      try{body=await req.json()}catch{return response(400,"INVALID_JSON")}
      const request=normalizeDeleteRequest(body);
      if(!request)return response(400,"DELETE_CONFIRMATION_REQUIRED");

      const user=await authenticatedUser(supabaseUrl,publishable,bearerToken(req));
      const subscription=await subscriptionForUser(supabaseUrl,adminKey,user.id);

      if(needsProviderCancellation(subscription)){
        await cancelMercadoPago(
          env("MERCADO_PAGO_ACCESS_TOKEN"),
          subscription.provider_subscription_id
        );
      }

      await deleteAuthUser(supabaseUrl,adminKey,user.id);

      return response(200,"ACCOUNT_DELETED");
    }catch(error){
      const status=error instanceof DeleteError?error.status:500;
      const code=error instanceof DeleteError?error.code:"UNEXPECTED_ERROR";
      console.error("PepDay account delete:",code);
      return response(status,code);
    }
  }
};
