# Validação real controlada — B2.2-C

Este documento acompanha `scripts/test-b22c-real-sync.mjs`. A execução no
`pepday-v3-test` permanece pendente de autorização explícita.

## Limites e segurança

- O runner recusa qualquer URL diferente de
  `https://fsbqpyyprtymwrmzsacp.supabase.co`, inclusive a mesma URL com barra
  final.
- As únicas entradas de configuração são `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e
  `SUPABASE_SERVICE_ROLE_KEY`, recebidas pelo ambiente do processo. Não há
  `.env`, argumentos de linha de comando ou arquivos de credenciais.
- A senha é aleatória e existe somente em memória. Chaves, senha, access token
  e refresh token não são impressos nem incluídos no recibo de recuperação.
- Application e Undo usam o JWT obtido pelo login normal com a anon key. A
  service role é usada somente no preflight, na criação/leitura das fixtures,
  na verificação e no hard-delete administrativo da conta fixture.
- O marker é um UUID aleatório por execução. Preflight, conta Auth,
  `local_data_imports.source_snapshot` e recibo local vinculam a mesma execução.
- O cleanup recusa o hard-delete se o marker Auth divergir. Depois da criação
  do marker de domínio, ele também recusa se a linha de procedência divergir.
- O hard-delete da conta fixture aciona os `ON DELETE CASCADE` já existentes.
  A verificação final exige zero linhas nas 12 tabelas de domínio consultadas,
  ausência da conta no Admin Auth e rejeição dos access/refresh tokens antigos.

## Cenário automatizado

1. Preflight de e-mail, marker, IDs de Frasco/Rotina/versão e operation IDs.
2. Criação de uma conta `example.invalid` com marker em `user_metadata`.
3. Login normal, onboarding e início explícito de trial para a conta descartável.
4. Criação administrativa de dois conjuntos isolados de Frasco, Rotina e
   `routine_version`: principal e reparo pós-falha local.
5. Preparação de IndexedDB efêmero pelo repository real, com referências remotas.
6. Application com resposta perdida e replay do mesmo operation ID.
7. Undo com resposta perdida e replay do mesmo operation ID.
8. Segundo Undo com UUID diferente, que deve terminar em `conflict`.
9. Application remota confirmada seguida de falha local simulada; após expirar
   o lease, replay repara IndexedDB sem segundo movimento/desconto.
10. Verificação remota e local de cardinalidade, saldo e estados da outbox.
11. Cleanup em `finally` e verificação de zero vestígios.

## Execução futura autorizada

Em uma sessão temporária do PowerShell, sem criar arquivo `.env`:

```powershell
$env:SUPABASE_URL = 'https://fsbqpyyprtymwrmzsacp.supabase.co'
$env:SUPABASE_PUBLISHABLE_KEY = '<chave sb_publishable_... do projeto de teste>'
$env:SUPABASE_SERVICE_ROLE_KEY = '<service role do projeto de teste>'
node scripts/test-b22c-real-sync.mjs
Remove-Item Env:SUPABASE_URL, Env:SUPABASE_PUBLISHABLE_KEY, Env:SUPABASE_SERVICE_ROLE_KEY
```

O processo imprime exatamente uma linha final:

- `PASS FINAL — B2.2-C REAL SYNC/REPLAY/UNDO`; ou
- `FAIL FINAL — <motivo sanitizado>`.

## Recuperação após interrupção abrupta

Imediatamente antes de solicitar a criação da conta, o runner grava um recibo
**sem segredo** em
`%TEMP%\pepday-b22c-real-<run_marker>.json`. Ele contém somente o marker, o ID e
e-mail planejados e o ID da linha de procedência. Após receber a resposta Auth,
o runner acrescenta o ID do usuário. Assim, até uma resposta perdida na criação
pode ser recuperada pelo e-mail exato + marker. Em término normal com cleanup
confirmado, esse arquivo é removido.

Se o processo for encerrado antes do `finally`:

1. não execute exclusão por prefixo de e-mail;
2. abra o recibo exato e anote `runMarker`, `userId`, `email` e `markerId`;
3. no Auth Admin do **pepday-v3-test**, confirme simultaneamente ID, e-mail e
   `user_metadata.pepday_b22c_run_marker` iguais ao recibo;
4. se `local_data_imports` já existir, confirme que `id = markerId`, `user_id =
   userId`, `source_snapshot.fixture = pepday-b22c-real-sync` e
   `source_snapshot.run_marker = runMarker`;
5. se qualquer guarda divergir, pare sem excluir nada;
6. somente após todas as guardas aplicáveis coincidirem, faça hard-delete dessa
   conta fixture exata pelo Auth Admin;
7. confirme zero linhas do `userId` em `profiles`, `subscriptions`, `trials`,
   `settings`, `vials`, `routines`, `routine_versions`, `applications`,
   `vial_movements`, `local_data_imports`, `legacy_import_records` e
   `audit_logs`, além da ausência no Auth Admin;
8. remova o recibo local somente após a verificação zerada.

As tabelas internas `auth.identities`, `auth.sessions` e `auth.refresh_tokens`
não são expostas pelo REST do projeto. A confirmação externa segura usa o
hard-delete Admin, ausência em `auth.users` e rejeição dos dois tokens antigos;
uma inspeção SQL opcional dessas tabelas pode complementar o registro humano.
