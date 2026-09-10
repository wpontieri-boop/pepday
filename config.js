// Configuração PÚBLICA, exclusiva do projeto de testes autorizado pelo proprietário.
// Este aplicativo é HTML/JS estático: não lê NEXT_PUBLIC_* do ambiente em runtime.
export const config = Object.freeze({
  environment: 'test',
  supabaseUrl: 'https://fsbqpyyprtymwrmzsacp.supabase.co',
  supabasePublishableKey: 'sb_publishable_trcejtixOEgEvwYth0K_GA_ajzZyLwr',
  projectRef: 'fsbqpyyprtymwrmzsacp',
  authRedirectUrl: 'https://pepday-v3-bloco-a-test.wpontieri.chatgpt.site/',
  allowedRedirects: ['https://pepday-v3-bloco-a-test.wpontieri.chatgpt.site/'],
  allowLocalhost: false,
  termsUrl: 'https://pepday-v3-bloco-a-test.wpontieri.chatgpt.site/termos.html',
  termsVersion: 'terms-2026-09-10',
  privacyUrl: 'https://pepday-v3-bloco-a-test.wpontieri.chatgpt.site/privacidade.html',
  privacyVersion: 'privacy-2026-09-10',
  blockedProductionUrl: 'https://wpontieri-boop.github.io/pepday/'
});
