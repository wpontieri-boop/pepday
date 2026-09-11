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

## Fase B1 implementada localmente — aguardando revisão

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

## Pendências

### Bloco B

- Revisar a Fase B1 e, somente após autorização, aplicar a migration incremental
  no Supabase de testes e validar o delta no ambiente isolado.
- Completar a integração Rotina ↔ Frasco, incluindo os pontos previstos na
  calculadora, sem duplicar frascos ou alterar saldos indevidamente.
- Implementar aplicações, movimentos de estoque e undo de forma transacional,
  atômica e idempotente.
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

Revisar o commit local separado de hardening da Fase B1. Após aprovação explícita e em etapa separada,
fazer push da B1, aplicar somente a migration incremental no Supabase de testes e
validar o delta no ambiente isolado. Não publicar, aplicar SQL remoto ou avançar
para sincronização antes dessa autorização.

## Registro deste checkpoint

O checkpoint documental `9b75ae8a2ece447463863bb32a7b4eac64bdaf1d` foi
enviado somente para `origin/v3.0-bloco-b`. A implementação B1 posterior permanece
local, sem push, sem publicação e sem alteração em `main`, GitHub Pages ou V2.9.
