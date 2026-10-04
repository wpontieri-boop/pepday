import { createAccountService } from './account.mjs';

export function validatePublicConfig(config, locationHref) {
  const environment=String(config.environment||'');
  const url = new URL(config.supabaseUrl);
  if (!['test','production'].includes(environment) ||
      url.origin !== `https://${config.projectRef}.supabase.co` ||
      !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.supabasePublishableKey)) {
    throw new Error('Configuração pública inválida.');
  }

  const location = new URL(locationHref);
  if (!['http:','https:'].includes(location.protocol)) {
    throw new Error('Abra o PepDay por um endereço web para usar a conta.');
  }

  if(environment==='test'&&config.blockedProductionUrl){
    const production = new URL(config.blockedProductionUrl);
    if (location.origin === production.origin &&
        (location.pathname === production.pathname.replace(/\/$/,'') || location.pathname.startsWith(production.pathname))) {
      throw new Error('A conexão de homologação não pode ser usada no endereço de produção.');
    }
  }

  if(environment==='production'){
    const runtime=new URL(config.runtimeUrl);
    const base=runtime.pathname.endsWith('/')?runtime.pathname:runtime.pathname+'/';
    const root=base.replace(/\/$/,'');
    const validPath=location.pathname===root||location.pathname.startsWith(base);
    if(location.origin!==runtime.origin||!validPath){
      throw new Error('A conexão de produção só pode ser usada no endereço oficial do PepDay.');
    }
  }
  return true;
}

export function initializeCloud(createClient, config, locationHref) {
  validatePublicConfig(config, locationHref);
  const client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      flowType: 'pkce', persistSession: true, autoRefreshToken: true,
      detectSessionInUrl: true, storageKey: `pepday-${config.environment}-${config.projectRef}-auth`
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
  if (['PGRST205','PGRST202','42P01','42883'].includes(code)) return 'A conta está aguardando a preparação do banco. Seus dados locais continuam disponíveis.';
  if (['otp_expired','otp_disabled'].includes(code)) return 'O código expirou ou não é válido. Solicite um novo código.';
  if (['over_email_send_rate_limit','over_request_rate_limit'].includes(code)) return 'Aguarde alguns minutos antes de solicitar outro código.';
  if (['email_provider_disabled','provider_disabled'].includes(code)) return 'Este método de login ainda não está habilitado.';
  if (code === 'P0001') {
    const importMessages={
      'Conflito no legado; nenhum saldo foi sobrescrito':'Há alterações conflitantes no legado. Revise antes de mesclar. Nenhum saldo da conta foi sobrescrito.',
      'Conflito na rotina; revisão necessária':'Há uma rotina conflitante. Revise antes de mesclar. Nenhum dado foi sobrescrito.',
      'Conclua o cadastro antes do teste':'Conclua o cadastro e os aceites antes de começar o teste PRO.',
      'Conclua o cadastro antes de importar':'Conclua o cadastro e os aceites antes de importar.',
      'Já há dados na conta. Escolha mesclar com segurança':'Foram encontrados dados na conta. Reabra o Perfil e escolha mesclar com segurança.'
    };
    if(importMessages[error.message]) return importMessages[error.message];
  }
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
  const profile = await client.from('profiles').select('id,name,email,country,timezone,is_adult_confirmed,terms_accepted_at,terms_version,privacy_accepted_at,privacy_version,sensitive_data_consent_at,sensitive_data_consent_version')
    .eq('id',user.id).single();
  if (profile.error) throw profile.error;
  const settings = await client.from('settings')
    .select('routine_reminders,refill_alerts,operational_notices,account_security_notices')
    .eq('user_id',user.id).maybeSingle();
  if (settings.error) throw settings.error;
  const subscription = await client.from('subscriptions')
    .select('status,plan,provider,provider_status,billing_status,current_period_end,cancel_at_period_end,cancelled_at')
    .eq('user_id',user.id).maybeSingle();
  if (subscription.error) throw subscription.error;
  const entitlement = await account.entitlement();
  return {
    status: 'signed_in', user, profile: profile.data, entitlement, subscription: subscription.data || null,
    settings: settings.data || {
      routine_reminders:false, refill_alerts:false,
      operational_notices:true, account_security_notices:true
    }
  };
}
