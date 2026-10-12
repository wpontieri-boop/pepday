import {portalHandler} from './portal-core.mjs';
const env=name=>(Deno.env.get(name)||'').trim();
const jsonKey=name=>{try{return JSON.parse(env(name)).default||''}catch{return ''}};
export default {fetch:portalHandler({url:env('SUPABASE_URL'),secret:env('SUPABASE_SERVICE_ROLE_KEY')||jsonKey('SUPABASE_SECRET_KEYS')})};
