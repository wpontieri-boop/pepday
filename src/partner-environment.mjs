const environments={
  test:{project:'fsbqpyyprtymwrmzsacp',host:'homologacao.pepday.com.br'},
  production:{project:'oslefjmwfnddxlotalxu',host:'pepday.com.br'}
};
export function isPartnerEnvironment(settings,where=globalThis.location){
  const target=environments[settings?.environment];
  return !!target&&settings.projectRef===target.project&&settings.supabaseUrl===`https://${target.project}.supabase.co`&&where?.hostname===target.host;
}
// Card route has the same client Auth storage as /app/, without broadening cloud's app-path guard.
export function createPartnerCardClient(createClient,settings,where=globalThis.location){
  if(!isPartnerEnvironment(settings,where)||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(settings.supabasePublishableKey))throw new Error('Ambiente de indicação inválido.');
  return createClient(settings.supabaseUrl,settings.supabasePublishableKey,{auth:{
    flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,
    storageKey:`pepday-${settings.environment}-${settings.projectRef}-auth`
  }});
}
