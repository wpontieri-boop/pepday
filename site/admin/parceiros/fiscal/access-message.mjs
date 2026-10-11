// Safe, human-readable access status. Do not expose raw backend errors, credentials or identifiers.
export function fiscalAccessMessage(error){
 const code=String(error?.code||error?.message||'');
 const name=String(error?.name||'');
 const status=Number(error?.status||0);
 if(['AUTH_REQUIRED','PARTNER_LOGIN_EXPIRED','PARTNER_SESSION_REVOKED','PGRST301'].includes(code)||name==='AuthSessionMissingError'||status===401){
  return 'Você não está conectado ao Admin de homologação ou sua sessão expirou. Entre com senha e 2FA e depois volte para esta página.';
 }
 if(code==='MFA_REQUIRED'||code==='PARTNER_RECENT_PASSWORD_TOTP_REQUIRED'){
  return 'O acesso fiscal exige uma sessão administrativa com 2FA. Entre no Admin de homologação e conclua o código do autenticador.';
 }
 if(code==='PARTNER_FINANCE_DISABLED'){
  return 'Módulo financeiro indisponível em TEST. Nenhuma operação foi executada.';
 }
 if(status===403||code==='42501'){
  return 'Acesso fiscal não autorizado nesta sessão. Confira sua permissão no Admin de homologação.';
 }
 return 'Não foi possível verificar o acesso ao complemento fiscal. Abra o Admin de homologação e tente novamente. Se já estiver conectado, use “Verificar acesso”.';
}
