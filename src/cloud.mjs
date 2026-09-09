import { createAccountService } from './account.mjs';

export function validatePublicConfig(config, locationHref) {
  const url = new URL(config.supabaseUrl);
  if (config.environment !== 'test' || url.origin !== `https://${config.projectRef}.supabase.co` ||
      !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.supabasePublishableKey)) {
    throw new Error('Configuração pública de testes inválida.');
  }
  const location = new URL(locationHref);
  const production = new URL(config.blockedProductionUrl);
  if (location.origin === production.origin &&
      (location.pathname === production.pathname.replace(/\/$/,'') || location.pathname.startsWith(production.pathname))) {
    throw new Error('A conexão de homologação não pode ser usada no endereço de produção.');
  }
  if (!['http:','https:'].includes(location.protocol)) {
    throw new Error('Abra o PepDay por um endereço web para usar a conta.');
  }
  return true;
}

export function initializeCloud(createClient, config, locationHref) {
  validatePublicConfig(config, locationHref);
  const client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      flowType: 'pkce', persistSession: true, autoRefreshToken: true,
      detectSessionInUrl: true, storageKey: `pepday-test-${config.projectRef}-auth`
    }
  });
  return { client, account: createAccountService(client, {
    redirectTo: config.authRedirectUrl, allowedRedirects: config.allowedRedirects,
    allowLocalhost: config.allowLocalhost
  }) };
}

export async function readPublicAuthSettings(config, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetchImpl(`${config.supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: config.supabasePublishableKey }, cache: 'no-store', signal: controller.signal
    });
    if (!response.ok) throw new Error('Não foi possível consultar os métodos de login.');
    const data = await response.json();
    return { email: data.external?.email === true, google: data.external?.google === true };
  } finally { clearTimeout(timeout); }
}

export function accountError(error) {
  const code = String(error?.code || '');
  if (['PGRST205','PGRST202','42P01','42883'].includes(code)) return 'A conta de testes está aguardando a preparação do banco. Seus dados locais continuam disponíveis.';
  if (['otp_expired','otp_disabled'].includes(code)) return 'O código expirou ou não é válido. Solicite um novo código.';
  if (['over_email_send_rate_limit','over_request_rate_limit'].includes(code)) return 'Aguarde alguns minutos antes de solicitar outro código.';
  if (['email_provider_disabled','provider_disabled'].includes(code)) return 'Este método de login ainda não está habilitado.';
  if (code === '42501') return 'A conta ainda não tem acesso a esta operação. Nenhum dado local foi apagado.';
  if (error?.name === 'AbortError' || /fetch|network|offline/i.test(String(error?.message || ''))) return 'Sem conexão com a conta. Você pode continuar usando a calculadora.';
  return 'Não foi possível concluir esta ação. Tente novamente. Seus dados locais foram preservados.';
}

export async function loadAccountState(client, account) {
  const identity = await client.auth.getUser();
  if (identity.error) {
    if (identity.error.name === 'AuthSessionMissingError') return { status: 'signed_out' };
    throw identity.error;
  }
  if (!identity.data?.user) return { status: 'signed_out' };
  const user = identity.data.user;
  const profile = await client.from('profiles').select('id,name,email,country,timezone,is_adult_confirmed,terms_accepted_at,privacy_accepted_at')
    .eq('id',user.id).single();
  if (profile.error) throw profile.error;
  const entitlement = await account.entitlement();
  return { status: 'signed_in', user, profile: profile.data, entitlement };
}
