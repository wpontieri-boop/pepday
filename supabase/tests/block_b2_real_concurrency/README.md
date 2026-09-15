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

O preflight de `00_setup_sql.sql` cobre o usuário `f260…`, três frascos `e261…` a
`e263…`, quatro rotinas e versões, e todos os `operation_id` `b261…` a `b263…`.
O usuário usa endereço `.invalid`; a inserção SQL não dispara fluxo externo de
e-mail. Todo `UPDATE` e todo `DELETE` são limitados ao usuário fixture explícito.

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

Os scripts A mantêm a transação aberta por 20 segundos. B deve levar tempo
compatível com a espera (normalmente pelo menos dez segundos quando iniciado no
intervalo indicado). A duração isolada não decide o resultado: saldos, movimentos
e cardinalidades da verificação são a autoridade.

### Critérios objetivos

- **Mesmo frasco:** duas aplicações e dois movimentos, cadeia `10 → 9 → 8`, saldo
  final `8`; B usa `9` como `balance_before`.
- **`FOR UPDATE`:** B espera o lock explícito de A, depois cria uma aplicação e um
  movimento `10 → 9`, sem estado parcial.
- **Mesma rotina/data:** A confirma uma aplicação; B recebe o conflito esperado;
  há uma aplicação ativa, um movimento e um único desconto `10 → 9`.

## Auth/RLS real e replay concorrente com Undo

Esses cenários usam `scripts/test-b2-real-transport.mjs` e duas contas Auth novas,
criadas manualmente no painel de **Auth do projeto de testes**, com auto-confirmação
e estes e-mails reservados:

- `pepday-b2-jwt-a@example.invalid`
- `pepday-b2-jwt-b@example.invalid`

Usar criação direta com auto-confirmação; não usar o fluxo **Invite user**, para
não solicitar envio de e-mail.

Senhas temporárias e tokens não devem ser salvos. Obter um access token legítimo
para cada conta e definir somente na sessão do terminal:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `PEPDAY_B2_JWT_A`
- `PEPDAY_B2_JWT_B`

Ordem:

1. `node scripts/test-b2-real-transport.mjs prepare`
2. Copiar os dois UUIDs exibidos (nenhum token é impresso).
3. Fazer uma cópia fora do repositório de `04_05_jwt_setup.template.sql`, substituir
   `REPLACE_WITH_USER_A_UUID` e `REPLACE_WITH_USER_B_UUID`, e executar a cópia no
   SQL Editor. Esperado: `PASS — SETUP JWT`.
4. `node scripts/test-b2-real-transport.mjs auth-rls`
5. `node scripts/test-b2-real-transport.mjs replay-undo`
6. Fazer uma cópia fora do repositório de `99_cleanup_jwt.template.sql`, substituir
   os mesmos UUIDs e executá-la. Esperado: total zero e
   `PASS — LIMPEZA JWT CONFIRMADA`.
7. Remover as quatro variáveis do terminal e apagar as cópias temporárias.

O comando `prepare` conclui cadastro e inicia trial somente nas duas contas de
teste. O setup JWT recusa placeholders, IDs iguais, e-mails inesperados, falta de
entitlement e colisões em qualquer UUID de domínio/operação reservado.

### Critérios objetivos JWT

- **Auth/RLS:** A lê seu próprio frasco/aplicação; B recebe lista vazia ao ler IDs
  de A; RPCs de B com recursos de A são recusadas; saldo e contagens de A não mudam
  nas tentativas cruzadas.
- **Replay + Undo:** duas requisições HTTP são disparadas com `Promise.all`; ao final
  existe uma aplicação original, exatamente um movimento negativo e um inverso,
  a aplicação está desfeita e o saldo voltou de `9` para `10` exatamente uma vez.
  O replay pode refletir o estado imediatamente anterior ou posterior ao Undo.

## Riscos residuais

- As fixtures precisam ser confirmadas temporariamente para ficarem visíveis entre
  conexões. Uma interrupção exige executar o cleanup antes de repetir.
- Latência do SQL Editor pode reduzir a janela de sobreposição; repetir somente
  depois de limpar e recriar todas as fixtures.
- Perda de conexão pode ocultar o resultado, mas não amplia os filtros de escrita.
- Tokens dão acesso às contas fixtures enquanto válidos; devem permanecer apenas
  na memória/ambiente da sessão e ser removidos após o teste.
- O runner comprova transporte HTTP/JWT, não a segurança do computador usado para
  armazenar temporariamente as variáveis de ambiente.
