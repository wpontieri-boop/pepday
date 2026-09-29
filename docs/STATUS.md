# Status do projeto — fechamento do Bloco A

## Checkpoint aprovado

- **Data de fechamento do Bloco A:** 11/09/2026.
- **Situação:** Bloco A concluído e aprovado.
- **Commit-base aprovado:**
  `724ba23f0a11c77eff1e9637fd26a9ad21ca026c`.
- **Branch de continuidade:** `v3.0-bloco-b`, criada localmente diretamente do
  commit-base aprovado.
- **Ambiente atual de testes do Bloco A:**
  `https://pepday-v3-bloco-a-test.wpontieri.chatgpt.site/`.
- **Produção:** V2.9 permanece estável. Não alterar `main`, GitHub Pages nem a
  V2.9 até a aprovação final da V3.

`REQUISITOS.txt` continua sendo a fonte das decisões de produto já aprovadas.
Este checkpoint atualiza apenas a documentação de continuidade; não altera nem
reinterpreta essas decisões.

## Testes humanos aprovados

- Login por e-mail validado, incluindo OTP de seis dígitos, sessão preservada
  após recarregar e logout.
- Login com Google validado no ambiente V3 de testes.
- Cadastro completo, maioridade, Termos de Uso, Política de Privacidade e
  consentimentos validados.
- Importação inicial do legado validada por teste humano.
- O aparelho continha **2 rotinas e 2 frascos**; após a importação, a conta
  continha **2 rotinas e 2 frascos**.
- A cópia local permaneceu preservada após a importação.
- Os fluxos e ajustes aprovados de Frascos/Rotinas foram validados, inclusive o
  retorno da criação de frasco com seleção automática e os tooltips responsivos.

Essas evidências estão aceitas. Não repetir SQL, autenticação, OTP, sessão,
logout ou outros testes já aprovados sem necessidade objetiva para um novo delta.

## Fundação técnica concluída no Bloco A

- Estrutura inicial das tabelas aprovadas, UUIDs, vínculos por proprietário, RLS
  e grants no projeto isolado `pepday-v3-test`.
- Inicialização de conta FREE, consulta de entitlement e início explícito de trial
  preparados na fundação de backend.
- Auth por e-mail/OTP e Google integrado e validado sem expor credenciais.
- Cadastro com confirmação de maioridade e consentimentos jurídicos versionados.
- Termos de Uso e Política de Privacidade disponíveis no cadastro e no Perfil.
- Importação/mesclagem do legado com snapshot, conferência de identidade/hash,
  preservação de saldos, histórico privado e cópia local.
- Conversão validada sem sobrescrever registros existentes, sem rebaixar saldo,
  sem fabricar aplicações e sem reinterpretar histórico incompleto.
- Fluxo Rotina → cadastrar novo frasco → salvar/cancelar → retornar à rotina sem
  perda do rascunho; novo frasco selecionado uma única vez após salvar.
- Tooltips acessíveis e responsivos nos campos aprovados de Frascos e Rotinas.
- Cache público da V3 isolado dos dados de Auth/API e de outros ambientes.
- Correção/versionamento final do Service Worker no commit
  `724ba23f0a11c77eff1e9637fd26a9ad21ca026c`, invalidando o CSS antigo em cache
  e carregando o `style.css` atual sem interferir na V2.9.

## Regras de preservação

- A V2.9 é a produção estável até aprovação final da V3.
- Não alterar `main`, GitHub Pages ou a V2.9 durante o Bloco B.
- Não apagar automaticamente dados ou backups locais após importação ou opção de
  usar a conta.
- Respeitar os mapeamentos de UUID, `done`, `doseHistory` e saldo já importados;
  não descontar novamente aplicações anteriores.
- Não abrir escrita direta nas tabelas para contornar transações ou RLS.
- Não armazenar Client Secret, senhas, service-role keys ou chaves privadas no
  código/repositório. Somente configuração pública pode ir ao frontend.
- Não repetir testes aprovados quando não forem afetados pelo delta.

## Fase B1 FREE/TRIAL/PRO — concluída e aprovada

- Fonte única de entitlement permanece no Supabase e agora retorna de forma
  uniforme `free`, `trial`, `pro_active` ou `pro_expired`, origem, elegibilidade
  do trial, datas e horário do servidor.
- Nova migration incremental `202609110003_block_b1_entitlements.sql`; nenhuma
  migration aplicada do Bloco A foi modificada.
- Início do trial somente por clique explícito, com sete dias calculados no
  backend, lock por conta e idempotência para clique/reenvio concorrente.
- O cliente não usa relógio ou `localStorage` para conceder/renovar PRO.
- Hardening local mantém a autoridade gravável em closure privada alimentada pela
  resposta autenticada de `get_entitlement()`; eventos DOM não alteram acesso.
- Navegação programática, tutorial e mutadores atuais de Rotinas, Frascos, saldo,
  aplicação e undo passam pela mesma guarda antes de alterar dados locais.
- Ex-assinante expirado não pode iniciar trial depois, mesmo com `trial_used=false`.
- Perfil exibe o estado atual e, quando elegível, “Começar 7 dias grátis” e
  “Agora não”, sem cartão, compra, Mercado Pago ou simulação de pagamento.
- Gate PRO reutilizável aplicado às entradas e ações de Rotinas/Frascos; abas
  continuam visíveis e a Calculadora permanece FREE sem login.
- Ao bloquear/expirar, a interface oculta o conteúdo PRO e mantém os dados locais
  e da conta intactos.
- Service Worker versionado para incluir os módulos B1, sem publicar
  ou alterar o ambiente de produção.
- Backend B1 aplicado com sucesso no Supabase `pepday-v3-test`.
- Hardening do gate aprovado.

### Validação real e humana aprovada da B1

- Teste SQL real: PASS; rollback confirmado com
  `usuarios_teste_restantes = 0`.
- Teste humano FREE: PASS.
- Gate PRO em Rotinas: PASS.
- “Agora não” manteve a conta no FREE: PASS.
- Calculadora permaneceu disponível no FREE: PASS.
- Trial iniciado por ação explícita, sem cartão: PASS.
- Duração confirmada de sete dias, de 11/09/2026 18:08 até
  18/09/2026 18:08.
- Rotinas e Frascos liberados durante o TRIAL: PASS.
- Trial persistiu após Ctrl+F5: PASS.
- Duas rotinas e dois frascos permaneceram preservados localmente e na conta.
- Ajuste de UX de `+ Nova` Rotina e `+ Novo` Frasco concluído no commit
  `9c30f1296d4fc4e5c6c870ec8a1f3042499069f3`. Não exige nova publicação Astra
  isolada; será incluído na próxima publicação de testes para economizar créditos.

### Validação local da B1

- 17 testes Node B1, incluindo hardening de evento, navegação, tutorial e mutadores: PASS.
- 58 testes locais da suíte de regressão: PASS;
  somente mocks/fixtures, sem autenticação ou importação real.
- Sintaxe de `app.js`, `access-control.mjs`, `account-ui.mjs`, `cloud.mjs`, `entitlement.mjs` e
  `pro-gate.mjs`: PASS.
- Suite SQL B1 em PGlite 0.5.8 efêmero: PASS para FREE/TRIAL/PRO, sete dias,
  idempotência, ex-assinante expirado, nova sessão e preservação de dados.
- QA local em navegador, sem login real: Calculadora disponível no FREE; Rotinas
  visível com convite PRO; “Agora não” mantém o FREE; Perfil anônimo correto.
- Nenhum teste real de OTP, Google, importação ou SQL do Bloco A foi repetido.

## Fase B2.1 — encerrada e aprovada

- Nova migration incremental
  `202609140004_block_b2_transactional_applications.sql`; migrations anteriores
  permanecem intactas.
- Migration incremental de privilégios mínimos do runner
  `202609150005_block_b2_validation_service_role.sql` aplicada com sucesso no
  `pepday-v3-test`, sem liberar escrita para `anon` ou `authenticated` e sem
  alterar RLS.
- RPC `register_application(...)` criada para persistir aplicação, movimento
  negativo e atualização de saldo na mesma transação, usando o snapshot indicado
  de `routine_versions` e cálculos PostgreSQL `numeric`.
- RPC `undo_application(...)` criada para marcar a aplicação como desfeita,
  preservar o histórico original, criar movimento inverso e devolver exatamente
  o `dose_mg` persistido.
- UUIDs de operação, locks de frasco, unicidade por intenção e por rotina/data,
  validação de proprietário e entitlement no backend protegem reenvios e acesso
  cruzado.
- Constraints garantem `application_id` e direção do delta em movimentos de
  aplicação/Undo, além de no máximo um movimento de cada tipo por aplicação.
- Hardening final persiste `requested_applied_at` e `requested_undone_at`
  separadamente dos horários efetivos. Assim, `NULL` identifica de forma estável
  a intenção de usar o horário do servidor, enquanto uma intenção com horário
  explícito só aceita replay com exatamente o mesmo valor.
- `register_application(...)` exige rotina atual ativa e valida
  `scheduled_date` exclusivamente pelo snapshot da `routine_version` indicada:
  data inicial, `daily`, `alternate`, `5on2off` e `weekdays`.
- Frontend, `localStorage`, navegação, UX, Service Worker e B1 não foram integrados
  nem alterados nesta fase.

### Validação local da B2.1

- Suite SQL B2.1 em PGlite 0.5.8 efêmero: PASS para mg/mcg, cálculos, saldos,
  movimentos, idempotência, conflitos, TRIAL/PRO, bloqueio FREE/expirado,
  isolamento, rollback total, Undo, identidade temporal rigorosa, rotina ativa e
  calendários de todas as frequências aprovadas.
- Regressão da importação executada após a migration B2.1: PASS; saldo consolidado
  importado permaneceu como ponto de partida, sem aplicações fabricadas ou nova
  dedução do legado.
- PGlite validou SQL, constraints, transações e isolamento lógico em uma conexão;
  os pontos de concorrência entre sessões e transporte Auth/RLS foram posteriormente
  confirmados no `pepday-v3-test`, conforme o checkpoint abaixo.

### Validação real da B2.1 — checkpoint de 15/09/2026

- A migration B2.1 está aplicada no Supabase de testes `pepday-v3-test`.
- O smoke funcional real terminou com `PASS`.
- O rollback foi confirmado, com `0` fixture remanescente nas 13 tabelas
  verificadas.
- Veredito consolidado do smoke: `PASS FINAL`.
- Migration `202609150005_block_b2_validation_service_role.sql`: aplicada com
  sucesso no `pepday-v3-test`.
- Verificação de privilégios:
  `PASS — privilégios mínimos do service_role confirmados`.
- Concorrência SQL real: mesmo frasco `PASS`; contenção real de `FOR UPDATE`
  `PASS`; mesma rotina/data `PASS`.
- Cleanup SQL: `PASS`, com zero fixtures remanescentes.
- Runner real final: `PASS FINAL — AUTH/RLS + REPLAY/UNDO`.
- Auth/RLS real entre duas contas: `PASS`.
- Replay concorrente: `PASS`.
- Undo e idempotência, incluindo recusa do segundo Undo: `PASS`.
- Cleanup final Auth/domínio: `PASS`.
- Segredos e variáveis sensíveis removidos da sessão do PowerShell após o teste.
- **B2.1 encerrada e aprovada.**

## Fase B2.2-A — encerrada e aprovada

Validação humana real concluída em 15/09/2026:

- Persistência de Frasco após reload: `PASS`.
- Segunda aba abriu logada e enxergou o mesmo escopo: `PASS`.
- Frasco criado na aba 2 persistiu e apareceu na aba 1 após reload: `PASS`.
- Logout bloqueou acesso a Frascos: `PASS`.
- Login com segunda conta e trial PRO de sete dias abriu Frascos vazio: `PASS`.
- Nenhum dado da primeira conta apareceu na segunda: `PASS`.
- Isolamento entre contas: `PASS`.
- **B2.2-A Repository Local encerrado e aprovado.**

## Fase B2.2-C — encerrada e aprovada

Validação real controlada concluída no `pepday-v3-test` em 16/09/2026:

- Application real com JWT: `PASS`.
- Resposta perdida e replay com o mesmo UUID: `PASS`.
- Nenhum segundo desconto: `PASS`.
- Falha local após sucesso remoto reparada por replay: `PASS`.
- Undo real: `PASS`.
- Replay do Undo: `PASS`.
- Segundo Undo com UUID diferente resultou no conflito esperado: `PASS`.
- Cardinalidade de Application e movimentos: `PASS`.
- Saldo restaurado corretamente: `PASS`.
- Isolamento por usuário e run marker: `PASS`.
- Cleanup Auth/domínio: `PASS`.
- Resultado final: `PASS FINAL — B2.2-C REAL SYNC/REPLAY/UNDO`.
- O runner validado usa `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e
  `SUPABASE_SERVICE_ROLE_KEY`; a variável legada `SUPABASE_ANON_KEY` não é
  utilizada nesse runner.
- As variáveis sensíveis foram removidas da sessão do PowerShell após o teste;
  a verificação final retornou `False / False / False`.
- **B2.2-C encerrado e aprovado.**

## Fase B2.2-D1 — encerrada e aprovada

Validação PostgreSQL real automatizada concluída no `pepday-v3-test` em
17/09/2026:

- Migration `202609160006_block_b22d1_versioned_vials.sql` aplicada no ambiente
  de testes.
- Create concorrente com `operationId` diferentes e o mesmo `vial_id`: `PASS`.
- Espera e serialização real pelo lock em `profiles`: `PASS`.
- Update concorrente com soft-delete: `PASS`.
- Validação real final: `PASS FINAL — B2.2-D1 REAL CONCURRENCY`.
- Cleanup final do runner: `PASS`, sem resíduos do run.
- O runner final é automatizado, abre conexões PostgreSQL independentes, exige
  sobreposição real e rejeita falso positivo sequencial.
- Correção do cleanup de `auth.refresh_tokens.user_id`: comparação textual
  aplicada na fonte e coberta por regressão.
- Encerramento pendente do runner (`unsettled top-level await`): corrigido com
  timeouts e término explícito em `PASS` ou `FAIL` sanitizado.
- Ambiguidade PostgreSQL `unknown - unknown` no operador JSONB: corrigida com
  casts explícitos de `text` e regressão pelo verificador completo.
- Suíte local final: `164/164 PASS`.
- D1 em PGlite: `PASS`.
- Regressão B2.1: `PASS`.
- `node --check`: `PASS`.
- `git diff --check`: `PASS`.
- `SUPABASE_DB_URL` removida do ambiente após a execução real.
- **B2.2-D1 Backend versionado de Frascos encerrado e aprovado.**

## Pendências

### Bloco B

- B1 encerrada e aprovada; não repetir seus testes sem necessidade causada por
  alteração posterior.
- B2.1 encerrada e aprovada; não repetir smoke, concorrência ou transporte Auth
  sem necessidade causada por alteração posterior nas RPCs ou no schema envolvido.
- B2.2-A, B2.2-C e B2.2-D1 encerrados e aprovados; não repetir suas validações
  reais sem necessidade causada por alteração posterior no fluxo ou backend
  envolvido.
- A integração Rotina ↔ Frasco e os pontos aprovados da Calculadora estão concluídos,
  incluindo dependências de outbox, `remoteRef` e versionamento remoto.
- Concluir a exposição do estado local-first na interface: status de sincronização,
  reconexão, conflitos e retomada já suportados pelo engine devem aparecer de forma
  coerente no Perfil e nos fluxos funcionais.
- Definir entitlement PRO offline/local-first sem substituir a autoridade de
  `get_entitlement()` e das datas do servidor.
- Implementar avisos de três dias e um dia antes do fim do trial.
- Atualizar automaticamente campos apenas informativos como `completed_at` somente
  se isso se mostrar necessário; eles não participam da autorização atual.
- Integrar os dados locais/importados à fonte usada pelas telas, preservando os
  registros legados e sem criar eventos históricos por suposição.
- Exibir no Perfil o estado da conta, entitlement, trial e sincronização.
- Executar testes locais direcionados e validação humana somente dos fluxos novos.

### Blocos posteriores e pré-lançamento

- Mercado Pago: pagamentos e webhooks verificados pelo backend — não implementado.
- Brevo: e-mails transacionais — não implementado.
- Firebase/FCM: push opcional e privado — não implementado.
- Gestão completa de privacidade, exportação/exclusão, revisão jurídica final,
  observabilidade, backup/recuperação do banco e validação de release candidate.
- Publicação da V3 em produção somente após conclusão dos blocos, testes finais e
  aprovação expressa.

## Escopo exato do Bloco B

1. **FREE/TRIAL/PRO:** aplicar os gates aprovados; calculadora e tutorial no
   FREE; recursos PRO visíveis, porém protegidos com explicação; trial de sete
   dias somente por clique explícito, uma vez por conta e sem reinício artificial.
2. **Rotina ↔ Frasco:** usar o frasco como fonte de estoque, manter referência da
   rotina e integrar os atalhos aprovados da calculadora (salvar/acompanhar,
   salvar como rotina e cadastrar frasco e continuar com preenchimento seguro).
3. **Aplicação e undo:** registrar aplicações como eventos imutáveis; criar
   movimento e atualizar saldo atomicamente; desfazer por reversão e movimento
   inverso; usar UUID/idempotência.
4. **Sincronização:** salvar primeiro localmente, operar offline, enfileirar
   pendências e sincronizar ao reconectar. Usar versão/timestamps em editáveis e
   resolução explícita de conflitos. Aplicações/movimentos não usam simples
   “última escrita vence”.
5. **Legado:** respeitar mapeamentos e histórico preservado, sem nova dedução de
   saldo, fabricação de eventos, sobrescrita silenciosa ou exclusão da cópia local.
6. **Perfil e fluxos funcionais:** mostrar conta, entitlement/trial e estado da
   sincronização; ligar as telas à fonte local/nuvem coerente.

Ficam fora do Bloco B: Mercado Pago, Brevo, Firebase/FCM, telas comerciais
completas, mudanças em produção e qualquer decisão nova de produto não registrada
em `REQUISITOS.txt`.

## Ordem recomendada de implementação

1. Definir e testar o contrato unificado de dados e entitlement.
2. Criar as operações transacionais de aplicação, movimento, saldo e undo no
   backend de testes.
3. Aplicar idempotência, versionamento e regras de conflito.
4. Implementar o repositório local-first, fila offline e retomada de sincronização.
5. Integrar com segurança dados locais e importados, sem reprocessar histórico.
6. Conectar Frascos, Rotinas, Histórico e pontos aprovados da Calculadora.
7. Aplicar gates e fluxos FREE/TRIAL/PRO.
8. Exibir estados de conta, trial e sincronização no Perfil.
9. Executar testes automatizados direcionados e, depois, a validação humana dos
   novos fluxos.
10. Atualizar documentação e versionar cache apenas quando o delta funcional do
    Bloco B exigir.

## Próximo passo exato

B2.2-D2-F permanece encerrado e aprovado no `pepday-v3-test`, com concorrência
PostgreSQL real, lock observado, replay/conflitos/versionamento e cleanup zero.

A integração local Rotina ↔ Frasco, os pontos aprovados da Calculadora e o ajuste
manual versionado de saldo também estão concluídos: create/edit/delete usam RPCs
versionadas, dependências da outbox são respeitadas, confirmações remotas atualizam
`remoteRef`/versões e o ajuste de saldo usa `adjust_vial_balance_versioned`.

B2.2-D4 foi encerrado em 2026-09-28 com validação real HTTP/Auth/JWT:
`PASS FINAL B2.2-D4 — HTTP/Auth/JWT Frasco → Rotina create/edit/delete + RLS + cleanup zero`.
O runner validou duas contas Auth reais, isolamento RLS, replay de criação, vínculo
Frasco → Rotina, edição versionada, soft-delete em ordem segura e três versões
imutáveis da Rotina. A exclusão administrativa da conta também foi endurecida:
as FKs internas de domínio usam `ON DELETE CASCADE` para o cleanup da conta, e o
guard `pepday_assert_version_keeps_current_routine()` passou a executar como
`SECURITY DEFINER` com grants restritos a `postgres`. O helper interno
`rls_auto_enable()` também teve EXECUTE público revogado.

Migrations do checkpoint: `20260928173930` e `20260928175036`, ambas alinhadas
no histórico remoto do projeto de teste. Verificação final: zero contas fixture,
zero perfis/operações órfãs e regressão completa `208/208 PASS`.

O gate de Perfil/entitlement/sincronização local-first foi implementado em
2026-09-28. O Perfil agora resume a outbox real como sincronizado, sincronizando,
offline, pausado ou atenção, preservando os dados locais e sem transformar estado
local em autorização. `get_entitlement()` e `server_now` continuam sendo a
autoridade do servidor; o trial ganhou avisos informativos de até 3 dias e menos
de 1 dia antes do término. Mensagens antigas prometendo sincronização em bloco
futuro foram removidas, e o servidor local/cache V3 passaram a incluir os módulos
de sync usados pelo Perfil. Regressão completa: `214/214 PASS`.

A fonte confirmada da conta passou a hidratar o repositório local em 2026-09-28:
Frascos, Rotinas, versões, Applications e movimentos são lidos via sessão/RLS,
convertidos para o formato local e persistidos atomicamente antes da retomada da
fila. Entidades com operação local pending/syncing/failed/conflict não são
sobrescritas pelo snapshot remoto. Histórico local de Frasco e doseHistory/done
da Rotina são preservados; histórico confirmado remoto é incorporado sem
duplicação. O cache V3 inclui o novo módulo.

O tratamento explícito de conflitos de Frascos/Rotinas também foi fechado no
Perfil: conflitos preservam o snapshot remoto retornado pelo backend, ficam
visíveis ao usuário e nunca usam “último vence”. “Usar versão da conta” encerra
a intenção local conflitante e força nova hidratação confirmada; “Manter deste
aparelho” cria um novo operationId sobre a versão remota atual (e novo
routineVersionId para Rotinas), preservando a intenção local sem reutilizar o UUID
que já registrou conflito. Conflitos de eventos históricos continuam sem resolução
automática. Smoke Chrome local carregou a tela e o módulo de hidratação; suíte
direcionada `13/13 PASS` e regressão completa `222/222 PASS`.

No QA manual em dois navegadores, o Perfil autenticado/PRO ficou correto, mas o
gate de Frascos/Rotinas podia permanecer no estado de login quando `pro-gate.mjs`
era avaliado antes de `account-ui.mjs` publicar `globalThis.PepDayAccess`.
O gate passou a consultar a autoridade dinamicamente em cada decisão, sem congelar
uma referência ausente no carregamento. O cache V3 foi incrementado para evitar
entrega do módulo antigo. Regressão do gate: `19/19 PASS`; suíte completa:
`223/223 PASS`.

No mesmo QA, a transição offline→online expôs um segundo caso: `refresh()` e o
callback de Auth limpavam o entitlement confirmado antes de reconfirmar a sessão,
fazendo Frascos/Rotinas parecerem FREE/deslogados enquanto o Perfil ainda mostrava
a conta ativa. A limpeza passou a preservar temporariamente o último entitlement
confirmado enquanto existe sessão e a zerá-lo somente quando a ausência de sessão
é confirmada. O cache V3 foi incrementado novamente. Regressão do bloco:
`20/20 PASS`; suíte completa: `224/224 PASS`.

O QA final de conflito em dois navegadores foi concluído manualmente com PASS:
“Usar versão da conta” restaurou a versão remota confirmada e “Manter deste aparelho”
recriou a intenção local sobre a versão remota atual, sincronizando sem duplicação.
Produção, V2.9 e `main` permanecem intocados.

Refinamento de UX posterior: ao editar Frasco ou Rotina a tela agora rola suavemente
até o formulário no topo e posiciona o foco no campo de nome sem provocar novo salto
de rolagem. O cache V3 foi incrementado para entregar o `app.js` atualizado.
Teste direcionado de Rotinas/Frascos: `8/8 PASS`; suíte completa: `224/224 PASS`.
A alteração da quantidade inicial do Frasco continua fora da edição genérica.

## Bloco C — Billing Foundation / Mercado Pago

A fundação server-side de billing foi iniciada em 2026-09-28, ainda sem credenciais
Mercado Pago e sem integração de checkout no navegador. O modelo mantém o princípio
aprovado de que retorno/redirecionamento do frontend nunca concede PRO.

Migrations aplicadas somente no `pepday-v3-test`:
- `20260928202253_block_c_billing_foundation.sql`;
- `20260928202509_block_c_billing_indexes.sql`.

A tabela `billing_events` funciona como ledger mínimo e idempotente, sem armazenar
payload bruto, e não possui acesso para `anon` ou `authenticated`. A RPC
`apply_billing_event` é `SECURITY DEFINER`, mas EXECUTE foi concedido somente a
`service_role`; o advisor de segurança não a listou como executável por usuário
logado. O motor normalizado cobre aprovação, pendência, rejeição, falha de renovação,
cancelamento, reativação, pausa e expiração. Falha de renovação mantém PRO por 3 dias;
cancelamento mantém o período já pago; replay é idempotente e evento cronologicamente
antigo é marcado como stale.

Validação real após aplicação no projeto de testes:
`PASS FINAL BLOCO C BILLING FOUNDATION — aprovação + idempotência + stale +
cancelamento + reativação + tolerância 3 dias + privilégios`.
Teste local do contrato: `5/5 PASS`; regressão completa: `229/229 PASS`.
O advisor de performance apontou inicialmente a FK nova sem índice; a migration
incremental adicionou `billing_events_subscription_received_idx` e removeu esse
achado. Os avisos de performance restantes são anteriores a este delta.

O receptor `mercado-pago-webhook` também foi preparado localmente como Edge
Function pública somente no transporte (`verify_jwt=false`), mas protegida pela
assinatura HMAC oficial do Mercado Pago. A função valida `x-signature` antes de
ler/processar o corpo, consulta o recurso canônico em `/preapproval/{id}` ou
`/authorized_payments/{id}`, resolve a assinatura interna pelo ID do provedor ou
`external_reference` PepDay e somente então chama `apply_billing_event`. Status
`authorized` de uma assinatura nova, sem pagamento aprovado, não libera PRO.
Segredos ficam exclusivamente em variáveis da Edge Function; nenhuma credencial
foi adicionada ao repositório. Testes do webhook: `10/10 PASS`; regressão completa:
`239/239 PASS`. Deploy funcional e validação real aguardam credenciais/plan IDs
do Mercado Pago de testes.

A tela comercial e o início seguro do checkout também foram preparados. O Perfil
agora pode exibir “Escolha seu PepDay PRO”, com mensal de R$ 14,90 e anual de
R$ 99,90 destacado como “Mais vantajoso”, economia anual de R$ 78,90, benefícios
e aviso de preservação dos dados. PRO expirado recebe um caminho explícito para
“Ver planos”.

A Edge Function `mercado-pago-checkout` valida o JWT do usuário diretamente no
Supabase Auth, exige cadastro/aceites completos, escolhe o plan ID exclusivamente
por configuração server-side, cria `external_reference` interna, usa
`payer_email` da sessão autenticada e chama `POST /preapproval`. O frontend
recebe apenas o `init_point` HTTPS validado do Mercado Pago; não grava entitlement,
não chama `apply_billing_event` e não ativa PRO. O retorno de cobrança continua
dependente do webhook confirmado. Testes direcionados do checkout: `12/12 PASS`;
regressão completa: `251/251 PASS`.

A fundação de aquisição pelo cartão/QR também foi implementada. A landing está em
`/cartao/`, registra localmente a origem fixa `card / qr / cartao-v1` e leva o
usuário ao app sem prometer benefício automático. Após login e cadastro completo,
`claim_card_acquisition()` grava a atribuição first-touch server-side; uma segunda
tentativa não sobrescreve a primeira. A atribuição é analítica e NÃO concede desconto
ou PRO por si só. Migration aplicada apenas no `pepday-v3-test`:
`20260928205127_block_c_acquisition_attribution.sql`.
Validação real: `PASS FINAL BLOCO C AQUISICAO — first-touch cartão/QR +
idempotência + rollback zero`. Smoke local: `/cartao/ = 200`; testes direcionados
`6/6 PASS`; regressão completa `257/257 PASS`. O QR físico definitivo continua
pendente do domínio final para não fixar o cartão em URL de homologação.

Refinamento comercial da landing do cartão: o selo passou para “BENEFÍCIO EXCLUSIVO
DO CARTÃO”, foi adicionada uma faixa explicando que condições exclusivas poderão ser
disponibilizadas para esse acesso e o rodapé técnico foi substituído por uma chamada
comercial. Nenhum percentual, desconto ou vantagem específica foi inventado antes da
regra promocional ser definida. Cache V3 incrementado para entregar a nova landing.
Teste da aquisição permanece `6/6 PASS`; regressão completa `257/257 PASS`; smoke
local `/cartao/ = 200` com a nova comunicação.

A landing principal de marketing foi definida como padrão separado da landing curta
do cartão. Durante homologação ela vive em `/site/`; no domínio final poderá assumir
a raiz pública, mantendo o app/PWA em rota própria. Direção visual: landing clara,
clean e estilo SaaS; app interno permanece dark premium.

A primeira versão estrutural de `/site/` já contém Hero, problema, solução, recursos,
como funciona, mockups visuais do próprio PepDay, história do produto, FREE x PRO,
prova social preparada para relatos reais autorizados e CTA final. Depoimentos
fictícios não serão publicados como experiência real. Documento oficial:
`docs/LANDING-MARKETING.md`.

Refinamento comercial posterior: o Hero ficou mais compacto, cards de problema
ganharam maior presença, o plano anual foi reforçado visualmente e o CTA final ficou
mais evidente. O bloco da Calculadora passou a usar uma seringa U-100 visual completa,
com escala numerada de 0 a 100 UI, preenchimento do exemplo e marcador destacado em
20 UI. A comunicação deixa explícito que a marcação representa o cálculo feito com os
valores informados pelo próprio usuário e não recomenda dose. Os placeholders de
depoimentos foram removidos da página visível e substituídos por benefícios
verificáveis; um template interno permanece preparado para relatos reais autorizados.
Testes direcionados da landing: `7/7 PASS`; regressão completa: `264/264 PASS`.
Smoke local: `/site/ = 200`, seringa presente, escala até 100 UI, alvo 20 UI e
nenhum depoimento fictício publicado.

Homologação pública isolada criada no Render, vinculada somente à branch
`v3.0-bloco-b`, sem alterar V2.9, `main` ou produção. URL:
`https://pepday-v3-homologacao.onrender.com/`; landing principal:
`https://pepday-v3-homologacao.onrender.com/site/`; cartão:
`https://pepday-v3-homologacao.onrender.com/cartao/`. O deploy do commit
`e3bb660` ficou `LIVE`. Validação via internet pelo PC da loja: Home `200`,
landing `200` com seringa/alvo 20 UI, cartão `200` e CSS da landing `200`.
O build publica apenas os arquivos públicos necessários e exclui docs, testes,
migrations e arquivos de ambiente.

A landing de marketing passou a usar capturas reais da própria V3, geradas em sessão
limpa do Chrome sem login e sem dados pessoais. Foram adicionadas
`site/assets/calculator-u100-real.png` (Calculadora com resultado e seringa U-100)
e `site/assets/home-real.png` (Home do PepDay). O Hero usa a tela real da
Calculadora e a seção de demonstração usa a Home real, mantendo apenas um mockup
conceitual de Frascos por enquanto. Testes direcionados continuam `7/7 PASS`.

A fundação do painel administrativo de aquisição também foi implementada. A migration
`20260928215536_block_c_admin_acquisition_metrics.sql` está aplicada apenas no
`pepday-v3-test`. A RPC `get_admin_acquisition_metrics(7|30|90)` exige sessão
autenticada e `profiles.role='admin'`, retornando somente contagens agregadas:
novas contas, contas atribuídas a cartão/QR, outras origens, trials, conversões pagas,
PRO pagos ativos e taxas cartão→trial/cartão→PRO. Nenhum nome, e-mail, UUID de cliente,
rotina, frasco ou dado sensível é retornado.

Sua conta de homologação foi promovida para `admin` somente no projeto de teste.
Validação SQL real: `PASS FINAL BLOCO C ADMIN METRICS — admin agregado + sem PII +
usuário comum bloqueado`. O advisor de segurança sinaliza a RPC por ser
`SECURITY DEFINER` executável por `authenticated`; neste caso isso é intencional e
foi validado porque a própria função rejeita qualquer conta sem role admin antes de
consultar/retornar métricas. A tela privada está em `/site/admin/`, compartilha a
sessão Supabase da V3, usa login por código com `shouldCreateUser:false` e explica
explicitamente que “cartão/QR” significa conta atribuída, não scan anônimo.
Testes direcionados do painel: `6/6 PASS`; regressão completa: `270/270 PASS`;
smoke local de `/site/admin/` e do módulo RPC: `200`.

A fundação de e-mails transacionais via Brevo também foi preparada, sem ativar envio.
Migrations aplicadas somente no `pepday-v3-test`:
`20260928220752_block_c_brevo_email_outbox.sql` e
`20260928221031_block_c_brevo_email_indexes.sql`. O outbox é backend-only, com
RLS, sem leitura direta nem mesmo por `service_role`; as operações passam por RPCs
service-role-only de enqueue, claim e conclusão. O registro guarda apenas user_id,
tipo do evento, dedupe e metadados de entrega — não armazena endereço de e-mail,
nome, rotina, frasco ou dado de saúde.

O worker `brevo-email-worker` está preparado em código, mas NÃO foi implantado nem
ativado porque ainda não existem `BREVO_API_KEY`, templates e segredo interno
configurados. Ele exige segredo próprio antes de reivindicar eventos, resolve o
destinatário somente no backend, escolhe template por variável de ambiente, usa o
endpoint fixo do Brevo e implementa retry/backoff sem logar destinatário, payload ou
segredos. O segredo interno é comparado por SHA-256.

Validação SQL real do outbox:
`PASS FINAL BLOCO C BREVO OUTBOX — enqueue + dedupe + claim lock + complete +
rollback + privilégios`. Testes direcionados Brevo: `10/10 PASS`; regressão
completa: `280/280 PASS`. O advisor de performance deixou de apontar o FK novo do
outbox após o índice; o índice aparece como não usado apenas porque acabou de ser
criado. Os demais FKs sem índice são anteriores a este delta.


A fundação de push via Firebase Cloud Messaging (FCM) foi concluída em código e banco
de homologação. A migration aplicada somente no `pepday-v3-test` é
`20260929004210_block_c_fcm_push_foundation.sql`. Ela adiciona
`settings.operational_notices`, instalações de push por dispositivo e outbox por
instalação, todos sem payload de saúde. As preferências de rotina, reposição,
operacional e segurança são checadas no enqueue e novamente no claim.

As RPCs de cliente `register_push_installation`, `disable_push_installation` e
`update_push_preferences` exigem sessão autenticada e operam somente com
`auth.uid()`. Enqueue/claim/conclusão ficam exclusivos de `service_role`. As tabelas
de push não possuem acesso direto por `anon`, `authenticated` ou `service_role`;
o acesso passa somente pelas RPCs previstas. O worker `fcm-push-worker` usa mensagens
fixas e genéricas para tela bloqueada, sem substância, dose, histórico ou texto livre.

Validação SQL real:
`PASS FINAL BLOCO C FCM — preferências + instalação + enqueue + bloqueio + claim +
complete + rollback + privilégios`. Testes direcionados FCM: `11/11 PASS`;
regressão completa: `291/291 PASS`. O advisor não apontou novos FKs sem índice.
Os avisos de RLS sem policy são intencionais porque as tabelas não são expostas para
acesso direto; os avisos de SECURITY DEFINER nas RPCs de cliente são esperados e
mitigados por `auth.uid()` e pelos testes reais de privilégio.

O worker FCM está preparado em código, mas NÃO foi implantado/ativado porque ainda não
foi configurada a service account real do Firebase no ambiente de teste. Nenhuma
credencial Firebase foi gravada no repositório e nenhum push real foi enviado.

## Registro deste checkpoint

O checkpoint documental inicial `9b75ae8a2ece447463863bb32a7b4eac64bdaf1d`,
a implementação B1 e seu hardening foram enviados somente para
`origin/v3.0-bloco-b`. A B1 está encerrada e aprovada, sem alteração em `main`,
GitHub Pages ou V2.9.
