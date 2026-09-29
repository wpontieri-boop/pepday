import {
  canCreateCheckout,
  checkoutExternalReference,
  checkoutRecurring,
  normalizeCheckoutRequest,
  validCheckoutUrl,
} from "./checkout-core.mjs";

class CheckoutError extends Error {
  constructor(code,status=400){super(code);this.name="CheckoutError";this.code=code;this.status=status}
}

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

const corsHeaders={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Access-Control-Allow-Headers":"authorization, content-type, apikey, x-client-info",
};

function response(status,code,extra={}){
  return Response.json({ok:status>=200&&status<300,code,...extra},{
    status,headers:{...corsHeaders,"Cache-Control":"no-store"}
  });
}

async function fetchJson(url,init,code,status=503){
  const res=await fetch(url,init);
  let data=null;
  try{data=await res.json()}catch{}
  if(!res.ok)throw new CheckoutError(`${code}_${res.status}`,status);
  return data;
}

function bearerToken(req){
  const value=(req.headers.get("authorization")||"").trim();
  const match=value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim()||"";
}

async function authenticatedUser(supabaseUrl,publishable,token){
  if(!token)throw new CheckoutError("AUTH_REQUIRED",401);
  const user=await fetchJson(
    new URL("/auth/v1/user",supabaseUrl).href,
    {headers:{apikey:publishable,Authorization:`Bearer ${token}`}},
    "AUTH_INVALID",
    401
  );
  if(!user?.id||!user?.email)throw new CheckoutError("AUTH_INVALID",401);
  return user;
}

async function oneRow(supabaseUrl,key,table,filters,select){
  const url=new URL(`/rest/v1/${table}`,supabaseUrl);
  url.searchParams.set("select",select);
  for(const [field,value] of Object.entries(filters))url.searchParams.set(field,`eq.${value}`);
  url.searchParams.set("limit","2");
  const rows=await fetchJson(url.href,{headers:backendHeaders(key)},"SUPABASE_LOOKUP");
  if(!Array.isArray(rows)||rows.length!==1)throw new CheckoutError("ACCOUNT_STATE_INVALID",409);
  return rows[0];
}

function returnUrl(){
  const value=env("PEPDAY_BILLING_RETURN_URL");
  try{
    const url=new URL(value);
    if(url.protocol!=="https:")throw new Error();
    return url.href;
  }catch{throw new CheckoutError("BILLING_RETURN_URL_INVALID",500)}
}

export default {
  async fetch(req){
    try{
      if(req.method==="OPTIONS")return new Response(null,{status:204,headers:corsHeaders});
      if(req.method!=="POST")return response(405,"METHOD_NOT_ALLOWED");
      const size=Number(req.headers.get("content-length")||0);
      if(Number.isFinite(size)&&size>4096)return response(413,"REQUEST_TOO_LARGE");

      const supabaseUrl=env("SUPABASE_URL");
      const publishable=publishableKey();
      const adminKey=secretKey();
      const mpAccessToken=env("MERCADO_PAGO_ACCESS_TOKEN");
      if(!supabaseUrl||!publishable||!adminKey||!mpAccessToken){
        throw new CheckoutError("CHECKOUT_CONFIG_MISSING",500);
      }

      let body;
      try{body=await req.json()}catch{return response(400,"INVALID_JSON")}
      const request=normalizeCheckoutRequest(body);
      if(!request)return response(400,"INVALID_CHECKOUT_REQUEST");

      const user=await authenticatedUser(supabaseUrl,publishable,bearerToken(req));
      const [profile,subscription]=await Promise.all([
        oneRow(
          supabaseUrl,adminKey,"profiles",{id:user.id},
          "id,is_adult_confirmed,terms_accepted_at,privacy_accepted_at"
        ),
        oneRow(
          supabaseUrl,adminKey,"subscriptions",{user_id:user.id},
          "id,user_id,status,plan,billing_status,provider_subscription_id"
        )
      ]);

      if(!profile.is_adult_confirmed||!profile.terms_accepted_at||!profile.privacy_accepted_at){
        return response(409,"PROFILE_INCOMPLETE");
      }
      if(!canCreateCheckout(subscription))return response(409,"SUBSCRIPTION_ALREADY_ACTIVE");

      const recurring=checkoutRecurring(request.plan);
      if(!recurring)throw new CheckoutError("PLAN_NOT_CONFIGURED",503);

      const externalReference=checkoutExternalReference(subscription.id,request.plan);
      if(!externalReference)throw new CheckoutError("SUBSCRIPTION_REFERENCE_INVALID",500);

      const checkout=await fetchJson(
        "https://api.mercadopago.com/preapproval",
        {
          method:"POST",
          headers:{
            Authorization:`Bearer ${mpAccessToken}`,
            "Content-Type":"application/json",
            "X-Idempotency-Key":request.requestId
          },
          body:JSON.stringify({
            reason:`PepDay PRO ${request.plan==='annual'?'Anual':'Mensal'}`,
            payer_email:user.email,
            external_reference:externalReference,
            auto_recurring:recurring,
            back_url:returnUrl(),
            status:"pending"
          })
        },
        "MP_CREATE_SUBSCRIPTION"
      );

      if(!checkout?.id||!validCheckoutUrl(checkout?.init_point)){
        throw new CheckoutError("MP_CHECKOUT_RESPONSE_INVALID",503);
      }

      return response(200,"CHECKOUT_READY",{
        plan:request.plan,
        checkout_url:checkout.init_point
      });
    }catch(error){
      const status=error instanceof CheckoutError?error.status:500;
      const code=error instanceof CheckoutError?error.code:"UNEXPECTED_ERROR";
      console.error("PepDay Mercado Pago checkout:",code);
      return response(status,code);
    }
  }
};
