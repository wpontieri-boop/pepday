import test from 'node:test';import assert from 'node:assert/strict';
import {createAccountantCsv} from '../site/admin/parceiros/financeiro/accountant-reports.mjs';
const data={can_manage:true,partners:[{id:'a',public_name:'QA A'}],commissions:[{id:'c',partner_id:'a',earned_cents:'100',state:'pending',source_date:'2026-11-01T01:00:00Z',source_reference:'qa-invoice',history_complete:true,gross_cents:'1000',refunded_cents:'10',fiscal_ready:false}],payouts:[{id:'p',partner_id:'a',state:'paid',total_cents:'100',paid_at:'2026-10-10T12:00:00Z',fiscal_state:'approved',withheld_cents:'10',net_cents:'90'}],adjustments:[{commission_id:'c',partner_id:'a',kind:'adjusted',amount_cents:'-10',created_at:'2026-10-10T12:00:00Z'}]};
const args={dataset:data,role:'owner',now:new Date('2026-10-12')};
test('report source-month uses Sao Paulo; does not infer fiscal competence',()=>{
 const r=createAccountantCsv('pre',{...args,month:'2026-10'});assert.equal(r.count,1);assert.match(r.csv,/CompetenciaFiscal/);assert.match(r.csv,/\"2026-10\"/);assert.equal(createAccountantCsv('pre',{...args,month:'2026-11'}).count,0);
 assert.throws(()=>createAccountantCsv('pre',{...args,month:'2026-13'}),/MONTH_INVALID/);
});
test('report canonical gross requires proven history and preserves missing as blank',()=>{
 assert.match(createAccountantCsv('pre',args).csv,/\"1000\";\"10\";\"COMPROVADO\"/);
 const pending={...data,commissions:[{...data.commissions[0],history_complete:false}]};
 assert.doesNotMatch(createAccountantCsv('pre',{...args,dataset:pending}).csv,/\"1000\"/);
});
test('post uses only actually approved fiscal amounts, never guesses zero/net',()=>{
 assert.match(createAccountantCsv('post',args).csv,/\"10\";\"90\"/);
 const pending={...data,payouts:[{...data.payouts[0],fiscal_state:'pending'}]};
 assert.doesNotMatch(createAccountantCsv('post',{...args,dataset:pending}).csv,/\"10\";\"90\"/);
});
test('adjustments export signed ledger history and rejects missing dataset',()=>{
 const r=createAccountantCsv('adjustments',args);assert.equal(r.count,1);assert.match(r.csv,/adjusted/);assert.match(r.csv,/-10/);
 assert.throws(()=>createAccountantCsv('adjustments',{...args,dataset:{...data,adjustments:undefined}}),/HISTORY_UNAVAILABLE/);
});
