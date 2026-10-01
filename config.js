// Configuração PÚBLICA, exclusiva do projeto de testes autorizado pelo proprietário.
// Este aplicativo é HTML/JS estático: não lê NEXT_PUBLIC_* do ambiente em runtime.
export const config = Object.freeze({
  environment: 'test',
  supabaseUrl: 'https://fsbqpyyprtymwrmzsacp.supabase.co',
  supabasePublishableKey: 'sb_publishable_trcejtixOEgEvwYth0K_GA_ajzZyLwr',
  projectRef: 'fsbqpyyprtymwrmzsacp',
  authRedirectUrl: 'https://homologacao.pepday.com.br/',
  allowedRedirects: ['https://homologacao.pepday.com.br/'],
  allowLocalhost: false,
  termsUrl: 'https://homologacao.pepday.com.br/termos.html',
  termsVersion: 'terms-2026-09-30-2',
  privacyUrl: 'https://homologacao.pepday.com.br/privacidade.html',
  privacyVersion: 'privacy-2026-09-30-2',
  sensitiveDataConsentVersion: 'health-data-2026-09-30',
  blockedProductionUrl: 'https://wpontieri-boop.github.io/pepday/'
});
