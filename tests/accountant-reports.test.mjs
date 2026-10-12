import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createAccountantCsv} from '../site/admin/parceiros/financeiro/accountant-reports.mjs';

const known=new Date('2026-10-11T22:00:00Z');
const dataset=()=>({
 can_manage:true,
 partners:[{id:'partner-test-a',public_name:'Parceiro A'},{id:'partner-test-b',public_name:'=HYPERLINK("https://bad")'}],
 commissions:[{id:'c-a',partner_id:'partner-test-a',earned_cents:1000,reserved_cents:0,paid_cents:0,release_at:'2026-11-10',percent:10,plan:'monthly',state:'pending'},
 {id:'c-b',partner_id:'partner-test-b',earned_cents:2000,reserved_cents:2000,paid_cents:0,percent:15,plan:'annual',state:'reserved'}],
 payouts:[{id:'pay-a',partner_id:'partner-test-a',total_cents:900,state:'paid',created_at:'2026-10-10',paid_at:'2026-10-11'},
 {id:'reserved-b',partner_id:'partner-test-b',total_cents:2000,state:'reserved'}]
});
test('OWNER gate: no report for VIEWER/ADMIN or backend can_manage=false',()=>{
 for(const role of ['admin','viewer','unknown'])assert.throws(()=>createAccountantCsv('pre',{dataset:dataset(),role,now:known}),/UNAUTHORIZED/);
 const data=dataset();data.can_manage=false;
 assert.throws(()=>createAccountantCsv('pre',{dataset:data,role:'owner',now:known}),/UNAUTHORIZED/);
});
test('pre report includes all P3 states but NEVER authorizes payments or guesses tax',()=>{
 const {csv,count,filename}=createAccountantCsv('pre',{dataset:dataset(),role:'owner',now:known});
 assert.equal(count,2);
 assert.ok(csv.startsWith('\uFEFF'));
 assert.match(filename,/TEST/);
 assert.match(csv,/PENDENTE_DEFINICAO_CONTADORA/);
 assert.match(csv,/não autoriza PIX/);
 assert.ok(!csv.includes('CPF')&&!csv.includes('PIX_KEY'));
 assert.match(csv,/1000/);assert.match(csv,/2000/);
});
test('post report only lists confirmed paid payouts, no reserved or fake net',()=>{
 const {csv,count}=createAccountantCsv('post',{dataset:dataset(),role:'owner',now:known});
 assert.equal(count,1);assert.match(csv,/pay-a/);
 assert.doesNotMatch(csv,/reserved-b/);
 assert.match(csv,/Conferir comprovante privado/);
});
test('selection filters results and rejects unknown partners',()=>{
 const report=createAccountantCsv('pre',{dataset:dataset(),role:'owner',partnerId:'partner-test-a',now:known});
 assert.equal(report.count,1);
 assert.doesNotMatch(report.csv,/c-b/);
 assert.throws(()=>createAccountantCsv('post',{dataset:dataset(),role:'owner',partnerId:'bogus',now:known}),/PARTNER_INVALID/);
});
test('CSV is Excel-safe: formulas, CRLF, quotes and tab injection sanitized',()=>{
 const report=createAccountantCsv('pre',{dataset:dataset(),role:'owner',now:known});
 assert.match(report.csv,/"'=HYPERLINK\(""https:\/\/bad""\)"/);
 assert.ok(report.csv.endsWith('\r\n'));
 const dangerous=dataset();dangerous.partners[0].public_name='   +CMD\r\nNext';
 const r=createAccountantCsv('pre',{dataset:dangerous,role:'owner',now:known});
 assert.match(r.csv,/"'\+CMD Next"/);
});
test('invalid monetary data remains blank, never coerced to zero',()=>{
 const dangerous=dataset();dangerous.commissions[0].earned_cents='not-a-number';
 const r=createAccountantCsv('pre',{dataset:dangerous,role:'owner',now:known});
 assert.match(r.csv,/"c-a";"pending";""/);
});
test('report controls only in TEST gated OWNER and no actual transfer or network call',async()=>{
 const html=await readFile(new URL('../site/admin/parceiros/financeiro/index.html',import.meta.url),'utf8');
 const ui=await readFile(new URL('../site/admin/parceiros/financeiro/finance.mjs',import.meta.url),'utf8');
 assert.match(html,/id="reportsPanel"/);assert.match(html,/id="reportPre"/);assert.match(html,/id="reportPost"/);
 assert.match(ui,/context\?\.access_level==='owner'/);
 assert.match(ui,/data\?\.can_manage/);
 assert.match(ui,/URL\.createObjectURL/);
 assert.doesNotMatch(ui,/api\.whatsapp|window\.open\('https:\/\/wa\.me/);
});

test('Postgres integer cents encoded as decimal string remain usable',()=>{
 const data=dataset();data.commissions[0].earned_cents='1000';
 const result=createAccountantCsv('pre',{dataset:data,role:'owner',now:known});
 assert.match(result.csv,/'1000'|"1000"/);
});
