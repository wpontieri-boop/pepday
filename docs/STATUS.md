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

## Pendências

### Bloco B

- B1 encerrada e aprovada; não repetir seus testes sem necessidade causada por
  alteração posterior.
- B2.1 encerrada e aprovada; não repetir smoke, concorrência ou transporte Auth
  sem necessidade causada por alteração posterior nas RPCs ou no schema envolvido.
- B2.2-A e B2.2-C encerrados e aprovados; não repetir a validação real do runner
  sem necessidade causada por alteração posterior no fluxo de sincronização.
- Completar a integração Rotina ↔ Frasco, incluindo os pontos previstos na
  calculadora, sem duplicar frascos ou alterar saldos indevidamente.
- Implementar sincronização local-first, fila offline, reconexão, controle de
  versão/timestamps e tratamento explícito de conflitos.
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

Planejar e submeter à aprovação a fase B2.2-D, dedicada à sincronização remota de
Rotinas e Frascos, versionamento e tratamento explícito de conflitos. Preservar
o repositório local-first, a outbox offline e a sincronização Application/Undo já
aprovados, mantendo as RPCs transacionais da B2.1 como autoridade para aplicação,
movimento, saldo e Undo, sem reprocessar o legado nem alterar FREE/TRIAL/PRO.

## Registro deste checkpoint

O checkpoint documental inicial `9b75ae8a2ece447463863bb32a7b4eac64bdaf1d`,
a implementação B1 e seu hardening foram enviados somente para
`origin/v3.0-bloco-b`. A B1 está encerrada e aprovada, sem alteração em `main`,
GitHub Pages ou V2.9.
