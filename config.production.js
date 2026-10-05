// Configuração PÚBLICA do ambiente de produção PepDay.
// Somente dados adequados ao navegador; nenhum segredo deve entrar neste arquivo.
export const config = Object.freeze({
  environment: 'production',
  supabaseUrl: 'https://oslefjmwfnddxlotalxu.supabase.co',
  supabasePublishableKey: 'sb_publishable_UFES0rzsfL1DVvmSQQ7Rzw_VpM4Ayfc',
  projectRef: 'oslefjmwfnddxlotalxu',
  authRedirectUrl: 'https://pepday.com.br/app/',
  allowedRedirects: ['https://pepday.com.br/app/'],
  allowLocalhost: false,
  termsUrl: 'https://pepday.com.br/termos.html',
  termsVersion: 'terms-2026-09-30-2',
  privacyUrl: 'https://pepday.com.br/privacidade.html',
  privacyVersion: 'privacy-2026-09-30-2',
  sensitiveDataConsentVersion: 'health-data-2026-09-30',
  runtimeUrl: 'https://pepday.com.br/app/',
  ads: Object.freeze({
    enabled: false,
    provider: 'adsense',
    nonPersonalized: true,
    placement: 'calculator-result',
    publisherId: '',
    slotId: ''
  })
});
