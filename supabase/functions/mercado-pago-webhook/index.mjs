import {
  canonicalEventDate,
  effectFromAuthorizedPayment,
  effectFromPreapproval,
  normalizeNotification,
  paidPeriod,
  parsePepDayReference,
  planFromCanonicalSubscription,
  verifyMercadoPagoSignature,
} from "./webhook-core.mjs";

class WebhookError extends Error {
  constructor(code,status=400){super(code);this.name="WebhookError";this.code=code;this.status=status}
}

const env=name=>(Deno.env.get(name)||"").trim();

function supabaseSecretKey(){
  const modern=env("SUPABASE_SECRET_KEYS");
  if(modern){
    try{
      const parsed=JSON.parse(modern);
      if(typeof parsed?.default==="string"&&parsed.default)return parsed.default;
    }catch{throw new WebhookError("SUPABASE_SECRET_CONFIG_INVALID",500)}
  }
  const legacy=env("SUPABASE_SERVICE_ROLE_KEY");
  if(legacy)return legacy;
  throw new WebhookError("SUPABASE_SECRET_MISSING",500);
}

function backendHeaders(key){
  const headers={apikey:key,"Content-Type":"application/json"};
  if(!key.startsWith("sb_secret_"))headers.Authorization=`Bearer ${key}`;
  return headers;
}

async function jsonFetch(url,init,code){
  const response=await fetch(url,init);
  if(!response.ok)throw new WebhookError(`${code}_${response.status}`,503);
  return await response.json();
}

async function mercadoPagoGet(path,accessToken){
  return await jsonFetch(
    `https://api.mercadopago.com${path}`,
    {headers:{Authorization:`Bearer ${accessToken}`,Accept:"application/json"}},
    "MP_FETCH"
  );
}

async function findInternalSubscription(supabaseUrl,key,providerSubscriptionId,externalReference){
  const select="id,status,plan,started_at,current_period_end,grace_until,cancel_at_period_end,provider_status";
  const query=async(field,value)=>{
    const url=new URL("/rest/v1/subscriptions",supabaseUrl);
    url.searchParams.set("select",select);
    url.searchParams.set(field,`eq.${value}`);
    url.searchParams.set("limit","2");
    const rows=await jsonFetch(url.href,{headers:backendHeaders(key)},"SUPABASE_LOOKUP");
    if(!Array.isArray(rows))throw new WebhookError("SUPABASE_LOOKUP_INVALID",503);
    if(rows.length>1)throw new WebhookError("SUBSCRIPTION_MAPPING_AMBIGUOUS",500);
    return rows[0]||null;
  };
  if(providerSubscriptionId){
    const direct=await query("provider_subscription_id",providerSubscriptionId);
    if(direct)return direct;
  }
  const reference=parsePepDayReference(externalReference);
  return reference?await query("id",reference.subscriptionId):null;
}

async function applyBillingEvent(supabaseUrl,key,args){
  const url=new URL("/rest/v1/rpc/apply_billing_event",supabaseUrl);
  return await jsonFetch(url.href,{
    method:"POST",headers:backendHeaders(key),body:JSON.stringify(args)
  },"SUPABASE_APPLY");
}

function expectedLiveMode(){
  const value=env("MERCADO_PAGO_LIVE_MODE");
  if(!["true","false"].includes(value))throw new WebhookError("MP_LIVE_MODE_CONFIG_MISSING",500);
  return value==="true";
}

function sanitizedResponse(status,code,extra={}){
  return Response.json({ok:status>=200&&status<300,code,...extra},{
    status,headers:{"Cache-Control":"no-store"}
  });
}

export default {
  async fetch(req){
    try{
      if(req.method!=="POST")return sanitizedResponse(405,"METHOD_NOT_ALLOWED");

      const webhookSecret=env("MERCADO_PAGO_WEBHOOK_SECRET");
      const accessToken=env("MERCADO_PAGO_ACCESS_TOKEN");
      const supabaseUrl=env("SUPABASE_URL");
      if(!webhookSecret||!accessToken||!supabaseUrl)throw new WebhookError("WEBHOOK_CONFIG_MISSING",500);

      const url=new URL(req.url);
      const dataId=url.searchParams.get("data.id")||url.searchParams.get("data_id")||"";
      const signatureOk=await verifyMercadoPagoSignature({
        secret:webhookSecret,
        xSignature:req.headers.get("x-signature")||"",
        xRequestId:req.headers.get("x-request-id")||"",
        dataId
      });
      if(!signatureOk)return sanitizedResponse(401,"INVALID_SIGNATURE");

      let body;
      try{body=await req.json()}catch{return sanitizedResponse(400,"INVALID_JSON")}
      const notification=normalizeNotification(body,url);
      if(!notification)return sanitizedResponse(400,"INVALID_NOTIFICATION");
      if(notification.liveMode!==expectedLiveMode())return sanitizedResponse(400,"LIVE_MODE_MISMATCH");

      // Mercado Pago recomenda habilitar também o tópico `payment` para Assinaturas.
      // O estado financeiro do PepDay continua canônico por `subscription_authorized_payment`
      // para evitar aplicar a mesma cobrança duas vezes. O evento `payment`, já autenticado
      // pela assinatura HMAC acima, é reconhecido e confirmado sem mutação de billing.
      if(notification.type==="payment"){
        return sanitizedResponse(200,"ACKNOWLEDGED_PAYMENT_MIRROR");
      }

      const key=supabaseSecretKey();
      let preapproval,invoice=null;
      if(notification.type==="subscription_preapproval"){
        preapproval=await mercadoPagoGet(
          `/preapproval/${encodeURIComponent(notification.dataId)}`,accessToken
        );
      }else{
        invoice=await mercadoPagoGet(
          `/authorized_payments/${encodeURIComponent(notification.dataId)}`,accessToken
        );
        if(!invoice?.preapproval_id)throw new WebhookError("PREAPPROVAL_ID_MISSING",503);
        preapproval=await mercadoPagoGet(
          `/preapproval/${encodeURIComponent(String(invoice.preapproval_id))}`,accessToken
        );
      }

      const providerSubscriptionId=String(preapproval?.id||invoice?.preapproval_id||"");
      if(!providerSubscriptionId)throw new WebhookError("CANONICAL_SUBSCRIPTION_ID_MISSING",503);

      const externalReference=preapproval?.external_reference??invoice?.external_reference;
      const internal=await findInternalSubscription(
        supabaseUrl,key,providerSubscriptionId,externalReference
      );
      if(!internal)throw new WebhookError("SUBSCRIPTION_MAPPING_NOT_FOUND",503);

      const effect=invoice
        ?effectFromAuthorizedPayment(invoice,internal)
        :effectFromPreapproval(preapproval,internal);
      if(!effect)return sanitizedResponse(200,"IGNORED_NO_BILLING_EFFECT");

      const eventAt=canonicalEventDate(body,invoice||preapproval);
      if(!eventAt)throw new WebhookError("EVENT_DATE_MISSING",400);

      const plan=invoice?planFromCanonicalSubscription(preapproval,{
        monthlyPlanId:env("MERCADO_PAGO_MONTHLY_PLAN_ID"),
        annualPlanId:env("MERCADO_PAGO_ANNUAL_PLAN_ID")
      }):null;
      const period=effect==="payment_approved"?paidPeriod(invoice,preapproval):null;
      if(effect==="payment_approved"&&(!plan||!period)){
        throw new WebhookError("APPROVED_PAYMENT_WITHOUT_CANONICAL_PLAN_PERIOD",503);
      }

      const result=await applyBillingEvent(supabaseUrl,key,{
        p_provider_event_id:notification.eventId,
        p_event_type:notification.type,
        p_action:notification.action,
        p_provider_resource_id:notification.dataId,
        p_subscription_id:internal.id,
        p_effect:effect,
        p_provider_event_at:eventAt,
        p_provider_subscription_id:providerSubscriptionId,
        p_provider_plan_id:preapproval?.preapproval_plan_id?String(preapproval.preapproval_plan_id):null,
        p_plan:plan,
        p_period_start:period?.start||null,
        p_period_end:period?.end||null
      });

      return sanitizedResponse(200,"PROCESSED",{outcome:result?.outcome||"applied"});
    }catch(error){
      const status=error instanceof WebhookError?error.status:500;
      const code=error instanceof WebhookError?error.code:"UNEXPECTED_ERROR";
      console.error("PepDay Mercado Pago webhook:",code);
      return sanitizedResponse(status,code);
    }
  }
};
