const TEST_URL='https://fsbqpyyprtymwrmzsacp.supabase.co';
const ORIGIN='https://homologacao.pepday.com.br';
export function createHandler({env,fetch:fetcher=fetch}){
  return async req=>{
    const headers={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'content-type, apikey, x-client-info','Cache-Control':'no-store','Vary':'Origin'};
    const reply=(status,data)=>Response.json(data,{status,headers});
    if(req.headers.get('origin')&&req.headers.get('origin')!==ORIGIN)return reply(403,{code:'ORIGIN_DENIED'});
    if(env('SUPABASE_URL')!==TEST_URL)return reply(403,{code:'PARTNERS_TEST_ONLY'});
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(req.method!=='POST')return reply(405,{code:'METHOD_NOT_ALLOWED'});
    try{
      const reader=req.body?.getReader();let size=0;const chunks=[];
      if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024){await reader.cancel();return reply(413,{code:'REQUEST_TOO_LARGE'})}chunks.push(value)}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
      const body=JSON.parse(new TextDecoder().decode(bytes));
      const allowed=['action','ref','source','previous_token','confirm_swap','event_id'];
      if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>!allowed.includes(k)))return reply(400,{code:'INVALID_REQUEST'});
      const {action,ref='',source='link',previous_token='',confirm_swap=false,event_id=null}=body;
      if(!['intent','inspect','clear'].includes(action)||!['link','code','manual'].includes(source)||typeof ref!=='string'||ref.length>100||ref&&!/^[a-z0-9-]+$/i.test(ref)||typeof previous_token!=='string'||previous_token!==''&&!/^[a-f0-9]{64}$/.test(previous_token)||typeof confirm_swap!=='boolean'||event_id!==null&&(typeof event_id!=='string'||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(event_id)))return reply(400,{code:'INVALID_REQUEST'});
      let key=env('SUPABASE_SERVICE_ROLE_KEY');
      if(!key){try{key=JSON.parse(env('SUPABASE_SECRET_KEYS')||'{}').default}catch{}}
      if(!key)return reply(503,{code:'UNAVAILABLE'});
      const res=await fetcher(TEST_URL+'/rest/v1/rpc/partner_referral_action',{
        method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
        body:JSON.stringify({p_action:action,p_ref:ref.trim(),p_source:source,p_previous_token:previous_token,p_confirm_swap:confirm_swap,p_event_id:event_id})
      });
      if(!res.ok)return reply(503,{code:'UNAVAILABLE'});
      const data=await res.json();if(data.limited)return reply(429,{code:'RATE_LIMITED'});
      const result={enabled:data.enabled===true};
      for(const field of ['code','source','expires_at'])if(typeof data[field]==='string')result[field]=data[field];
      if(typeof data.token==='string'&&/^[a-f0-9]{64}$/.test(data.token))result.token=data.token;
      if(data.partner)result.partner=Object.fromEntries(['public_name','city','description','partner_type','slug','public_code'].map(k=>[k,data.partner[k]]));
      return reply(200,result);
    }catch{return reply(400,{code:'INVALID_REQUEST'})}
  };
}
export default {fetch:req=>createHandler({env:name=>(Deno.env.get(name)||'').trim()})(req)};
