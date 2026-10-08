const TEST_URL='https://oslefjmwfnddxlotalxu.supabase.co';
const ORIGIN='https://pepday.com.br';
export function createHandler({env,fetch:fetcher=fetch}){
  return async req=>{
    const headers={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'content-type, apikey, x-client-info','Cache-Control':'no-store','Vary':'Origin'};
    const reply=(status,data)=>Response.json(data,{status,headers});
    if(req.headers.get('origin')&&req.headers.get('origin')!==ORIGIN)return reply(403,{code:'ORIGIN_DENIED'});
    if(env('SUPABASE_URL')!==TEST_URL)return reply(403,{code:'PARTNERS_PRODUCTION_ONLY'});
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(req.method!=='POST')return reply(405,{code:'METHOD_NOT_ALLOWED'});
    try{
      const reader=req.body?.getReader();let size=0;const chunks=[];
      if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>512){await reader.cancel();return reply(413,{code:'REQUEST_TOO_LARGE'})}chunks.push(value)}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
      const raw=new TextDecoder().decode(bytes);
      const body=JSON.parse(raw);
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['query','ref'].includes(k)))return reply(400,{code:'INVALID_QUERY'});
      const query=body.query??'',ref=body.ref??'';
      if(typeof query!=='string'||typeof ref!=='string'||query.length>80||ref.length>100||ref&&!/^[a-z0-9-]+$/i.test(ref))return reply(400,{code:'INVALID_QUERY'});
      let key=env('SUPABASE_SERVICE_ROLE_KEY');
      if(!key){try{key=JSON.parse(env('SUPABASE_SECRET_KEYS')||'{}').default}catch{}}
      if(!key)return reply(503,{code:'UNAVAILABLE'});
      const res=await fetcher(TEST_URL+'/rest/v1/rpc/partner_public_search',{
        method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
        body:JSON.stringify({p_query:query.trim(),p_ref:ref.trim()})
      });
      if(!res.ok)return reply(503,{code:'UNAVAILABLE'});
      const data=await res.json();
      if(data.limited)return reply(429,{code:'RATE_LIMITED'});
      // Allowlist projection is a second privacy boundary, independent of SQL.
      const fields=['id','public_name','partner_type','city','description','slug','public_code'];
      return reply(200,{enabled:data.enabled===true,partners:(Array.isArray(data.partners)?data.partners:[]).slice(0,10).map(p=>Object.fromEntries(fields.map(k=>[k,p[k]])))});
    }catch{return reply(400,{code:'INVALID_QUERY'})}
  };
}
export default {fetch:req=>createHandler({env:name=>(Deno.env.get(name)||'').trim()})(req)};
