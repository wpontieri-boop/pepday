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

## 2. Login por e-mail — validado

O proprietário confirmou login, OTP de seis dígitos, sessão após recarregar e
logout no ambiente isolado. Não repetir nem reconfigurar esse fluxo.

## 2.1. SQL incremental — validado

O proprietário confirmou aplicação de
`supabase/migrations/202609100002_complete_legacy_import.sql` e aprovação de
`supabase/tests/complete_legacy_import.sql`, com resultado exato:

`PASS — conversão, saldo, legado, repetição, mesclagem, rollback e isolamento`

Não repetir esses arquivos nem os SQL anteriores.

## 3. Auth e endereço de retorno

O endereço oficial de homologação é
`https://homologacao.pepday.com.br/`. Manter esse endereço como `Site URL` e na
lista de redirects autorizados do Supabase Auth. O frontend usa o mesmo hostname em
`authRedirectUrl`/`allowedRedirects`. Se o provedor Google estiver habilitado, preservar
as credenciais existentes e manter o callback do próprio projeto Supabase no provedor;
não expor Client Secret no chat ou no repositório.

Não usar o endereço de produção como retorno dos testes. O frontend de testes
tem um bloqueio adicional para o caminho de produção do PepDay.

## 4. Documentos e cadastro

O formulário de nome, país, fuso, maioridade e consentimentos está preparado.
Os aceites ficam desabilitados enquanto não houver URLs e versões de Termos e
Privacidade em `config.js`. Não marcar aceite de documentos inexistentes.
As versões devem identificar o texto efetivamente exibido ao usuário.

## Retomada

Próxima ação: configurar Google no painel e confirmar a conclusão sem enviar
credenciais. Banco e login por e-mail já aprovados.
A versão online de testes ainda é a anterior; o novo checkpoint está na branch
e não foi publicado automaticamente. Depois do delta, validar a migração no
Perfil com cadastro completo e dados descartáveis.
A publicação continua bloqueada até conclusão, validação e autorização final.

Referências: [chaves públicas](https://supabase.com/docs/guides/getting-started/api-keys),
[login por código](https://supabase.com/docs/guides/auth/auth-email-passwordless),
[Google](https://supabase.com/docs/guides/auth/social-login/auth-google).
