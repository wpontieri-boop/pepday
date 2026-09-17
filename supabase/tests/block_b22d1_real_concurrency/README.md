# B2.2-D1 — validação PostgreSQL real

Este pacote comprova concorrência real das RPCs versionadas de Frascos. Ele é exclusivo do `pepday-v3-test`; não execute em produção. A migration `202609160006_block_b22d1_versioned_vials.sql` deve ser aplicada uma única vez antes dos cenários.

## Runner automatizado (preferencial)

Defina somente `SUPABASE_DB_URL` na sessão atual, usando a conexão PostgreSQL direta ou pooler do projeto `fsbqpyyprtymwrmzsacp`, e execute `node scripts/test-b22d1-real-concurrency.mjs`. O runner abre duas conexões independentes, dispara A/B em paralelo, executa o verificador, faz cleanup guardado e imprime uma única linha final. A URL/senha nunca é impressa nem persistida. O runner também inspeciona primeiro o run conhecido `72ed54ae-4295-454e-8597-a21d1c505691`; ele só limpa eventual resíduo quando marker, conta Auth e todos os IDs provam a procedência.

Resultado esperado: `PASS FINAL — B2.2-D1 REAL CONCURRENCY`.

## Fechamento aprovado — 17/09/2026

A validação real automatizada foi concluída no `pepday-v3-test` com:

- `PASS FINAL — B2.2-D1 REAL CONCURRENCY`;
- create concorrente com `operationId` diferentes e o mesmo `vial_id`: `PASS`;
- espera e serialização real pelo lock em `profiles`: `PASS`;
- update concorrente com soft-delete: `PASS`;
- cleanup final confirmado sem resíduos do run;
- `SUPABASE_DB_URL` removida do ambiente após a execução.

Antes do resultado final, o pacote recebeu três correções permanentes e suas
regressões: `auth.refresh_tokens.user_id` passou a ser comparado como texto no
cleanup; todos os caminhos do runner passaram a terminar explicitamente, sem
`unsettled top-level await`; e a comparação JSONB do replay recebeu casts
explícitos de `text`, eliminando o erro PostgreSQL `unknown - unknown`.

A validação local final registrou suíte Node `164/164 PASS`, D1 PGlite `PASS`,
regressão B2.1 `PASS`, `node --check` `PASS` e `git diff --check` `PASS`.
O B2.2-D1 está encerrado e aprovado; não repetir esta validação real sem mudança
posterior no backend versionado de Frascos ou no próprio pacote de concorrência.

## Gerar um run isolado

No repositório, execute `node scripts/prepare-b22d1-real-validation.mjs`. O comando cria em `%TEMP%` uma pasta com oito SQLs e `run.json`. Cada execução usa `run_marker`, usuário, Frasco e quatro `operationId` novos. O recibo não contém segredo.

## Ordem exata

1. Aplique a migration D1 uma única vez no projeto de teste.
2. No SQL Editor, execute integralmente `00_preflight.sql`. Continue apenas com PASS.
3. Execute integralmente `10_prepare.sql`.
4. Abra duas abas independentes do SQL Editor.
5. Na aba A clique em executar `20_create_session_a.sql`; cerca de um segundo depois (e no máximo três), execute `21_create_session_b.sql` na aba B. Não espere A terminar. B deve permanecer aguardando até A confirmar após o `pg_sleep(12)`.
6. Depois que ambas terminarem, na aba A clique em executar `30_update_delete_session_a.sql`; cerca de um segundo depois (e no máximo três), execute `31_update_delete_session_b.sql` na aba B. Não espere A terminar. A atualização é a vencedora definida; a exclusão deve retornar `STALE_VERSION` e seu replay deve repetir o mesmo conflito.
7. Execute `90_verify.sql` em uma terceira aba livre. O único sucesso aceitável é `PASS — lock real observado...`. Rodar B depois de A já concluída falha porque a duração mínima de 7 segundos e a janela temporal de sobreposição fazem parte do veredito.
8. Execute `99_cleanup.sql` e confirme `total_fixtures = 0`.

## Resultado esperado

No create/create, A retorna `success`, B retorna `ENTITY_ALREADY_EXISTS`, há exatamente um Frasco e dois registros no ledger. No update/delete, A atualiza para `version = edit_version = 2`; B registra `STALE_VERSION`, o replay de B conserva o conflito, o Frasco segue ativo e não há alteração de saldo, Application, movimento ou histórico.

## Erro técnico ou conexão perdida

Em cada aba ainda conectada, execute `ROLLBACK;`. Aguarde o encerramento das demais sessões/transações antes do cleanup. Se uma aba caiu, o PostgreSQL desfaz sua transação e libera os locks ao encerrar a conexão. Só então execute `99_cleanup.sql`. O cleanup se recusa a agir sem coincidência simultânea do marker, hash, metadata Auth e todos os IDs do run; também recusa dados inesperados no usuário fixture. Se `10_prepare.sql` falhar, sua transação integral não cria conta nem marker e o cleanup recusará, como esperado.
