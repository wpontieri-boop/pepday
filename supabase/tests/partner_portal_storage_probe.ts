// HISTORICAL QA ONLY. Helper is RETIRED (410); consume RPC removed. Do not redeploy.
const env=n=>Deno.env.get(n)||'',secret=env('SUPABASE_SERVICE_ROLE_KEY')||JSON.parse(env('SUPABASE_SECRET_KEYS')||'{}').default;
const URL='https://fsbqpyyprtymwrmzsacp.supabase.co',bucket='partner-portal-synthetic-test',sample='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4XcAAAAASUVORK5CYII=';
Deno.serve(async req=>{
 if(env('SUPABASE_URL')!==URL||req.method!=='POST')return new Response('DENIED',{status:403});
 const headers={apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json'};
 const consumed=await fetch(URL+'/rest/v1/rpc/consume_partner_portal_storage_qa',{method:'POST',headers,body:JSON.stringify({p_token:req.headers.get('x-qa-token')||''})});
 if(!consumed.ok||await consumed.json()!==true)return new Response('DENIED',{status:403});
 const path='qa-'+crypto.randomUUID()+'/sample.png',endpoint=URL+'/storage/v1/object/'+bucket+'/'+path,bytes=Uint8Array.from(atob(sample),c=>c.charCodeAt(0));
 let passed=false,cleaned=false;
 try{
 const upload=await fetch(endpoint,{method:'POST',headers:{...headers,'Content-Type':'image/png','x-upsert':'false'},body:bytes});if(!upload.ok)throw Error();
 const read=await fetch(endpoint,{headers});if(!read.ok)throw Error();const actual=new Uint8Array(await read.arrayBuffer());if(actual.length!==68||actual.some((v,i)=>v!==bytes[i]))throw Error();
 const pub=await fetch(URL+'/storage/v1/object/public/'+bucket+'/'+path);if(pub.ok)throw Error();
 const anon=await fetch(endpoint);if(anon.ok)throw Error();
 passed=true;
 }catch{}finally{
 const removed=await fetch(URL+'/storage/v1/object/'+bucket,{method:'DELETE',headers,body:JSON.stringify({prefixes:[path]})});
 const check=await fetch(endpoint,{headers});cleaned=removed.ok&&!check.ok;
 }
 return Response.json({ok:passed&&cleaned,code:passed&&cleaned?'PASS_NEW_PORTAL_PNG_PRIVATE_REMOVED':'QA_FAILED',bytes:68,publicDenied:passed,anonDenied:passed,removed:cleaned},{status:passed&&cleaned?200:503,headers:{'Cache-Control':'no-store'}});
});
