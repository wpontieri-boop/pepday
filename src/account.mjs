// Adaptador do SDK oficial Supabase. A calculadora continua independente da conta.
// O chamador injeta createClient(url, publishableKey); nunca uma service_role key.
export function createAccountService(client, { redirectTo = null, allowedRedirects = [], allowLocalhost = false } = {}) {
  let url = null;
  if (redirectTo) {
    url = new URL(redirectTo);
    const local = allowLocalhost && url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname);
    if ((!local && url.protocol !== 'https:') || !allowedRedirects.includes(url.href) || url.username || url.password) {
      throw new Error('URL de retorno precisa ser HTTPS e estar autorizada.');
    }
  }
  async function unwrap(request) {
    const result = await request;
    if (result.error) throw result.error;
    return result.data;
  }
  function normalizeEmail(email) {
    const value = String(email).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('Confira o e-mail.');
    return value;
  }
  return Object.freeze({
    google() {
      if (!url) throw new Error('Login com Google aguarda a configuração do endereço de retorno.');
      return unwrap(client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: url.href } }));
    },
    email: email => unwrap(client.auth.signInWithOtp({
      email: normalizeEmail(email), options: { ...(url ? { emailRedirectTo: url.href } : {}), shouldCreateUser: true }
    })),
    verifyCode(email, token) {
      if (!/^\d{6}$/.test(String(token))) throw new Error('Informe o código de 6 dígitos.');
      return unwrap(client.auth.verifyOtp({ email: normalizeEmail(email), token: String(token), type: 'email' }));
    },
    // SDK mantém e renova a sessão; não confiar em role/pro de localStorage.
    session: () => unwrap(client.auth.getSession()),
    onChange: listener => client.auth.onAuthStateChange(listener),
    logout: () => unwrap(client.auth.signOut({ scope: 'local' })),
    completeProfile(profile) {
      if (profile.adult !== true || profile.termsAccepted !== true || profile.privacyAccepted !== true) {
        throw new Error('Confirme maioridade, Termos e Política de Privacidade.');
      }
      return unwrap(client.rpc('complete_onboarding', {
        p_name: profile.name, p_country: profile.country, p_timezone: profile.timezone,
        p_adult: true, p_terms_version: profile.termsVersion,
        p_privacy_version: profile.privacyVersion, p_marketing: profile.marketing === true
      }));
    },
    entitlement: () => unwrap(client.rpc('get_entitlement')),
    // Só ligar ao clique explícito em “Começar 7 dias grátis”.
    startTrial: () => unwrap(client.rpc('start_trial'))
  });
}
