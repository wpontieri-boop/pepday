import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { config } from '../config.js';

const base='https://pepday-v3-bloco-a-test.wpontieri.chatgpt.site/';
const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');

test('documentos jurídicos têm URLs HTTPS e versões identificáveis',()=>{
  assert.equal(config.termsUrl,`${base}termos.html`);
  assert.equal(config.privacyUrl,`${base}privacidade.html`);
  assert.match(config.termsVersion,/^terms-\d{4}-\d{2}-\d{2}$/);
  assert.match(config.privacyVersion,/^privacy-\d{4}-\d{2}-\d{2}$/);
});

test('Termos preservam o escopo não médico e a responsabilidade legal',async()=>{
  const html=await read('termos.html');
  assert.match(html,/não prescreve, indica ou recomenda substâncias, doses, tratamentos ou protocolos/i);
  assert.match(html,/não substitui avaliação ou orientação de profissional habilitado/i);
  assert.match(html,/Nada nestes Termos exclui garantias, responsabilidades ou direitos/i);
  assert.match(html,/privacidade\.html/);
});

test('Política informa dados sensíveis, fornecedores, direitos e contato',async()=>{
  const html=await read('privacidade.html');
  for(const text of ['dados pessoais sensíveis','Supabase','Google','direitos do titular','wpontieri@gmail.com']) {
    assert.match(html,new RegExp(text,'i'));
  }
  assert.match(html,/não vende dados pessoais/i);
  assert.match(html,/termos\.html/);
});

test('cadastro e Perfil expõem os dois documentos',async()=>{
  const html=await read('index.html');
  assert.match(html,/id="accountTermsLink"/);
  assert.match(html,/id="accountPrivacyLink"/);
  assert.match(html,/href="termos\.html"/);
  assert.match(html,/href="privacidade\.html"/);
  assert.match(html,/autorizo o tratamento dos dados de rotina e frascos[^<]+dados sensíveis de saúde/i);
});
