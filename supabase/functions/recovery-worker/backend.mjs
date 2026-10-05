export const env=name=>(Deno.env.get(name)||'').trim();
export function secretKey(){const modern=env('SUPABASE_SECRET_KEYS');
  if(modern)return JSON.parse(modern).default;return env('SUPABASE_SERVICE_ROLE_KEY');}
export function backendHeaders(key){return key.startsWith('sb_secret_')?{apikey:key,'Content-Type':'application/json'}:
  {apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};}
export async function rpc(name,args={}){
  const response=await fetch(new URL('/rest/v1/rpc/'+name,env('SUPABASE_URL')),
    {method:'POST',headers:backendHeaders(secretKey()),body:JSON.stringify(args),signal:AbortSignal.timeout(15000)});
  if(!response.ok){const data=await response.json().catch(()=>({}));
    throw new Error('RPC_'+name.toUpperCase()+'_'+response.status+'_'+String(data.code||'UNKNOWN').toUpperCase().replace(/[^A-Z0-9_]/g,'_'));}
  return response.status===204?null:await response.json();
}
export async function provider(path,method='GET',body,requestId){
  const headers={Authorization:'Bearer '+env('MERCADO_PAGO_ACCESS_TOKEN'),'Content-Type':'application/json'};
  if(requestId)headers['X-Idempotency-Key']=requestId;
  const response=await fetch('https://api.mercadopago.com'+path,{method,headers,
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  if(!response.ok){const data=await response.json().catch(()=>({}));
    const detail=String(data.message||data.cause?.[0]?.description||'UNKNOWN')
      .replace(/[^\s@]+@[^\s@]+/g,'REDACTED').replace(/(?:APP_USR|TEST|Bearer)[-\s][A-Za-z0-9_-]+/gi,'REDACTED')
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'REDACTED').slice(0,180).toUpperCase().replace(/[^A-Z0-9_]+/g,'_');
    throw new Error('MP_RECOVERY_'+method+'_'+response.status+'_'+detail);}
  return await response.json();
}
