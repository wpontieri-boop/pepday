// Configuração PÚBLICA, exclusiva do projeto de testes autorizado pelo proprietário.
// Este aplicativo é HTML/JS estático: não lê NEXT_PUBLIC_* do ambiente em runtime.
export const config = Object.freeze({
  environment: 'test',
  supabaseUrl: 'https://fsbqpyyprtymwrmzsacp.supabase.co',
  supabasePublishableKey: 'sb_publishable_trcejtixOEgEvwYth0K_GA_ajzZyLwr',
  projectRef: 'fsbqpyyprtymwrmzsacp',
  authRedirectUrl: null,
  allowedRedirects: [],
  // Definir depois de registrar um endereço de homologação no Supabase.
  allowLocalhost: false,
  // Não colher aceite para documentos que ainda não foram disponibilizados.
  termsUrl: null,
  termsVersion: null,
  privacyUrl: null,
  privacyVersion: null,
  blockedProductionUrl: 'https://wpontieri-boop.github.io/pepday/'
});
