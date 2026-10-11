// Pure UI error classification. Do not surface raw server messages, session IDs, JWTs or PII.
export function fiscalAccessMessage(error){
 const code=String(error?.code||'');
 const detail=String(error?.message||'');
 const name=String(error?.name||'');
 const httpStatus=Number(error?.status||0);
 const phase=String(error?.accessStage||'');

 // Postgres returns code=42501 even when the useful reason is in message.
 // Do not classify every 42501 as a missing Admin role.
 if(detail==='PARTNER_LOGIN_EXPIRED'){
  return 'A sessão operacional do P3 expirou (validade máxima de 8 horas desde o login). No Admin TEST, use “Sair” e faça um novo login com senha e código 2FA. Depois retorne a esta tela.';
 }
 if(detail==='PARTNER_SESSION_REVOKED'){
  return 'A sessão do P3 foi encerrada ou revogada. Abra o Admin TEST e faça novo login com senha e 2FA antes de voltar.';
 }
 if(['AUTH_REQUIRED','PGRST301'].includes(detail)||['AUTH_REQUIRED','PGRST301'].includes(code)||name==='AuthSessionMissingError'||httpStatus===401||detail==='Autenticação necessária'){
  return 'Você não está conectado ao Admin de homologação. Entre com senha e 2FA e depois volte para esta página.';
 }
 if(detail==='MFA_REQUIRED'||detail==='PARTNER_RECENT_PASSWORD_TOTP_REQUIRED'||detail==='Autenticação em dois fatores necessária'){
  return 'O acesso fiscal exige uma sessão administrativa com 2FA. Entre no Admin de homologação e conclua o código do autenticador.';
 }
 if(detail==='Acesso administrativo necessário'||detail==='Acesso de proprietário necessário'){
  return 'Esta conta não possui a permissão administrativa exigida no ambiente TEST. Confira o papel da conta no Admin; nenhuma operação fiscal foi executada.';
 }
 if(detail==='PARTNER_FINANCE_DISABLED'||detail==='PARTNERS_DISABLED'){
  return 'O módulo de parceiros ou financeiro está desativado em TEST. Nenhuma operação foi executada.';
 }
 if(detail==='PARTNERS_TEST_ONLY'){
  return 'O módulo fiscal só pode operar no projeto de homologação TEST. Nenhuma operação foi executada.';
 }
 if(httpStatus===403||code==='42501'){
  const stage=({session:'sessão',admin:'permissão administrativa',finance:'acesso ao financeiro P3'})[phase]||'acesso fiscal';
  return `O servidor bloqueou a etapa de ${stage} nesta sessão. Não é possível concluir se houve expiração do login ou falta de permissão. Confira no Admin TEST; nenhum repasse foi realizado.`;
 }
 const stage=({session:'sessão',admin:'permissão administrativa',finance:'consulta financeira'})[phase]||'acesso';
 return `Não foi possível concluir a verificação de ${stage}. Abra o Admin de homologação e tente novamente. Nenhuma operação financeira foi executada.`;
}
