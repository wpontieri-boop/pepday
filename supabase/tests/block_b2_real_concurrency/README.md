# B2.1 — validação real de concorrência e Auth

Pacote exclusivo para `pepday-v3-test`. Não executar em produção. Ele não altera
migrations, RPCs ou frontend. Os dados persistem somente pelo intervalo necessário
para serem visíveis entre sessões e devem ser removidos pelos scripts `99_*`.

## Regras de segurança

- Conferir projeto e branch antes de começar.
- Executar cada arquivo inteiro, nunca trechos selecionados.
- Usar duas abas do SQL Editor, A e B. Cada arquivo A/B abre e encerra sua própria
  transação, portanto não depende de reutilização da conexão entre execuções.
- Não reutilizar UUIDs, contas ou e-mails deste pacote.
- Se surgir erro inesperado, executar `ROLLBACK;` na aba afetada, interromper os
  cenários e executar a limpeza correspondente.
- Não usar dados humanos, `service_role`, tokens em arquivos, `.env` no projeto ou
  qualquer projeto diferente de `pepday-v3-test`.

## Fixtures SQL reservadas

O preflight de `00_setup_sql.sql` cobre o usuário `f260…`, o marcador `a260…`,
três frascos `e261…` a `e263…`, quatro rotinas e versões, todos os `operation_id`
`b261…` a `b263…` e os UUIDs de evidência temporal `a161…` a `b163…`.
O usuário usa endereço `.invalid`; a inserção SQL não dispara fluxo externo de
e-mail. Todo `UPDATE` e todo `DELETE` são limitados ao usuário fixture explícito.
O setup cria em `local_data_imports` um marcador de procedência com pacote, versão,
usuário e hash fixos. O cleanup recusa qualquer exclusão sem correspondência exata.

## Ordem dos cenários SQL

1. Executar `00_setup_sql.sql` uma vez. Resultado esperado: `PASS — SETUP SQL`.
2. Cenário 1 — mesmo frasco:
   - iniciar `01_same_vial_session_a.sql` na Sessão A;
   - em até cinco segundos, iniciar `01_same_vial_session_b.sql` na Sessão B;
   - aguardar ambas terminarem.
3. Cenário 2 — `FOR UPDATE` explícito:
   - iniciar `02_for_update_session_a.sql` na Sessão A;
   - em até cinco segundos, iniciar `02_for_update_session_b.sql` na Sessão B;
   - aguardar ambas terminarem.
4. Cenário 3 — mesma rotina/data:
   - iniciar `03_same_routine_date_session_a.sql` na Sessão A;
   - em até cinco segundos, iniciar `03_same_routine_date_session_b.sql` na Sessão B;
   - aguardar ambas terminarem.
5. Executar `90_verify_sql.sql`. As três linhas devem retornar `PASS`.
6. Executar `99_cleanup_sql.sql`. A última tabela deve retornar total zero e
   `PASS — LIMPEZA CONFIRMADA`.

Os scripts A mantêm a transação aberta por 20 segundos. B deve levar pelo menos
oito segundos quando iniciada no intervalo indicado. Cada lado grava evidências
distintas em `audit_logs`: aquisição/liberação de A e início/fim de B. O verificador
exige quatro evidências, `B início` dentro da janela de A, `B fim` depois da
liberação e espera mínima de oito segundos. Rodar sequencialmente, omitir um lado
ou inverter o vencedor produz `FAIL`, mesmo que o saldo isolado pareça correto.

### Critérios objetivos

- **Mesmo frasco:** duas aplicações e dois movimentos, cadeia completa de
  aplicações e movimentos `10 → 9 → 8`, deltas `-1/-1`, saldo final `8`; A é a
  primeira operação e B usa `9` como `balance_before`.
- **`FOR UPDATE`:** B espera o lock explícito de A, depois cria uma aplicação e um
  movimento `10 → 9`, sem estado parcial.
- **Mesma rotina/data:** A confirma a operação `b263…001`; B inicia durante o lock
  e recebe o conflito esperado. A operação `b263…002` deve estar ausente de
  aplicações e movimentos; existe um único desconto `10 → 9`.

## Auth/RLS real e replay concorrente com Undo

Esses cenários usam `scripts/test-b2-real-transport.mjs`. O runner cria via Admin
Auth duas contas novas, auto-confirmadas, com senha aleatória mantida somente em
memória e um UUID aleatório comum em `user_metadata.pepday_b2_run_marker`:

- `pepday-b2-jwt-a@example.invalid`
- `pepday-b2-jwt-b@example.invalid`

Definir somente na sessão do terminal, nunca em `.env` dentro do projeto:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Executar uma única vez:

`node scripts/test-b2-real-transport.mjs`

O runner recusa qualquer URL diferente de
`https://fsbqpyyprtymwrmzsacp.supabase.co` — inclusive a mesma URL com barra final —,
faz preflight de e-mails e UUIDs,
cria as contas sem convite/e-mail externo, autentica ambas pelo fluxo normal com a
anon key, executa internamente `prepare`, `auth-rls` e `replay-undo`, e tenta o
cleanup mesmo quando uma etapa falha. Nenhuma credencial, senha, sessão, UUID de
usuário ou token é exibido. A única saída normal é `PASS FINAL — AUTH/RLS +
REPLAY/UNDO` ou `FAIL FINAL — <motivo sanitizado>`.

O marcador de domínio é criado antes das demais fixtures. A remoção de domínio só
prossegue quando ele contém exatamente o run marker e os dois usuários da execução;
a remoção Auth exige ainda e-mail e metadata idênticos. Se a falha ocorrer antes do
marcador de domínio, somente as contas recém-criadas cuja metadata coincida podem
ser removidas. Ao final, o runner confirma zero linhas nas 12 tabelas públicas,
ausência das duas contas na API Admin e rejeição dos access/refresh tokens antigos.

### Critérios objetivos JWT

- **Auth/RLS:** A lê seu próprio frasco/aplicação; B recebe lista vazia ao ler IDs
  de A; RPCs de B com recursos de A são recusadas; saldo e contagens de A não mudam
  nas tentativas cruzadas.
- **Replay + Undo:** as duas requisições aguardam a mesma barreira no cliente. O
  runner exige `dispatch skew ≤ 25 ms`, `replay=true` no reenvio e `replay=false`
  no primeiro Undo. A barreira usa espera completa de todas as operações: uma
  falha rápida não libera cleanup enquanto a outra request ainda estiver em curso. Ao final
  existe uma aplicação original, exatamente um movimento negativo e um inverso,
  a aplicação está desfeita e o saldo voltou de `9` para `10` exatamente uma vez.
  Um segundo Undo com outro UUID precisa retornar o conflito previsto sem alterar
  cardinalidade ou saldo. O replay pode refletir o estado imediatamente anterior
  ou posterior ao primeiro Undo.

## Riscos residuais

- As fixtures JWT são confirmadas temporariamente para o transporte real. Uma queda
  abrupta do processo pode exigir a recuperação manual já existente em
  `99_cleanup_jwt.template.sql`, usando o run marker conhecido da execução.
- Latência do SQL Editor pode reduzir a janela de sobreposição; repetir somente
  depois de limpar e recriar todas as fixtures.
- Perda de conexão pode ocultar o resultado, mas não amplia os filtros de escrita.
- Tokens e senhas existem apenas na memória do processo; as três chaves de ambiente
  devem ser removidas da sessão do terminal após o teste.
- O runner comprova transporte HTTP/JWT, não a segurança do computador usado para
  armazenar temporariamente as variáveis de ambiente.

O runner tenta contar diretamente `auth.identities`, `auth.sessions` e
`auth.refresh_tokens` quando o schema `auth` está exposto ao PostgREST; se não
estiver, o Admin Auth não oferece essa contagem SQL com as três variáveis permitidas.
Nesse caso, ele comprova o hard-delete em `auth.users` e que access/refresh tokens
antigos deixaram de funcionar; a remoção interna decorre do hard-delete transacional
suportado pelo Auth. A confirmação literal de contagem zero continua disponível no
cleanup SQL manual, caso seja exigida após uma interrupção. Se uma conexão cair, o PostgreSQL
reverte a transação daquela conexão e libera seus locks; executar `ROLLBACK;` na
aba se ela ainda estiver aberta, aguardar as demais sessões terminarem, e somente
então executar o cleanup. Nunca remover manualmente o marcador para contornar uma
recusa de procedência.

O refresh token emitido pelo login normal não é consumido antes do hard-delete no
teste real, porque uma troca bem-sucedida pode rotacioná-lo e alterar a intenção do
teste. Sua emissão pela autenticação confirma o estado anterior; depois da exclusão,
o runner tenta usá-lo uma única vez e exige recusa. O mock local modela explicitamente
o mesmo token como válido antes e inválido depois da remoção.

## Validação local do pacote

Com `PGLITE_MODULE` apontando para PGlite 0.5.8 local, executar:

`node scripts/test-b2-concurrency-package-local.mjs`

O harness nunca abre rede. Ele prova que o verificador rejeita execução sequencial,
somente A, somente B e vencedor B indevido; valida também o caminho positivo com
timeline controlada, a recusa de cleanup sem marcador, cleanup com zero fixtures e
o bloqueio do segundo Undo. PGlite não substitui a concorrência real: no caminho
positivo ele modela timestamps sobrepostos para testar o contrato do verificador.
