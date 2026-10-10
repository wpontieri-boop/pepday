import {documentHandler} from './document-core.mjs';
const env=name=>(Deno.env.get(name)||'').trim();
const jsonKey=name=>{try{return JSON.parse(env(name)).default||''}catch{return ''}};
export default {fetch:documentHandler({url:env('SUPABASE_URL'),publishable:jsonKey('SUPABASE_PUBLISHABLE_KEYS')||env('SUPABASE_ANON_KEY'),secret:env('SUPABASE_SERVICE_ROLE_KEY')||jsonKey('SUPABASE_SECRET_KEYS')})};
