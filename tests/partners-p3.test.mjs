import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {cents,canonicalPayment,allPages,reconcileSource,testEnvironment} from '../supabase/functions/partner-finance-worker/finance-core.mjs';
const subscription='10000000-0000-4000-8000-000000000001';
const contract={id:'c1',payer_id:10,external_reference:`pepday:${subscription}:monthly`};
const invoice={id:1,preapproval_id:'c1',payment:{id:11}};
const payment={id:11,collector_id:99,transaction_amount:'9.90',transaction_amount_refunded:'0.00',currency_id:'BRL',date_approved:'2026-01-01T00:00:00Z',date_last_updated:'2026-01-02T00:00:00Z',status:'approved',live_mode:false};
test('P3 precisa em centavos, sem preço padrão/arredondamento de entrada',()=>{assert.equal(cents('9.90'),990);assert.equal(cents(14.9),1490);assert.equal(cents('99.90'),9990);for(const v of [null,undefined,'1.001','-1','NaN','1e3'])assert.equal(cents(v),null)});
test('P3 aceita somente TEST e sandbox',()=>{assert.ok(testEnvironment('https://fsbqpyyprtymwrmzsacp.supabase.co','false'));assert.equal(testEnvironment('https://oslefjmwfnddxlotalxu.supabase.co','false'),false);assert.equal(testEnvironment('https://fsbqpyyprtymwrmzsacp.supabase.co','true'),false)});
test('P3 moeda/valor ausente e disputas não viram comissão aprovada',()=>{assert.equal(canonicalPayment({...payment,transaction_amount:null},invoice,contract,subscription,'11',true).state,'review');assert.equal(canonicalPayment(payment,invoice,contract,subscription,'11',true,true).state,'disputed');assert.throws(()=>canonicalPayment({...payment,live_mode:true},invoice,contract,subscription,'11',true),/MAPPING/)});
test('P3 mensal/anual/recovery vêm do recurso canônico',()=>{for(const plan of ['monthly','annual'])assert.equal(canonicalPayment(payment,invoice,{...contract,external_reference:`pepday:${subscription}:${plan}`},subscription,'11',true).plan,plan);assert.equal(canonicalPayment(payment,invoice,{...contract,external_reference:`pepday:${subscription}:monthly:recovery:20000000-0000-4000-8000-000000000001`},subscription,'11',true).plan,'recovery')});
test('P3 paginação incompleta/mutável falha fechada',async()=>{await assert.rejects(allPages(async()=>({results:[],paging:{total:1}}),'/x'),/INCOMPLETE/);await assert.rejects(allPages(async()=>({results:[]}),'/x'),/INCOMPLETE/);assert.deepEqual(await allPages(async()=>({results:[],paging:{total:0}}),'/x'),[])});
test('P3 reconcilia antes de liberar e histórico ausente não libera',async()=>{
 for(const historical of [[],['missing']]){const sequence=[];const get=async path=>path.startsWith('/preapproval/c1')?contract:path.startsWith('/preapproval/search')?{results:[contract],paging:{total:1}}:path.startsWith('/authorized_payments')?{results:[invoice],paging:{total:1}}:path.startsWith('/v1/payments/11')?payment:{results:[],paging:{total:0}};
 await reconcileSource({subscription_id:subscription,provider_id:'c1',partner_id:'p1',historical_invoices:historical},{get,ingest:async(id,p)=>{assert.equal(id,subscription);sequence.push(p.history_complete?'ingest':'review')},release:async()=>sequence.push('release')});assert.deepEqual(sequence,historical.length?['review']:['ingest','release'])}
});
test('P3 RPCs financeiras têm guardas e não alteram billing comercial',async()=>{
 const sql=await readFile(new URL('../supabase/migrations/20261009181605_partners_p3_test.sql',import.meta.url),'utf8');
 assert.match(sql,/finance_enabled boolean not null default false/);assert.match(sql,/partner_admin_assert\(true,true\)/);assert.match(sql,/expires_at>statement_timestamp\(\)/);assert.match(sql,/PARTNER_LEDGER_APPEND_ONLY/);assert.match(sql,/round\(/);assert.doesNotMatch(sql,/create or replace function public\.(apply_billing_event|claim_card_acquisition|get_entitlement)/);
 const edge=await readFile(new URL('../supabase/functions/partner-finance-worker/index.mjs',import.meta.url),'utf8');assert.doesNotMatch(edge,/method:\s*['"](?:POST|PUT|DELETE)['"]/);assert.match(edge,/consume_partner_finance_invocation/);
});
test('P3 paginação respeita limite reduzido do provedor e rejeita repetição',async()=>{
 const pages=[{paging:{total:3,offset:0,limit:2},results:[{id:1},{id:2}]},{paging:{total:3,offset:2,limit:2},results:[{id:3}]}];let n=0;
 assert.equal((await allPages(async path=>{assert.match(path,n===0?/offset=0/:/offset=2/);return pages[n++]},'/x')).length,3);
 n=0;await assert.rejects(allPages(async()=>({...pages[n++],results:[{id:1},{id:1}]}),'/x'),/INCOMPLETE/);
});
test('P3 falha do provedor não ingere nem libera saldo',async()=>{
 let changes=0;await assert.rejects(reconcileSource({subscription_id:subscription,provider_id:'c1',partner_id:'p1'},{get:async()=>{throw Error('unavailable')},ingest:async()=>changes++,release:async()=>changes++}),/unavailable/);assert.equal(changes,0);
});
test('P3 vínculo incorreto, modo LIVE e data ausente falham fechados',()=>{
 assert.throws(()=>canonicalPayment(payment,{...invoice,preapproval_id:'other'},contract,subscription,'11',true),/MAPPING/);
 assert.throws(()=>canonicalPayment({...payment,date_approved:null},invoice,contract,subscription,'11',true),/TIME/);
 assert.equal(canonicalPayment({...payment,transaction_amount_refunded:'4.95',status:'refunded'},invoice,contract,subscription,'11',true).refunded_cents,495);
});
test('P3 disputa é consultada com identidade canônica do vendedor',async()=>{
 const get=async(path,headers)=>path.startsWith('/preapproval/c1')?contract:path.startsWith('/preapproval/search')?{results:[contract],paging:{total:1}}:path.startsWith('/authorized_payments')?{results:[invoice],paging:{total:1}}:path.startsWith('/v1/payments/11')?payment:(assert.equal(headers['X-Caller-Id'],'99'),{results:[{id:'case1',documentation_status:'pending',coverage_applied:true}],paging:{total:1}});
 await reconcileSource({subscription_id:subscription,provider_id:'c1',partner_id:'p1'},{get,ingest:async(id,p)=>assert.equal(p.state,'disputed'),release:async()=>{}});
});
