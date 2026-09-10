# Próxima ação no projeto pepday-v3-test

Projeto confirmado: `fsbqpyyprtymwrmzsacp`.
URL pública: `https://fsbqpyyprtymwrmzsacp.supabase.co`.
A chave publishable fornecida pelo proprietário já está em `config.js`.
Nenhuma chave elevada é necessária para configurar o frontend.

## 1. Banco — concluído

O proprietário confirmou em 2026-09-10 a instalação de
`supabase/migrations/202609090001_block_a.sql` e a execução completa de
`supabase/tests/block_a.sql`, sem erro e com rollback final. Não repetir.
O rollback limpa os fixtures da suite; não desfaz a instalação anterior.
Results mostrando set_config corresponde à configuração de identidade nos testes.

A verificação independente pela API confirmou bloqueio anônimo em profiles,
vials e get_entitlement: HTTP 401 com código PostgreSQL 42501.
Isso confirma os bloqueios observados, sem substituir o teste de sessão real.

## 2. Preparar o código por e-mail

O provedor de e-mail está habilitado. Ainda é necessário conferir no painel o
template **Authentication → Email Templates → Magic Link** (os nomes do menu
podem variar).

Para o fluxo por código, incluir `{{ .Token }}` no corpo do e-mail e configurar
OTP com seis dígitos. O aplicativo envia a solicitação e confirma com `verifyOtp`.
Não precisamos do código aqui no chat: ele será digitado no próprio aplicativo
quando fizermos o teste de login.

O remetente padrão do Supabase pode limitar destinatários/envios durante testes.
Conferir isso no painel. A configuração de e-mails de produção com Brevo pertence
ao Bloco C. Nenhum e-mail foi disparado nesta etapa de desenvolvimento.

## 3. Google e endereço de retorno

Google está desabilitado no projeto. Habilitar o provedor pelo painel para
testá-lo. Quando tivermos um endereço de homologação definido, adicioná-lo à
lista de redirects do Supabase e preencher `authRedirectUrl` e
`allowedRedirects` em `config.js` com o endereço exato.

Não usar o endereço de produção como retorno dos testes. O frontend de testes
tem um bloqueio adicional para o caminho de produção do PepDay.

## 4. Documentos e cadastro

O formulário de nome, país, fuso, maioridade e consentimentos está preparado.
Os aceites ficam desabilitados enquanto não houver URLs e versões de Termos e
Privacidade em `config.js`. Não marcar aceite de documentos inexistentes.
As versões devem identificar o texto efetivamente exibido ao usuário.

## Retomada

O próximo passo é autenticar uma conta de testes pelo formulário seguro e
validar sessão, Perfil e logout. Depois concluir conversão e mesclagem do legado.
A publicação continua bloqueada até conclusão, validação e autorização final.

Referências: [chaves públicas](https://supabase.com/docs/guides/getting-started/api-keys),
[login por código](https://supabase.com/docs/guides/auth/auth-email-passwordless),
[Google](https://supabase.com/docs/guides/auth/social-login/auth-google).
