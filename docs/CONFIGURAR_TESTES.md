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

## 2.1. Novo SQL incremental — próxima ação

Aplicar **somente no pepday-v3-test**:

1. `supabase/migrations/202609100002_complete_legacy_import.sql`
2. `supabase/tests/complete_legacy_import.sql`

O primeiro adiciona conversão e mesclagem; o segundo valida somente o delta,
com fixtures aleatórios e rollback. A linha resultado deve indicar PASS.
Nenhum desses arquivos deve ser executado na produção. Não repetir a instalação
ou os testes iniciais já concluídos. Não é necessária chave elevada no frontend.

## 3. Google e endereço de retorno

Google está desabilitado no projeto. Habilitar o provedor pelo painel para
testá-lo. O endereço isolado existente é
`https://pepday-v3-bloco-a-test.wpontieri.chatgpt.site/`. Para Google, cadastrar
esse retorno no Supabase e configurar o callback indicado pelo próprio painel
no provedor Google. Depois atualizar authRedirectUrl/allowedRedirects no código.
Apenas o proprietário configura credenciais OAuth no painel; não enviá-las no chat.

Não usar o endereço de produção como retorno dos testes. O frontend de testes
tem um bloqueio adicional para o caminho de produção do PepDay.

## 4. Documentos e cadastro

O formulário de nome, país, fuso, maioridade e consentimentos está preparado.
Os aceites ficam desabilitados enquanto não houver URLs e versões de Termos e
Privacidade em `config.js`. Não marcar aceite de documentos inexistentes.
As versões devem identificar o texto efetivamente exibido ao usuário.

## Retomada

Informe somente o resultado dos dois arquivos incrementais. Login já aprovado.
A versão online de testes ainda é a anterior; o novo checkpoint está na branch
e não foi publicado automaticamente. Depois do delta, validar a migração no
Perfil com cadastro completo e dados descartáveis.
A publicação continua bloqueada até conclusão, validação e autorização final.

Referências: [chaves públicas](https://supabase.com/docs/guides/getting-started/api-keys),
[login por código](https://supabase.com/docs/guides/auth/auth-email-passwordless),
[Google](https://supabase.com/docs/guides/auth/social-login/auth-google).
