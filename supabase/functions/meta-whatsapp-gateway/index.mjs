// Deployable ONLY to PepDay TEST, default closed. No Meta credentials or real sends.
// Does not forward owner messages while the Central IA service is unimplemented.
// Does not persist status/opt-out while provider and partner contacts are unbound.
import {metaHttpHandler} from './http-core.mjs';
const env=k=>(Deno.env.get(k)||'').trim();
// Even if a provider token exists, this worker has NO outbound Graph API path.
export default {fetch:metaHttpHandler({
 mode:env('META_WEBHOOK_TEST_SYNTHETIC_MODE')==='enabled'?'test_synthetic':'disabled',
 appSecret:env('META_APP_SECRET'),
 verifyToken:env('META_WEBHOOK_VERIFY_TOKEN'),
 phoneNumberId:env('META_PHONE_NUMBER_ID'),
 wabaId:env('META_WABA_ID'),
 ownerWaId:env('META_OWNER_WA_ID'),
 centralEnabled:false,ownerStepUp:false
})};
