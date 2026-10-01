import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { config } from '../config.js';

const authBase='https://pepday-v3-bloco-a-test.wpontieri.chatgpt.site/';
const legalBase='https://pepday-v3-homologacao.onrender.com/';
const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');

test('documentos jurídicos usam homologação atual e versões vigentes',()=>{
  assert.equal(config.authRedirectUrl,authBase);
  assert.deepEqual(config.allowedRedirects,[authBase]);
  assert.equal(config.termsUrl,`${legalBase}termos.html`);
  assert.equal(config.privacyUrl,`${legalBase}privacidade.html`);
  assert.equal(config.termsVersion,'terms-2026-09-30');
  assert.equal(config.privacyVersion,'privacy-2026-09-30');
  assert.equal(config.sensitiveDataConsentVersion,'health-data-2026-09-30');
});

test('Termos preservam escopo não médico, responsabilidade e direitos de dados',async()=>{
  const html=await read('termos.html');
  assert.match(html,/VERSÃO TERMS-2026-09-30/i);
  assert.match(html,/não prescreve, indica ou recomenda substâncias, doses, tratamentos ou protocolos/i);
  assert.match(html,/não substitui avaliação ou orientação de profissional habilitado/i);
  assert.match(html,/Nada nestes Termos exclui garantias, responsabilidades ou direitos/i);
  assert.match(html,/exportação em JSON/i);
  assert.match(html,/exclusão da conta/i);
  assert.match(html,/Apagar meus dados locais[^<]+diferente da exclusão da conta/i);
  assert.match(html,/renovação automática/i);
  assert.match(html,/cancelar futuras renovações pelo Perfil/i);
  assert.match(html,/direito de arrependimento/i);
  assert.match(html,/identificação jurídica completa do fornecedor\/controlador/i);
  assert.match(html,/privacidade\.html/);
});

test('Termos deixam marketing opcional e push de bloqueio sem conteúdo sensível',async()=>{
  const html=await read('termos.html');
  assert.match(html,/Marketing, novidades e ofertas dependem de escolha opcional/i);
  assert.match(html,/sem expor substância, dose, histórico ou outras informações sensíveis/i);
});

test('Política informa dados sensíveis, fornecedores, direitos, exportação e contato',async()=>{
  const html=await read('privacidade.html');
  for(const text of [
    'dados pessoais sensíveis','Supabase','Google','Mercado Pago','Brevo',
    'Firebase Cloud Messaging','direitos do titular','exportação em JSON',
    'exclusão da conta','wpontieri@gmail.com'
  ]) assert.match(html,new RegExp(text,'i'));
  assert.match(html,/não vende dados pessoais/i);
  assert.match(html,/consentimento específico e destacado/i);
  assert.match(html,/não são tratados com base genérica em interesse legítimo ou simples execução contratual/i);
  assert.match(html,/Transferências internacionais/i);
  assert.match(html,/identificação jurídica completa do controlador/i);
  assert.match(html,/termos\.html/);
});

test('Política separa marketing de comunicações essenciais e protege tela bloqueada',async()=>{
  const html=await read('privacidade.html');
  assert.match(html,/Novidades e ofertas são <strong>opcionais<\/strong>/i);
  assert.match(html,/não incluirá substância, dose, histórico ou conteúdo sensível/i);
  assert.match(html,/não impede a criação, manutenção ou uso da conta/i);
});

test('cadastro e Perfil expõem documentos, consentimento e gestão de dados',async()=>{
  const html=await read('index.html');
  assert.match(html,/id="accountTermsLink"/);
  assert.match(html,/id="accountPrivacyLink"/);
  assert.match(html,/href="termos\.html"/);
  assert.match(html,/href="privacidade\.html"/);
  assert.match(html,/id="accountSensitiveData"/);
  assert.match(html,/Consentimento específico:/i);
  assert.match(html,/dados pessoais sensíveis relacionados à saúde/i);
  assert.match(html,/id="accountExportData"/);
  assert.match(html,/id="accountDeleteOpen"/);
  assert.match(html,/id="eraseData"/);
});

test('cadastro só fica juridicamente atual quando versões aceitas coincidem com config',async()=>{
  const [ui,cloud]=await Promise.all([read('src/account-ui.mjs'),read('src/cloud.mjs')]);
  assert.match(cloud,/terms_accepted_at,terms_version,privacy_accepted_at,privacy_version,sensitive_data_consent_at,sensitive_data_consent_version/);
  assert.match(ui,/profile\?\.terms_version===config\.termsVersion/);
  assert.match(ui,/profile\?\.privacy_version===config\.privacyVersion/);
  assert.match(ui,/profile\?\.sensitive_data_consent_version===config\.sensitiveDataConsentVersion/);
  assert.match(ui,/Revise os documentos atualizados/);
  assert.match(ui,/Seus dados foram preservados/);
});

test('documentos registram atualização jurídica de homologação em 30 de setembro de 2026',async()=>{
  const [terms,privacy]=await Promise.all([read('termos.html'),read('privacidade.html')]);
  assert.match(terms,/atualizada em 30 de setembro de 2026/i);
  assert.match(privacy,/atualizada em 30 de setembro de 2026/i);
});

test('procedimento interno de incidente cobre prazo, registro e retenção',async()=>{
  const doc=await read('docs/INCIDENT-RESPONSE-LGPD.md');
  assert.match(doc,/3 dias úteis/i);
  assert.match(doc,/no mínimo 5 anos/i);
  assert.match(doc,/risco ou dano relevante/i);
});
