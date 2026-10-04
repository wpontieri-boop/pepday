class AdminInviteError extends Error {
  constructor(code,status=400){super(code);this.name='AdminInviteError';this.code=code;this.status=status}
}

const env=name=>(Deno.env.get(name)||'').trim();

function jsonEnvKey(name){
  const raw=env(name);
  if(!raw)return '';
  try{
    const parsed=JSON.parse(raw);
    return typeof parsed?.default==='string'?parsed.default:'';
  }catch{return ''}
}

function publishableKey(){
  return jsonEnvKey('SUPABASE_PUBLISHABLE_KEYS')||env('SUPABASE_ANON_KEY');
}

function adminKey(){
  return env('SUPABASE_SERVICE_ROLE_KEY')||jsonEnvKey('SUPABASE_SECRET_KEYS');
}

function adminHeaders(key){
  const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
  return headers;
}

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Access-Control-Allow-Headers':'authorization, content-type, apikey, x-client-info',
};

function response(status,code,extra={}){
  return Response.json({ok:status>=200&&status<300,code,...extra},{
    status,headers:{...corsHeaders,'Cache-Control':'no-store'}
  });
}

function bearerToken(req){
  const value=(req.headers.get('authorization')||'').trim();
  const match=value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim()||'';
}

function normalize(body){
  const email=typeof body?.email==='string'?body.email.trim().toLowerCase():'';
  const accessLevel=typeof body?.access_level==='string'?body.access_level.trim().toLowerCase():'';
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>320)return null;
  if(!['admin','viewer'].includes(accessLevel))return null;
  return {email,accessLevel};
}

async function readJson(res){
  try{return await res.json()}catch{return null}
}

async function ensureOwner(supabaseUrl,publishable,token){
  const res=await fetch(new URL('/rest/v1/rpc/get_admin_team',supabaseUrl),{
    method:'POST',
    headers:{apikey:publishable,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:'{}'
  });
  if(res.status===401||res.status===403)throw new AdminInviteError('OWNER_MFA_REQUIRED',403);
  if(!res.ok)throw new AdminInviteError('OWNER_ACCESS_REQUIRED',403);
}

async function findProfile(supabaseUrl,key,email){
  const url=new URL('/rest/v1/profiles',supabaseUrl);
  url.searchParams.set('select','id,email');
  url.searchParams.set('email',`eq.${email}`);
  url.searchParams.set('limit','2');
  const res=await fetch(url,{headers:adminHeaders(key)});
  if(!res.ok)throw new AdminInviteError('PROFILE_LOOKUP_FAILED',503);
  const rows=await readJson(res);
  if(!Array.isArray(rows))throw new AdminInviteError('PROFILE_LOOKUP_INVALID',503);
  if(rows.length>1)throw new AdminInviteError('PROFILE_LOOKUP_AMBIGUOUS',500);
  return rows[0]||null;
}

async function createUser(supabaseUrl,key,email){
  const res=await fetch(new URL('/auth/v1/admin/users',supabaseUrl),{
    method:'POST',
    headers:adminHeaders(key),
    body:JSON.stringify({
      email,
      email_confirm:true,
      user_metadata:{pepday_admin_member:true}
    })
  });
  const data=await readJson(res);
  if(!res.ok)throw new AdminInviteError('AUTH_USER_CREATE_FAILED',409);
  if(!data?.id)throw new AdminInviteError('AUTH_USER_CREATE_INVALID',503);
  return data;
}

async function setMembership(supabaseUrl,publishable,token,{email,accessLevel}){
  const res=await fetch(new URL('/rest/v1/rpc/admin_set_team_member',supabaseUrl),{
    method:'POST',
    headers:{apikey:publishable,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({p_email:email,p_access_level:accessLevel,p_active:true})
  });
  const data=await readJson(res);
  if(!res.ok)throw new AdminInviteError('MEMBERSHIP_UPDATE_FAILED',res.status===403?403:503);
  return data;
}

export default {
  async fetch(req){
    try{
      if(req.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders});
      if(req.method!=='POST')return response(405,'METHOD_NOT_ALLOWED');
      const size=Number(req.headers.get('content-length')||0);
      if(Number.isFinite(size)&&size>4096)return response(413,'REQUEST_TOO_LARGE');

      const supabaseUrl=env('SUPABASE_URL');
      const publishable=publishableKey();
      const key=adminKey();
      const token=bearerToken(req);
      if(!supabaseUrl||!publishable||!key)throw new AdminInviteError('CONFIG_MISSING',500);
      if(!token)throw new AdminInviteError('AUTH_REQUIRED',401);

      let body;
      try{body=await req.json()}catch{return response(400,'INVALID_JSON')}
      const request=normalize(body);
      if(!request)return response(400,'INVALID_REQUEST');

      await ensureOwner(supabaseUrl,publishable,token);
      let profile=await findProfile(supabaseUrl,key,request.email);
      let created=false;
      if(!profile){
        await createUser(supabaseUrl,key,request.email);
        profile=await findProfile(supabaseUrl,key,request.email);
        created=true;
      }
      if(!profile?.id)throw new AdminInviteError('PROFILE_BOOTSTRAP_FAILED',503);

      const membership=await setMembership(supabaseUrl,publishable,token,request);
      return response(200,'ADMIN_MEMBER_READY',{
        created,
        member:{
          user_id:membership?.user_id||profile.id,
          email:request.email,
          access_level:request.accessLevel,
          active:true
        }
      });
    }catch(error){
      const status=error instanceof AdminInviteError?error.status:500;
      const code=error instanceof AdminInviteError?error.code:'UNEXPECTED_ERROR';
      console.error('PepDay admin team invite:',code);
      return response(status,code);
    }
  }
};
