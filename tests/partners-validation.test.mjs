import test from 'node:test';
import assert from 'node:assert/strict';
import {validDocument,validPix,financialErrors,normalizePix} from '../site/admin/parceiros/validation.mjs';
const fixture={legal_name:'QA Sintético',document:'12345678909',payee_name:'QA Sintético',pix_type:'random',pix_key:'20000000-0000-4000-8000-000000000001',commission_percent:'12.50',reason:'configuracao_inicial'};
test('CPF and CNPJ require correct length and both check digits',()=>{
 for(const v of ['12345678909','123.456.789-09','11222333000181','11.222.333/0001-81'])assert.equal(validDocument(v),true,v);
 for(const v of ['',null,'12345678900','1234567890','123456789090','00000000000','11111111111111','11222333000180','!12345678909'])assert.equal(validDocument(v),false,String(v));
});
test('PIX types validate independently of partner document',()=>{
 assert.equal(validPix('cpf','123.456.789-09'),true);assert.equal(normalizePix('cpf','123.456.789-09'),'12345678909');
 for(const [type,value] of [['email','qa@example.invalid'],['phone','+5511999999999'],['random',fixture.pix_key],['cnpj','11222333000181']])assert.equal(validPix(type,value),true);
 for(const [type,value] of [['cpf','11222333000181'],['cnpj','12345678909'],['email','bad@'],['phone','11999999999'],['phone','+123'],['random','not-a-key'],['unknown',fixture.pix_key]])assert.equal(validPix(type,value),false);
 assert.deepEqual(financialErrors(fixture),{});
});
test('Every financial mandatory field produces its own error',()=>{
 for(const key of Object.keys(fixture))assert.ok(financialErrors({...fixture,[key]:''})[key],key);
 for(const value of ['-1','101','1.234','NaN','1e1'])assert.ok(financialErrors({...fixture,commission_percent:value}).commission_percent);
 assert.deepEqual(financialErrors({...fixture,commission_percent:'0'}),{});
});
