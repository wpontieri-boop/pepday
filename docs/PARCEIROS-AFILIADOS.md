# PepDay — Parceiros / Afiliados v1

Especificação aprovada em06/10/2026; estado operacional atualizado em08/10/2026: **P1/P2 fechados com PASS humano em TEST e LIVE em PROD após autorização expressa**, gatesON. Edição parcial/step-up, permissões e pós-lock jáPASS em homologação; não repetir. Próxima validação curta de ambiente PROD e evidências em [CURRENT-STATE.md](CURRENT-STATE.md) e [PARTNERS-P1-P2-PROD.md](operations/PARTNERS-P1-P2-PROD.md). P3/P4/P5 permanecem planejados, fora da implementação/publicação desta tarefa. As regras comerciais abaixo não foram ampliadas no rollout.

## Base e decisões

Fonte: AGENTS.md, CURRENT-STATE.md, URL-MAP.md e conceito comercial aprovado em 05/10/2026. Base sincronizada no PC: `6513a5571af16d2c39da283a5186e21417502d5d`, branch `v3.0-bloco-b`.

Em 06/10/2026, o proprietário respondeu **“Adotar esses padrões”** para: indicação válida por 30 dias até ativar o cartão; link/código explícito prevalece sobre indicação anterior ainda não ativada; vínculo definitivo na ativação; liberação da comissão 30 dias após o primeiro pagamento confirmado; repasse manual pelo OWNER; percentual obrigatório por parceiro, sem valor presumido. As demais definições abaixo são escolhas técnicas desta especificação, não novos PASS humanos.

O benefício permanece 30 dias PRO, único por conta, sem cartão de pagamento, sem cobrança automática e sem desconto adicional por indicação. Preservar as regras de trial, PRO pago e recuperação existentes. Recorrência especial de comissão (3/6/12 meses) fica para uma versão posterior; v1 remunera exclusivamente o primeiro pagamento aprovado.

## Rotas e experiência

| Área | Rota canônica planejada | Comportamento |
|---|---|---|
| Administração | `/admin/` | Atalho Parceiros & Afiliados e instalação PepDay Admin |
| Módulo interno | `/admin/parceiros/` | Lista, cadastro, ficha, métricas, extrato e financeiro conforme papel |
| Cartão genérico | `/cartao/` | Busca pública de parceiro; opção “Não fui indicado / não encontrei” |
| Link individual | `/cartao/?ref=<slug>` | Resolve parceiro e mostra identificação pública antes de continuar |
| Código falado | Campo de código em `/cartao/` | Resolve o mesmo partner_id, independentemente do nome |
| Mini painel | `/parceiro/` | Fase posterior, sessão própria e somente dados do parceiro autenticado |

Em TEST, usar exclusivamente o domínio de homologação. Hoje o admin TEST é servido em `/site/admin/`; manter esse caminho funcionando e criar aliases canônicos `/admin/` e `/admin/parceiros/` no empacotamento TEST. Não anunciar rota planejada como já publicada. Produção continua usando seu build dedicado; nenhuma promoção nesta etapa.

Cadastro em campo permite rascunho com nome público, tipo, cidade/descrição e contato. Gerar slug, código e link automaticamente já ao salvar o cadastro; enquanto rascunho, mostrar que o link ainda não atribui clientes. A ativação exige identificação legal completa, percentual explicitamente definido e perfil de pagamento validado pelo OWNER. Salvar rascunho não dispara convite ou mensagem. Ao ativar, habilitar Copiar link e Compartilhar (compartilhamento nativo quando disponível; fallback de cópia).

Homônimos são permitidos. Slug e código são únicos por restrição no banco; normalizar acentos/caixa e resolver colisão atomicamente com sufixo opaco/numérico. Não incorporar CPF, telefone ou e-mail. Slug/código permanecem estáveis após renomear o parceiro e não são reutilizados após arquivamento.

Busca pública expõe somente nome, cidade, tipo e descrição/@ público; resultados limitados, busca com mínimo de caracteres e rate limit no servidor. Somente parceiros ativos. Referência inválida, expirada ou parceiro suspenso não bloqueia o benefício: orientar busca ou continuar sem indicação. Não atribuir silenciosamente a outro parceiro.

## Refinamentos P1 aprovados em 06/10/2026

- Cadastro operacional: nome público, tipo, cidade, descrição/@, telefone/WhatsApp, e-mail e contato comercial. ADMIN salva rascunho; OWNER completa financeiro e ativa. Sem convite automático.
- Financeiro obrigatório, marcado com `*`: nome/razão social, CPF/CNPJ, titular, tipo e chave PIX, percentual individual e motivo. CPF/CNPJ usa comprimento e dígitos verificadores (inclui CNPJ alfanumérico); PIX validado pelo tipo. Documento identifica o parceiro e não precisa coincidir com a chave PIX. Erros curtos por campo, inclusive documento já cadastrado.
- Ajuda por clique/teclado/toque em CPF/CNPJ, tipo PIX, percentual, motivo e ativação. Motivos: **Configuração inicial:** primeiro cadastro financeiro do parceiro; **Ajuste contratual:** mudança acordada de comissão ou condição comercial; **Correção de pagamento:** correção de PIX, titular ou dado financeiro cadastrado incorretamente.
- OWNER usa o login senha+TOTP válido para salvar o financeiro inicial e ativar no mesmo fluxo. Rascunho que nunca foi ativo não exige reautenticação a cada configuração. `first_activated_at`, verificado sob lock no servidor e preservado ao suspender, impede voltar ao fluxo inicial para contornar step-up. Após primeira ativação, edição financeira exige ticket existente de cinco minutos/uso único/sessão/alvo/payload, mesmo quando suspenso.
- P1 agora limita acesso às próprias RPCs a oito horas desde a criação da sessão Auth e exige provas assinadas password+totp dentro da janela, membership atual, AAL2, fator verificado, sessão existente e `not_after` válido. Refresh, reload ou novo TOTP isolado não estendem a janela; nenhuma autorização por user_metadata/localStorage/relógio cliente. Expiração pede login normal, nunca novo bootstrap MFA. Aplicação global a outros caminhos administrativos e Admin PWA permanece P4.
- Botões consistentes no painel e retorno, badges Rascunho/Ativo/Suspenso/Arquivado, ambiente resolvido sem mensagem transitória persistente. A ativação habilita link/código na busca P1; atribuição persistida continua P2.
- Edição financeira parcial (refinamento 06/10/2026): parceiro configurado abre com razão social, tipo PIX, percentual e máscaras de CPF/CNPJ/PIX/titular. Não exigir reinformar dados para mudar somente percentual+motivo. Ações explícitas Alterar habilitam novos valores; Cancelar mantém o existente. Backend recebe patch, preserva campos omitidos internamente sob lock e não retorna CPF/PIX integrais. Mascarados não editados não são validados como vazios. Atualização pós-primeira ativação continua exigindo step-up para qualquer campo financeiro.
- Ativo mostra somente Salvar alteração financeira e ajuda/status Parceiro ativo. Arquivados ficam ocultos por padrão na consulta backend e interface, com controle Mostrar/Ocultar arquivados; ativos, rascunhos e suspensos precedem o histórico. Arquivar nunca apaga cadastro nem auditoria/fixtures técnicas.
- Repasses e exportações sensíveis continuam planejados, sempre com step-up; equipe não foi alterada por este refinamento. Não declarar proteção global P4 implementada.

## Atribuição determinística

1. Link/código validado no servidor cria intenção com identificação opaca e horário do servidor. Validade: 30 dias corridos; horário enviado pelo navegador não estende a janela. A intenção deve sobreviver ao login/onboarding no mesmo dispositivo, sem depender de parâmetros perdidos no redirect.
2. Antes da ativação, um novo link/código explicitamente usado substitui a intenção anterior. Sem referência nova, a seleção manual cria a intenção. Uma seleção manual diferente da referência explícita exige confirmação visível de troca; não substituir por autocomplete acidental.
3. Não transportar atribuição entre dispositivos por suposição; a pessoa pode usar novamente o link/código no dispositivo escolhido. Clique sozinho é métrica direcional, não prova de indicação nem conversão.
4. Na primeira concessão efetiva do cartão, validar intenção, parceiro ativo e elegibilidade no backend. Gravar benefício e vínculo na mesma transação sob lock por usuário. Se houver falha transacional, rollback; ref ausente/inválido permite concessão sem parceiro.
5. Uma conta e um benefício possuem no máximo um vínculo. Após concessão, vínculo (inclusive ausência de parceiro) fica definitivo; nova referência, reinstalação, troca de plano ou retry não altera. Não atribuir benefícios históricos retroativamente. Registro de aquisição pré-onboarding não deve congelar prematuramente o parceiro.
6. Primeiro pagamento posterior à ativação converte o vínculo. Não há nova janela de 30 dias depois da ativação: ela limita a intenção anterior ao benefício. Atribuição de parceiro e atribuição de recuperação coexistem como dimensões da mesma cobrança; receita total é deduplicada pela cobrança canônica.
7. Conta que já tinha pagamento aprovado antes do benefício não gera comissão v1: o primeiro pagamento da conta já ocorreu. Benefício continua seguindo sua elegibilidade existente. Sem comprovação do histórico, comissão vai para revisão, nunca é liberada por presunção.
8. Suspensão do parceiro impede novos vínculos e repasses; preserva atribuições/extrato existentes e envia comissões afetadas para revisão. Arquivar não apaga evidências nem transfere origem.

## Comissão e repasse

- `commission_percent` obrigatório para ativação, de 0 a 100 com até duas casas; 0 só quando explicitamente configurado. Não inventar percentual padrão. Armazenar regra versionada e congelar percentual no vínculo da ativação; alterações posteriores valem para novos vínculos.
- Base: valor bruto efetivamente aprovado, em BRL, da primeira cobrança canônica elegível da conta (mensal, anual ou recuperação). Não usar preço de tabela, preapproval autorizado, cadastro, trial, cartão grátis ou callback do navegador. Não subtrair taxas do provedor na v1.
- Cálculo: base em centavos × percentual, com arredondamento monetário half-up para centavo; backend decimal/integer, sem ponto flutuante para o saldo. Plano e moeda vêm do recurso canônico. Moeda diferente ou valor ausente = revisão, sem estimativa.
- Estado normal: `pending → released → paid`. `release_at = paid_at + 30 dias corridos`, horário canônico/servidor UTC, apresentado em Brasília. Liberar apenas após reconciliar reembolsos/disputas e sem bloqueio. Indisponibilidade do provedor mantém pendente/revisão.
- `review` bloqueia liberação/repasse até decisão documentada pelo OWNER; `voided` anula antes do repasse; `reversed` registra reversão após repasse. Motivo obrigatório para bloqueio, revisão, anulação e reversão.
- Estorno total zera comissão; parcial recalcula a comissão sobre o valor efetivamente retido, usando o mesmo percentual/rounding. Registrar somente a diferença cumulativa, deduplicando cada evento. Reembolso da primeira cobrança não torna a renovação elegível a nova comissão v1.
- Repasse manual pelo OWNER, sem transferência bancária automática. Criar lote somente com itens liberados, saldo positivo, sem revisão e perfil de pagamento válido. Reservar itens sob lock; falha/cancelamento libera a reserva sem marcar pago. Confirmar pagamento exige referência/comprovante privado, data e valor. Não aceitar comprovante público nem registrar seu conteúdo em logs.
- Snapshot privado do destinatário e versão dos dados PIX no lote. Alteração posterior não muda lote reservado: cancelar e recriar se necessário. Nunca permitir dois lotes para o mesmo saldo nem duplo clique/replay marcar pagamento duas vezes.
- Estorno depois de repasse gera ajuste/debito auditado e bloqueia novo repasse até conciliação pelo OWNER; não apagar pagamento histórico nem efetuar débito bancário automático.
- Não há mínimo de repasse ou calendário automático nesta v1. OWNER escolhe o lote de saldo liberado. Renovações são receita atribuída ao parceiro para métricas, mas não criam comissão adicional.

## Permissões

Todos os controles abaixo são verificados no backend, além de ocultar ações na interface. Reutilizar memberships ativas e `admin_assert_access`; não criar outro papel administrativo.

| Operação | OWNER | ADMIN | VIEWER | Parceiro futuro |
|---|---|---|---|---|
| Métricas/extrato sem dados de clientes | Sim | Sim | Sim | Somente próprio |
| Criar/editar cadastro público e contato comercial | Sim | Sim | Não | Não |
| Consultar identidade legal necessária à operação | Sim | Sim, mascarada por padrão | Não | Própria, mascarada |
| Ativar/suspender parceiro | Sim | Sim, com regra financeira já aprovada | Não | Não |
| Definir/mudar percentual e dados de pagamento | Sim; sessão válida no rascunho inicial, step-up após primeira ativação | Não | Não | Solicitar revisão futura |
| Liberar revisão, ajustes e confirmar repasse | Sim + step-up | Não | Não | Não |
| Exportar dados pessoais/financeiros | Sim + step-up | Não | Não | Não na v1 |
| Gerir equipe e acesso do parceiro | Sim + step-up | Não | Não | Não |

ADMIN não vê formulário nem controles financeiros editáveis, apenas resumo como “Aguardando aprovação do OWNER”. VIEWER permanece somente leitura. ADMIN pode cadastrar o parceiro em campo e entregar link após ativação quando OWNER tiver aprovado a configuração financeira. Valores completos de CPF/PIX ficam fora da busca, métricas agregadas e respostas VIEWER. Não liberar permissões mediante `user_metadata` editável ou `partner_id` recebido do cliente.

## Sessão e Admin PWA

- PepDay Admin: manifest/id/ícones próprios, `start_url=/admin/`, scope `/admin/`; service worker limitado a esse escopo. Login e armazenamento Auth administrativos por ambiente já separados do app cliente; `/parceiro/` terá armazenamento próprio.
- Sessão operacional máxima de 8 horas desde senha + TOTP confirmado, sem extensão por atividade, reload ou refresh de token. Revogação/logout/inativação encerram autorização imediatamente no backend; AAL2 sozinho não prova sessão recente.
- No plano Free atual, não depender de timeout nativo global disponível apenas em planos pagos. Criar autorização administrativa no backend vinculada ao `session_id` validado, usuário, ambiente, expiração e revogação. Verificar sessão Auth ainda existente e membership atual em cada RPC administrativa; não alterar duração das sessões do app cliente.
- Step-up: senha + novo desafio TOTP validado, evidência do servidor válida por até 5 minutos e autorização de ação sensível de uso único vinculada à sessão/operação/alvo. Relógio/localStorage do navegador não comprova reautenticação. Falha de step-up não salva a mudança.
- Aplicar controle de sessão a todos os caminhos administrativos e aliases; evitar contorno por RPC antiga. Preservar requisito AAL2 e proteção do último OWNER. Nova duração/step-up exige testes focados, sem repetir bootstrap já PASS.
- Cache apenas shell estático. Não guardar respostas privadas, PIX, CPF, extratos, tokens ou comprovantes no service worker/Cache API/IndexedDB; não enfileirar escritas offline. Offline mostra indisponibilidade segura. No TEST, revisar SW raiz do app para não devolver Home/offline do cliente nas rotas administrativas ou do parceiro.

Referências técnicas verificadas em 06/10/2026: [sessões Supabase](https://supabase.com/docs/guides/auth/sessions) e [MFA](https://supabase.com/docs/guides/auth/auth-mfa). A implementação deverá validar documentação/changelog atual e a evidência de desafio no servidor antes de codificar o step-up; não tratar JWT renovado como novo login.

## Modelo de dados proposto

Nomes abaixo são planejamento; não existem por esta especificação. Criar migrations novas pela CLI, preservando as históricas.

| Entidade | Dados/restrições essenciais |
|---|---|
| `partners` | UUID, nome público, tipo, cidade/descrição, slug/código únicos imutáveis, status draft/active/suspended/archived, timestamps/ator |
| `partner_private_profiles` | Nome legal, CPF/CNPJ normalizado validado, contato, PIX/titular, versão/verificação; documento legal único para evitar cadastros duplicados; sem dados em fixtures versionadas |
| `partner_commission_rules` | Partner, percentual decimal, modo first_payment, versão, vigência/ator; imutável após uso |
| `partner_referral_intents` | Token opaco armazenado por hash, parceiro, origem link/code/manual, created/expires server-side, consumed_at; resolução não expõe PII |
| `partner_attributions` | user_id único, card_grant_id único, partner/rule/version/percentual, fonte e horário locked_at; ausência de parceiro selada na concessão |
| `partner_click_events` | Event ID deduplicável, parceiro, horário, canal; sem IP bruto, fingerprint, e-mail ou dados de saúde; retenção técnica inicial de 30 dias com agregado diário |
| `partner_financial_payments` | Provedor + ID canônico único, conta/assinatura/atribuição, plano, moeda, centavos, paid_at, estado e reembolso acumulado; ingestão de mensal/anual/recovery/reconciliação |
| `partner_commissions` | Uma comissão v1 por conta/atribuição e primeira cobrança elegível; valor/percentual snapshot, estado, release_at, motivo e versão |
| `partner_ledger_entries` | Lançamentos append-only de geração/liberação/reserva/repasse/estorno, idempotency_key única, referência do evento e ator |
| `partner_payouts` e itens | Lote, valor, destinatário snapshot privado, estado, referência privada, confirmação; itens impedem reserva/pagamento concorrentes |
| `admin_operational_sessions` | Sessão Auth, usuário, início, expiração, revogação; provas recentes/autorizações de ação sem armazenar senha/TOTP/token bruto |
| `partner_portal_memberships` | Fase posterior: vínculo administrado entre Auth user e partner; sem associação automática apenas por e-mail público |

RLS nas tabelas novas; sem grants diretos a anon/authenticated para dados internos. RPCs administrativas controladas, funções internas restritas, search_path fixo e EXECUTE explícito. Busca pública retorna projeção mínima e registro de clique tem limites. Mini painel usa auth.uid + membership própria, nunca parâmetro de parceiro como autorização. Indexar FKs/consultas e auditar advisors em TEST.

Integrar concessão ao código existente de `claim_card_acquisition` e `card_pro_grants` sem reduzir elegibilidade ou mudar resposta dos consumidores atuais. Nova RPC/wrapper deve fazer concessão + vínculo atomicamente e preservar chamada legada sem indicação. Chamadas legadas também selam ausência de parceiro ao conceder, impedindo atribuição posterior.

Financeiro exige persistir valores/moeda canônicos também das assinaturas normais: atualmente a receita geral não é uma fonte suficiente. Consumir eventos financeiros confirmados do webhook e reconciliador, sem criar segunda aplicação de entitlement. Chave financeira de recurso (não ID de entrega webhook) impede duplicação entre caminhos. Ordem dos eventos, reembolsos e seleção da primeira cobrança por paid_at/ID precisam ser conciliados antes de liberar; cobrança anterior descoberta tardiamente bloqueia/reverte comissão incorreta, nunca gera segunda comissão.

Antifraude: comparar cliente à membership/identidade verificada do parceiro usando somente dados realmente disponíveis; autoindicação confirmada bloqueia comissão, sem retirar benefício legítimo do cliente. Indícios de abuso vão a review com motivo, evidência mínima e OWNER responsável; clique repetido/IP ou compartilhamento de dispositivo não bastam como prova. Ausência de identificador para cruzar não significa PASS antifraude.

Auditoria registra ator, alvo, ação, data, valores financeiros/regra e motivo; CPF/PIX só mascarados, nunca senha/token/TOTP nem dados de saúde. Retenção financeira/identidade será configurada com justificativa fiscal/contratual antes de PROD; não inventar prazo legal. Revisar exportação/exclusão de conta para desvincular dados pessoais conforme política e preservar somente evidências financeiras necessárias, sem cascade apagar o extrato.

## Métricas

Separar cliques direcionais, benefícios ativados, primeiro uso (evento existente), primeiras conversões mensal/anual, pagamentos/renovações atribuídos, receita bruta confirmada, reembolsos, receita retida e comissão pendente/em revisão/liberada/paga/revertida. Coortes usam mesmas contas; sem denominador = “—”. Não somar receita de recuperação e parceiro como vendas diferentes. Portal futuro mostra agregados e extrato do próprio parceiro, sem identidade do cliente, CPF/PIX de terceiros ou rotinas.

## Estado das fases — 08/10/2026

P1 fechado e homologado, conforme CURRENT-STATE. P2 implementado tecnicamente somente TEST (intenção, continuidade, concessão/vínculo atômicos, snapshot, métricas e privacidade), com QA humano novo pendente. Evidências/limites em [PARTNERS-P2-TEST.md](operations/PARTNERS-P2-TEST.md). P3–P5 ainda não implementados; produção não autorizada. A sequência abaixo é o plano original; não repetir P1 ou PASS anteriores.

## Sequência de implementação TEST

1. **P1 — próximo passo:** modelo/migrations, RPCs de cadastro/permissões, configuração financeira OWNER, slug/código, busca pública e módulo `/admin/parceiros/` com aliases TEST. Aplicar desde P1 o step-up após primeira ativação conforme o refinamento acima; enquanto ele não estiver verificado, essas ações ficam indisponíveis, sem fallback AAL2 apenas. Feature gate TEST desativado por padrão; sem comissão, cobrança, envio ou repasse real. Testar P1 antes de ativar em homologação.
2. **P2:** intenção, continuidade login/onboarding, vínculo atômico na concessão, lock/replay/concorrência e métricas. QA humano somente da nova escolha/link em conta descartável; não usar contas dos PASS para simular datas ou novo resgate.
3. **P3:** ingestão financeira canônica de todos os planos, cálculo/ledger/reembolso/review/repasse manual com fixtures sintéticas isoladas e testes SQL com rollback. Nenhuma transferência/pagamento real para validar cálculo. Se integração financeira mudar, smoke específico do trecho alterado, preservando PASS históricos.
4. **P4:** Admin PWA, sessão 8h e step-up em todos os caminhos admin; QA humano focado na instalação Admin e desafio novo. Não refazer cadastro de senha/TOTP do OWNER.
5. **P5 posterior:** mini painel `/parceiro/`, acesso explicitamente vinculado pelo OWNER, testes de isolamento parceiro A/B e UI própria. Não cadastrar parceiros como admins. Sem convite automático nesta especificação.

## Critérios de aceite

- Homônimos/slug concorrente; validação legal/percentual; nenhum dado privado na busca pública; papel inativo/AAL1/VIEWER impedidos de escrita e ADMIN impedido de financeiro.
- Intenção expirada (limite 30d pelo servidor), refs sucessivas, troca explícita, onboarding, ref inválida, parceiro suspenso, ausência de ref, duas ativações concorrentes, retry e conta com benefício anterior.
- Primeiro pagamento mensal/anual/recovery, anterior ao benefício, renovação, valor ausente, outra moeda, replay webhook/reconciliador, eventos fora de ordem, arredondamento, alteração de percentual, reembolso total/parcial antes/depois do repasse e lote concorrente.
- Sessão expirada mesmo com JWT válido, revogação, membership inativa, step-up vencido/reusado/alvo diferente, aliases/RPCs antigas, logout e isolamento cliente/Admin/portal/TEST/PROD.
- Admin mobile sem overflow; PWA próprio e retorno correto; offline não revela dados/cache nem aceita escrita financeira. Portal futuro não acessa outro parceiro.
- Sintaxe/build e regressão automatizada completa após código; SQL local e TEST com fixtures descartáveis/rollback; advisors/segredos/diff; conferir migrations/deploy e registrar evidência real antes de escrever PASS.

Especificação documental não exige repetir suite ou QA humano de produto. Esta etapa não cria novo PASS de implementação. Após cada fase: atualizar CURRENT-STATE com evidência, commit/push/fetch e divergência 0/0. Homologação tem auto-deploy ON; registrar o deploy resultante. PROD tem auto-deploy OFF e exige nova autorização específica; main/V2.9 preservados.
