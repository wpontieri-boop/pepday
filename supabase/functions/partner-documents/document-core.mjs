export const TEST_URL='https://fsbqpyyprtymwrmzsacp.supabase.co';
export const BUCKET='partner-documents-test';
const MAX=5242880;
export async function bytesLimited(stream,max=MAX){
 if(!stream)return new Uint8Array();const reader=stream.getReader(),chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('DOCUMENT_TOO_LARGE')}chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}return bytes;
}
export async function fingerprint(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('')}
export function validMime(bytes,mime){
 if(mime==='application/pdf')return new TextDecoder().decode(bytes.slice(0,5))==='%PDF-';
 if(mime==='image/png')return bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
 if(mime==='image/jpeg')return bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 return false;
}
export function documentHandler({url,publishable,secret,fetcher=fetch}){
 return async request=>{
 const origin=request.headers.get('origin');const allowed=!origin||['https://homologacao.pepday.com.br','https://pepday-v3-homologacao.onrender.com'].includes(origin);
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':origin||'https://homologacao.pepday.com.br','Vary':'Origin','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-document-id,x-document-operation'};
 const fail=(status,code)=>Response.json({ok:false,code},{status,headers});
 if(url!==TEST_URL)return fail(403,'TEST_ONLY');if(!allowed)return fail(403,'ORIGIN_DENIED');
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});if(request.method!=='POST')return fail(405,'METHOD_NOT_ALLOWED');
 const authorization=request.headers.get('authorization')||'',id=request.headers.get('x-document-id'),op=request.headers.get('x-document-operation');
 if(!/^Bearer \S+$/i.test(authorization))return fail(401,'AUTH_REQUIRED');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||'')||!['upload','download'].includes(op))return fail(400,'INVALID_DOCUMENT_REQUEST');
 if(Number(request.headers.get('content-length')||0)>MAX)return fail(413,'DOCUMENT_TOO_LARGE');
 const rpc=async(name,args,server=false)=>{
  const result=await fetcher(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:server?secret:publishable,Authorization:server?`Bearer ${secret}`:authorization,'Content-Type':'application/json'},body:JSON.stringify(args)});
  if(!result.ok)throw Error('DOCUMENT_ACCESS_DENIED');return result.json();
 };
 try{
  // JWT validation and current OWNER/AAL2/session plus single-use access lease in SQL.
  const grant=await rpc('admin_partner_document_access',{p_document:id,p_operation:op});
  if(!grant||!new RegExp(`^[0-9a-f-]{36}/${id}$`,'i').test(grant.path)||!grant.operation_token)throw Error('DOCUMENT_ACCESS_DENIED');
  const endpoint=`${url}/storage/v1/object/${BUCKET}/${grant.path}`,serverHeaders={apikey:secret,Authorization:`Bearer ${secret}`};
  let bytes;
  if(op==='upload'){
   bytes=await bytesLimited(request.body);
   if(bytes.length!==grant.size_bytes||request.headers.get('content-type')!==grant.mime_type||!validMime(bytes,grant.mime_type)||await fingerprint(bytes)!==grant.sha256)throw Error('DOCUMENT_INTEGRITY_FAILED');
   const uploaded=await fetcher(endpoint,{method:'POST',headers:{...serverHeaders,'Content-Type':grant.mime_type,'x-upsert':'false','Cache-Control':'no-store'},body:bytes});
   if(!uploaded.ok){
    // Retry after an uncertain response may see the immutable object already stored.
    if(uploaded.status!==409&&uploaded.status!==400)throw Error('DOCUMENT_STORAGE_UNAVAILABLE');
    const existing=await fetcher(endpoint,{headers:serverHeaders});if(!existing.ok)throw Error('DOCUMENT_STORAGE_UNAVAILABLE');
    const stored=await bytesLimited(existing.body);if(await fingerprint(stored)!==grant.sha256)throw Error('DOCUMENT_INTEGRITY_FAILED');
   }
  }else{
   const stored=await fetcher(endpoint,{headers:serverHeaders});if(!stored.ok)throw Error('DOCUMENT_STORAGE_UNAVAILABLE');bytes=await bytesLimited(stored.body);
   if(bytes.length!==grant.size_bytes||await fingerprint(bytes)!==grant.sha256)throw Error('DOCUMENT_INTEGRITY_FAILED');
  }
  await rpc('partner_document_complete',{p_document:id,p_token:grant.operation_token,p_sha256:await fingerprint(bytes),p_size:bytes.length,p_mime:grant.mime_type},true);
  if(op==='download')return new Response(bytes,{headers:{...headers,'Content-Type':grant.mime_type,'Content-Disposition':'attachment; filename="documento-privado"'}});
  return Response.json({ok:true,code:'DOCUMENT_STORED',id},{headers});
 }catch(e){return fail(e.message==='DOCUMENT_TOO_LARGE'?413:e.message==='DOCUMENT_STORAGE_UNAVAILABLE'?503:403,['DOCUMENT_TOO_LARGE','DOCUMENT_STORAGE_UNAVAILABLE','DOCUMENT_INTEGRITY_FAILED'].includes(e.message)?e.message:'DOCUMENT_ACCESS_DENIED')}
 };
}
