// TEST-only portal transport. Custom invite+OTP/session auth is enforced by SQL.
// No SMTP, WhatsApp, Auth user creation, payment provider or personal file upload.
export const PORTAL_URL='https://fsbqpyyprtymwrmzsacp.supabase.co';
export const PORTAL_ORIGIN='https://homologacao.pepday.com.br';
export const SAMPLE='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4XcAAAAASUVORK5CYII=';
export const SAMPLE_SHA='1fd6daf3d23b0bc130e484733d9659da3299dd684cfad2b80cd95d8b4e5df757';
export const BUCKET='partner-portal-synthetic-test';
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
async function boundedBody(request){
 const reader=request.body?.getReader();if(!reader)throw Error('INVALID');
 const chunks=[];let size=0;try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>16000){await reader.cancel();throw Error('INVALID')}chunks.push(r.value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}return JSON.parse(new TextDecoder().decode(bytes));
}
const validToken=t=>typeof t==='string'&&/^[A-Za-z0-9_-]{43}$/.test(t);
const validId=t=>typeof t==='string'&&/^[0-9a-f-]{36}$/i.test(t);
export function portalHandler({url,secret,fetcher=fetch}){
 return async request=>{
 const headers={'Access-Control-Allow-Origin':PORTAL_ORIGIN,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'content-type,apikey',
 'Vary':'Origin','Cache-Control':'no-store','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
 const fail=(status=403)=>Response.json({ok:false,code:'PORTAL_ACCESS_DENIED'},{status,headers});
 if(url!==PORTAL_URL||!secret||request.headers.get('origin')!==PORTAL_ORIGIN)return fail();
 if(new URL(request.url).search)return fail(400);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST')return fail(405);
 if(!(request.headers.get('content-type')||'').startsWith('application/json'))return fail(400);
 try{
 const data=await boundedBody(request);if(!data||typeof data!=='object'||Array.isArray(data))return fail(400);
 const action=data.action;
 if(!['challenge','verify','view','save','submit','logout','opt_out','contract_seen','accept_contract','upload_sample','download_sample'].includes(action))return fail(400);
 if(['challenge','verify'].includes(action)){
 if(!validToken(data.invite)||action==='verify'&&(!validId(data.challenge)||!/^[0-9]{6}$/.test(data.code||'')))return fail();
 // Trusted gateway connection IP only; never accept an ip_hash/client IP in the JSON.
 data.ip_hash=await hash(new TextEncoder().encode('partner-portal-test:'+ (request.headers.get('x-forwarded-for')?.split(',')[0].trim()||'unknown')));
 }else if(!validToken(data.session))return fail();
 const serverHeaders={apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json'};
 const rpc=async payload=>{
 const r=await fetcher(url+'/rest/v1/rpc/partner_portal_exchange',{method:'POST',headers:serverHeaders,body:JSON.stringify({p_request:payload})});
 if(!r.ok)throw Error('DENIED');const result=await r.json();if(result?.ok!==true)throw Error('DENIED');return result;
 };
 if(action==='upload_sample'){
 // Entire body must be the known 68-byte QA image; no arbitrary base64/file allowed.
 if(data.sample!==SAMPLE)return fail(400);
 const bytes=Uint8Array.from(atob(SAMPLE),c=>c.charCodeAt(0));
 if(bytes.length!==68||await hash(bytes)!==SAMPLE_SHA)return fail();
 const grant=await rpc({action:'doc_prepare',session:data.session,sha256:SAMPLE_SHA,size:68,mime:'image/png'});
 if(!validId(grant.id)||!new RegExp('^[0-9a-f-]{36}/'+grant.id+'$','i').test(grant.path)||!validToken(grant.upload_token))return fail();
 const endpoint=url+'/storage/v1/object/'+BUCKET+'/'+grant.path;
 const uploaded=await fetcher(endpoint,{method:'POST',headers:{...serverHeaders,'Content-Type':'image/png','x-upsert':'false'},body:bytes});
 if(!uploaded.ok)return fail(503);
 try{await rpc({action:'doc_complete',session:data.session,id:grant.id,upload_token:grant.upload_token})}
 catch(e){await fetcher(endpoint,{method:'DELETE',headers:serverHeaders});throw e}
 return Response.json({ok:true,id:grant.id},{headers});
 }
 if(action==='download_sample'){
 if(!validId(data.id))return fail();
 const grant=await rpc({action:'doc_access',session:data.session,id:data.id});
 if(!/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/i.test(grant.path)||grant.sha256!==SAMPLE_SHA)return fail();
 const response=await fetcher(url+'/storage/v1/object/'+BUCKET+'/'+grant.path,{headers:serverHeaders});
 if(!response.ok)return fail(503);
 const length=Number(response.headers.get('content-length'));if(length&&length!==68)return fail();
 const reader=response.body?.getReader();if(!reader)return fail();const chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>68){await reader.cancel();return fail()}chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(size);let p=0;for(const c of chunks){bytes.set(c,p);p+=c.length}
 if(size!==68||await hash(bytes)!==SAMPLE_SHA)return fail();
 return new Response(bytes,{headers:{...headers,'Content-Type':'image/png','Content-Disposition':'attachment; filename="amostra-QA.png"'}});
 }
 return Response.json(await rpc(data),{headers});
 }catch{return fail()}
 };
}
