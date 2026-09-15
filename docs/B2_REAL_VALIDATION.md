# Validação real segura da B2.1

Este documento separa dois tipos de validação:

1. **smoke transacional de uma sessão**, executado por
   `supabase/tests/block_b2_real_smoke.sql` e sempre encerrado com `ROLLBACK`;
2. **concorrência e Auth reais**, que exigem fixtures temporários visíveis entre
   sessões e duas conexões independentes.

Nada deste plano deve ser executado em produção. O único destino permitido é o
projeto isolado `pepday-v3-test`, depois de revisão e autorização explícitas.

## 1. Smoke transacional

Executar o arquivo inteiro em uma única aba do SQL Editor. Não selecionar apenas
parte do arquivo.

O smoke:

- faz preflight antes da primeira escrita em todos os 20 UUIDs literais
  reservados: usuários, entidades, importação, legado e operações; IDs gerados
  automaticamente pelas RPCs não aparecem como literal e não entram no preflight;
- cria quatro usuários `.invalid`: FREE, TRIAL, PRO e outro PRO para isolamento;
- usa o trigger já instalado de bootstrap de conta;
- inicia o TRIAL pela RPC oficial;
- promove somente as duas assinaturas fixtures a `pro_active`, com `WHERE`
  explícito nos UUIDs recém-criados;
- cria dois frascos, duas rotinas, duas versões e uma âncora de importação;
- chama `register_application()` e `undo_application()` como `authenticated`;
- valida saldos, movimentos, replay, segundo Undo, entitlement, RLS e grants;
- captura reprovações funcionais e erros das etapas em blocos controlados, grava
  o primeiro resultado em estado local, pula mutações posteriores e alcança o
  `ROLLBACK` sem deixar deliberadamente uma transação abortada;
- executa `ROLLBACK` tanto após `PASS` quanto após `FAIL CONTROLADO`;
- consulta todas as tabelas envolvidas depois do rollback. A linha `TOTAL` deve
  mostrar zero e `PASS — nenhum UUID de fixture permaneceu`.

### Riscos e limites do smoke

- Ele insere linhas temporárias em `auth.users`; isso aciona apenas o bootstrap
  já instalado e não envia e-mail, pois os endereços são `.invalid` e a inserção
  é SQL direta.
- Todas as escritas ficam na mesma transação. Reprovações funcionais e erros
  capturados são mostrados como `FAIL CONTROLADO` e o lote segue até `ROLLBACK`.
- Não há `DELETE`, alteração de migration, criação de função ou trigger.
- O `UPDATE` existente alcança somente as assinaturas dos dois UUIDs PRO criados
  depois do preflight.
- `SET LOCAL ROLE authenticated` e o claim local validam RPC/RLS dentro do
  PostgreSQL real, mas não comprovam o caminho HTTP completo nem um JWT emitido
  pelo Supabase Auth.
- Uma única conexão não prova contenção, ordem de locks ou resultados sob disputa.

### Erro técnico residual e recuperação

Não existe garantia SQL de executar as instruções restantes quando o cliente
interrompe o lote antes que o PostgreSQL possa tratá-lo. Permanecem residuais:

- erro de parser fora dos blocos executáveis;
- falha em `BEGIN`, `SET LOCAL ROLE`, `RESET ROLE` ou no protocolo do cliente;
- perda de rede, encerramento da aba ou falha do SQL Editor.

Se a conexão for encerrada, o PostgreSQL reverte automaticamente a transação. Se
a aba mantiver a mesma sessão em estado abortado, executar isoladamente
`ROLLBACK;` nessa aba. Em seguida, executar isoladamente a consulta pós-rollback
que encerra `block_b2_real_smoke.sql`; a linha `TOTAL` deve ser zero. Não executar
`DELETE` ou `UPDATE` de limpeza.

Um resultado `FAIL CONTROLADO` não exige rollback manual: o próprio lote já chega
ao `ROLLBACK`. Não repetir o smoke até registrar e revisar a mensagem retornada.

## 2. Preparação exclusiva para concorrência

O smoke com rollback não pode fornecer fixtures a duas sessões: dados não
confirmados não ficam visíveis para a outra conexão. Portanto, a concorrência
precisa de um conjunto **diferente** de fixtures temporários, confirmado por curto
período e removido imediatamente ao final.

Procedimento seguro:

1. Reservar UUIDs novos, diferentes dos usados pelo smoke, para duas contas de
   teste, dois frascos, pelo menos três rotinas, versões e operações.
2. Fazer preflight em todas as tabelas antes da primeira inserção.
3. Criar somente contas `.invalid` e registros pertencentes a esses UUIDs.
4. Confirmar o setup em uma transação curta. Não usar conta humana existente.
5. Executar os cenários abaixo.
6. Remover somente os dois usuários fixtures por UUID; o `ON DELETE CASCADE`
   remove os registros dependentes.
7. Rodar consulta de verificação em `auth.users`, `profiles`, `subscriptions`,
   `trials`, `settings`, `vials`, `routines`, `routine_versions`, `applications`,
   `vial_movements`, `local_data_imports`, `legacy_import_records` e `audit_logs`.
   Todos os totais devem ser zero.

A criação confirmada e a remoção desses fixtures são uma etapa separada, sujeita
a autorização. Nunca reutilizar os UUIDs do smoke nem dados reais do usuário.

## 3. Duas sessões no mesmo frasco e disputa de `FOR UPDATE`

Usar duas abas do SQL Editor, denominadas A e B, cada uma com transação própria.
Ambas devem assumir `authenticated` e o claim da mesma conta fixture.

### Lock controlado

1. Na sessão A: `BEGIN`, selecionar o frasco fixture com `FOR UPDATE` e manter a
   transação aberta.
2. Na sessão B: chamar `register_application()` para uma rotina do mesmo frasco.
3. Confirmar que B permanece aguardando, sem aplicação, movimento ou saldo
   parcialmente visível.
4. Confirmar A sem alterar o frasco.
5. Confirmar que B conclui e produz exatamente uma aplicação, um movimento e um
   único desconto.

Esse cenário prova que a RPC respeita um lock de linha real já mantido por outra
sessão.

### Duas aplicações diferentes no mesmo estoque

1. Preparar duas rotinas fixtures distintas que apontem para o mesmo frasco.
2. Na sessão A: iniciar transação, registrar a primeira aplicação e manter a
   transação aberta.
3. Na sessão B: iniciar a segunda aplicação, com outro UUID e outra rotina/data.
4. B deve aguardar A. Após o commit de A, B deve usar como `balance_before` o
   `balance_after` confirmado por A.
5. Conferir a cadeia exata dos dois movimentos e o saldo final.

## 4. Mesma rotina e data

1. Usar a mesma conta, rotina, versão, frasco e `scheduled_date`, mas dois
   `operation_id` diferentes.
2. Iniciar a chamada A dentro de uma transação e mantê-la aberta após a RPC.
3. Iniciar B na segunda sessão.
4. Confirmar A; B deve terminar com o conflito de aplicação ativa para a mesma
   rotina/data, ou com a constraint única equivalente.
5. Conferir que existe somente uma aplicação ativa, um movimento de aplicação e
   um único desconto.

## 5. Auth/RLS real entre duas contas

O SQL Editor simula o claim no banco; para provar Auth real, usar dois access
tokens legítimos de contas fixtures e chamadas REST/Supabase JS.

Regras para o script local:

- mantê-lo fora do repositório, preferencialmente em `%TEMP%`;
- receber `SUPABASE_URL`, chave pública anon e os dois access tokens somente por
  variáveis de ambiente da sessão;
- nunca usar nem solicitar `service_role` no cliente;
- não imprimir tokens e limpá-los ao final;
- não armazenar senha, refresh token ou arquivo `.env` no projeto.

Com token A, consultar os frascos/aplicações de A e chamar suas RPCs. Com token B:

- a leitura REST filtrando IDs de A deve retornar lista vazia;
- `register_application()` com rotina/versão/frasco de A deve ser recusada;
- `undo_application()` com uma aplicação de A deve ser recusada;
- nenhuma contagem ou saldo de A pode mudar.

## 6. Concorrência por script local

Para disparo realmente simultâneo, o script temporário pode executar duas chamadas
HTTP com `Promise.all`, usando o mesmo token fixture:

- duas aplicações no mesmo frasco e rotinas diferentes;
- duas operações diferentes para a mesma rotina/data;
- dois replays do mesmo `operation_id`;
- replay de registro concorrente com Undo.

O script deve registrar somente status HTTP, duração, `replay`, IDs de operação e
saldos; nunca headers ou tokens.

## 7. Replay concorrente com Undo

1. Criar e confirmar uma aplicação fixture.
2. Disparar simultaneamente um replay com o mesmo `operation_id` e um Undo com UUID
   novo.
3. Repetir em novas aplicações fixtures para observar ambas as ordens possíveis.
4. É aceitável o replay refletir o estado imediatamente anterior ao Undo.
5. A condição obrigatória final é: uma aplicação original, um movimento negativo,
   no máximo um movimento de Undo, aplicação marcada como desfeita e saldo
   restaurado exatamente uma vez.

Esse cenário mede o risco baixo já documentado de leitura de replay concorrente,
sem transformar uma resposta momentaneamente anterior em divergência persistida.

## Evidências a guardar

Guardar somente resultados sem conteúdo privado:

- horário e duração de cada chamada;
- UUIDs exclusivos dos fixtures/operações;
- resultado ou SQLSTATE;
- `balance_before`, `balance_after` e saldo final;
- contagem de aplicações e movimentos;
- consulta final de limpeza com total zero.

Não guardar access tokens, e-mails reais, nomes de substâncias, doses humanas ou
qualquer segredo.
