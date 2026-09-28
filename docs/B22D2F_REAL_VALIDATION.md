# B2.2-D2-F — concorrência real de Rotinas

## Estado em 2026-09-27 (Mac, America/Los_Angeles)

**PASS PostgreSQL real em 2026-09-28.** D2-B/C/D estão em `04befe7`.
O Mac foi atualizado por fast-forward de `4233e36` para esse checkpoint:
nenhuma alteração local e nenhuma divergência exclusiva do Mac.
`main`, V2.9 e produção não foram alterados.

O pacote D2-F está implementado e validado localmente. A regressão SQL D2-D
incluindo D2-C/B/A, D1, B2.1, B1 e importação legada passou em PGlite 0.5.8.
PGlite não substitui sessões PostgreSQL reais. A suíte Node passou em 192/192
testes, incluindo falhas do observador, cleanup e validação do destino.

Uma tentativa pelo conector Supabase no `pepday-v3-test` não apresentou
sobreposição: A terminou às 00:40:18 UTC de 2026-09-28, e B começou às
00:43:06 UTC. O observador recusou o PASS corretamente. O replay retornou
sucesso, mas isso **não comprova concorrência**. A fixture desse run
(`24bd2ed2-d3a5-4319-911d-79eb1bb1f8f5`) foi removida com a guarda de procedência;
o banco confirmou `total_fixtures = 0`.

A variável `SUPABASE_DB_URL` não estava disponível neste ambiente. Não repetir
chamadas pelo conector supondo paralelismo: usar o runner com conexões diretas.

## Escopo e critérios

O gerador `scripts/prepare-b22d2f-real-validation.mjs` cria UUIDs novos por run,
uma conta descartável sem login, trial explícito, um frasco e seis cenários:

| Cenário | Resultado esperado da segunda sessão |
| --- | --- |
| Create com mesma operação | Replay, uma rotina/versão/operação |
| Create com operações diferentes e mesma rotina | ENTITY_ALREADY_EXISTS |
| Update × update sobre versão 1 | STALE_VERSION |
| Update × soft-delete sobre versão 1 | STALE_VERSION |
| Soft-delete × update | ENTITY_DELETED |
| Soft-delete com mesma operação | Replay sem segunda exclusão |

A primeira sessão mantém o lock após a RPC por 12 segundos. A segunda executa
como `authenticated` com `auth.uid()` da fixture. A terceira observa
`pg_blocking_pids`, PIDs distintos, `wait_event_type = Lock` e a primeira sessão
em `PgSleep`; limpa o snapshot estatístico a cada tentativa. Evidências e
horários do servidor ficam apenas no marker temporário.

O verificador exige todas as observações, sobreposição temporal, resultados,
cardinalidade do ledger e versões, snapshot corrente canônico, versões antigas
imutáveis, frasco/saldo intactos e ausência de aplicações/movimentos fabricados.
Também verifica replay dos seis resultados depois das corridas. Preservação de
histórico preexistente é coberta pela regressão SQL D2-D, não por estes seis
cenários. Não se declara validação HTTP/JWT real: o transporte deste pacote é SQL.

O cleanup confere metadata Auth, marker e todos os IDs, recusa dados de domínio
ou sessões Auth inesperados e remove somente a conta descartável. O runner
sempre espera as sessões terminarem, tenta rollback e cleanup mesmo após falha,
e recusa PASS se houver resíduos. Em falha de conexão/cleanup, inspecionar o
marker antes de qualquer remoção manual; nunca limpar por prefixo de e-mail.

## Execução no ambiente autorizado

Usar somente o projeto `fsbqpyyprtymwrmzsacp` (`pepday-v3-test`). A URL é
validada antes da conexão; não gravar credenciais em arquivos versionados,
argumentos de comando ou saídas. Disponibilizar `SUPABASE_DB_URL` por mecanismo
local seguro, como `.env.d2f` (ignorado pelo Git, permissão local 0600). O runner mantém verificação TLS; configurar CA confiável se necessário.

```sh
node --env-file=.env.d2f scripts/test-b22d2f-real-concurrency.mjs
```

O usuário do banco precisa observar as sessões, preparar e limpar a fixture.
O runner abre três conexões independentes com limites de conexão, consulta e
encerramento. Só aceitar `PASS FINAL D2-F` junto de cleanup zero.

Validação local do pacote:

```sh
PGLITE_MODULE=/caminho/pglite/dist/index.js node scripts/test-b22d2f-package-local.mjs
PGLITE_MODULE=/caminho/pglite/dist/index.js node scripts/test-b22d2d-sql.mjs
npm test
```

O teste local executa as operações sequencialmente e exige rejeição por falta de
lock. Depois usa evidências explicitamente sintéticas, apenas na instância
PGlite descartável, para exercitar o verificador completo e sua rejeição a um
conflito incorreto. Essas evidências nunca são enviadas ao Supabase.

## Resultado final

Em 2026-09-28, no PC da loja, o runner foi executado pelo Session Pooler com TLS
verificado e três conexões PostgreSQL independentes. Resultado:
`PASS FINAL D2-F — 6 cenários com lock observado e cleanup zero`.
D2-F está encerrado. Não reaplicar migrations D2-B/C/D sem necessidade.
