// Verifies the byte-identical TEST fiscal migration recovered from Supabase's migration history.
// No DB connection or migration execution; do not count this as a real integration E2E.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const path=new URL('../supabase/migrations/20261009211431_partners_p3_fiscal_test.sql',import.meta.url);
const src=await readFile(path,'utf8');
test('P3 fiscal migration matches immutable TEST history byte-for-byte',()=>{
 assert.equal(src.length,36076);
 assert.equal(createHash('md5').update(src).digest('hex'),'cc707dc687f2a73bbd2912a2224d58e6');
 assert.match(src,/https:\/\/fsbqpyyprtymwrmzsacp\.supabase\.co/);
 assert.match(src,/raise exception 'PARTNERS_TEST_ONLY'/);
});
test('private document storage and schema guards retained',()=>{
 for(const table of ['partner_fiscal_reviews','partner_documents','partner_fiscal_events'])assert.match(src,new RegExp('create table public\\.'+table+'\\('));
 assert.match(src,/false,5242880,array\['application\/pdf','image\/png','image\/jpeg'\]/);
 assert.match(src,/as restrictive for all to anon,authenticated/);
 assert.match(src,/enable row level security/);
 assert.match(src,/PARTNER_FISCAL_AUDIT_APPEND_ONLY/);
 assert.match(src,/grant execute on function public\.partner_document_complete\(uuid,text,text,integer,text\) to service_role/);
});
test('fiscal ledger does not assume rates and blocks prior to approval',()=>{
 for(const fn of ['partner_retention_valid','partner_fiscal_ready','partner_batch_fiscal_ready','admin_partner_fiscal_action','admin_partner_document_access'])assert.match(src,new RegExp('function public\\.'+fn+'\\('));
 assert.match(src,/fiscal_state text not null default 'pending'/);
 assert.match(src,/r->>'validated' is distinct from 'true'/);
 assert.doesNotMatch(src,/sb_secret_[a-z0-9_-]{16,}|-----BEGIN PRIVATE KEY-----/i);
});
