// TEST-only persistent ingress. No Graph API/LLM, no real contacts or owner forwarding.
import {persistentMetaHandler} from './persistence-core.mjs';
const env=k=>(Deno.env.get(k)||'').trim();
const jsonKey=k=>{try{return JSON.parse(env(k)).default||''}catch{return ''}};
export default {fetch:persistentMetaHandler({
 url:env('SUPABASE_URL'),secret:env('SUPABASE_SERVICE_ROLE_KEY')||jsonKey('SUPABASE_SECRET_KEYS'),
 // No caller may enable real send or collection. Mapping is intentionally empty until QA configuration.
 contactBindings:new Map(),
 config:{mode:env('META_WEBHOOK_TEST_SYNTHETIC_MODE')==='enabled'?'test_synthetic':'disabled',
 appSecret:env('META_APP_SECRET'),verifyToken:env('META_WEBHOOK_VERIFY_TOKEN'),
 phoneNumberId:env('META_PHONE_NUMBER_ID'),wabaId:env('META_WABA_ID')}
})};
