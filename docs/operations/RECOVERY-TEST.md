# Recuperação v1 — somente TEST

Implementação autorizada em 05/10/2026. PROD, `main`, V2.9, equipe e cartão/QR permanecem nos checkpoints aprovados. Não promover este bloco sem nova autorização expressa.

## Regra comercial e calendário

- Mensal: **R$ 9,90 na primeira mensalidade**, depois **R$ 14,90/mês**. Anual: **R$ 99,90/ano**.
- Oferta individual, uso único por conta, validade **72 horas** a partir da etapa de oferta; não acumula com códigos PRO de cortesia. Não usa `promo_codes` para conceder desconto ou acesso.
- Cartão: aviso no dia 27 (janela até dia 30); benefício termina naturalmente no dia 30; retomada no dia 32 (janela até dia 34); oferta no dia 35; último aviso no dia 37; expiração no dia 38.
- Trial: aviso no dia 5 (janela até dia 7); FREE no dia 7; retomada no dia 9 (janela até dia 11); oferta no dia 12; último aviso no dia 14; expiração no dia 15.
- As janelas contam tempo decorrido a partir do benefício canônico; mensagens exibem datas em Brasília. Etapas vencidas não são reenviadas em bloco. Aviso inicial e retomada têm **um envio por etapa**, não disparos diários.
- Cartão tem precedência sobre trial. Assinatura, cortesia atual/futura, retirada da seleção ou revogação de marketing impedem novas mensagens/ofertas. Opt-in precisa ser verdadeiro e possuir `marketing_accepted_at` válido no momento da seleção e do envio.

## Arquitetura

`recovery_test_accounts` limita a execução a contas TEST escolhidas individualmente pelo OWNER/ADMIN em AAL2. VIEWER consulta, mas não altera a seleção. Nenhuma conta foi selecionada automaticamente nesta implantação.

`recovery_campaigns` guarda uma campanha por conta, origem, início/fim canônico, janela da oferta, estado, intenção única de checkout, contrato do provedor, primeira cobrança e confirmação de preço. `recovery_email_outbox` tem chave única `(campaign_id,stage)`, prazo da etapa, tentativas, lease, resultado e `provider_message_id`. Não guarda saúde, destinatários, nomes ou tokens; o destinatário é resolvido no backend.

O worker `recovery-worker` reutiliza as credenciais, remetente Brevo e regras de classificação de entrega da infraestrutura existente. A fila comercial é separada da fila estritamente transacional aprovada. Consentimento/elegibilidade são revistos ao preparar, reclamar e imediatamente antes do POST Brevo. Revogação e assinatura interrompem a sequência por trigger. O Perfil acessado pelo link `?recovery=1` oferece **Parar mensagens promocionais**, com RPC restrita à própria conta.

O cron `pepday-recovery-test-worker` roda a cada cinco minutos, reclama até cinco mensagens e confere até vinte contratos por execução. Usa `pg_cron`/`pg_net` e token aleatório de uso único, hash no banco e validade de dois minutos. Tanto dispatcher quanto Edges recusam qualquer projeto diferente de `fsbqpyyprtymwrmzsacp`; Edges também exigem `MERCADO_PAGO_LIVE_MODE=false`.

Cada mensagem tem chave Brevo `idempotencyKey` igual ao ID do item. Entrega incerta/timeout não é reenviada automaticamente; lease abandonado termina em `dead/DELIVERY_UNKNOWN`. Falhas explicitamente retornadas pelo provedor seguem a classificação compartilhada de retry. “Enviado” significa aceito com `messageId`, não recebido/lido na caixa do usuário. Não assumir entrega exatamente uma vez em redes externas: conferir logs Brevo antes de qualquer intervenção manual em item incerto.

## Contrato financeiro seguro

O endpoint separado `recovery-checkout` autentica o JWT no Auth e aceita somente mensal. Não recebe preço, usuário elegível ou desconto decidido pelo navegador. `reserve_recovery_offer` confere consentimento, janela, seleção, benefício e cortesia sob lock da assinatura; reutiliza uma intenção por conta. `claim_recovery_checkout` permite um único criador, inclusive com requests concorrentes. POST com resultado desconhecido não cria outro contrato: o worker procura a referência canônica para recuperar o vínculo. Erro sem recurso encontrado exige revisão; não liberar a trava presumindo que o POST falhou.

Referência: `pepday:<subscription_id>:monthly:recovery:<campaign_id>`. Checkout normal continua na Edge anterior e nos preços normais; anual permanece intacto. Um trigger TEST impede resgate de cortesia enquanto a intenção está em andamento ou no primeiro mês beneficiado; a função aprovada de resgate não foi reescrita.

A validade comercial de 72 horas é controlada pelo PepDay e **não** é usada como `auto_recurring.end_date` do contrato. O contrato inicial é mensal aberto em R$ 9,90; após a primeira fatura canônica aprovada, webhook/worker mudam **apenas esse contrato** para R$ 14,90. A manutenção periódica também confere as faturas e recupera webhook perdido pela RPC idempotente `apply_billing_event` existente.

**Achado real do sandbox e correção validada:** três contratos com `end_date` limitado à janela de 72h foram cancelados pelo Mercado Pago sem cobrança. Após separar expiração da oferta e duração da assinatura, o contrato aberto foi autorizado, cobrou R$ 9,90 e foi atualizado para R$ 14,90, com próxima cobrança em 05/11/2026. O contrato canônico validado tem `end_date=null`. Essa arquitetura preserva a oferta de 72h sem encerrar a assinatura nem permitir segunda mensalidade a R$ 9,90, pois o worker confirma o `price_reset_at` após a primeira cobrança. Não reativar contratos cancelados/pausados durante manutenção.

O painel distingue recuperados pós-trial/pós-cartão e receita comprovada da primeira cobrança da oferta. Assinatura a preço normal só é atribuída se houve mensagem aceita pela campanha nos sete dias anteriores; enfileirar/selecionar sozinho não atribui conversão. Essa é atribuição temporal, não prova de causalidade. Receita geral continua indisponível no contrato financeiro antigo; não estimar usando preços de tabela.

## Implantação TEST e IDs não secretos

- Supabase TEST: `fsbqpyyprtymwrmzsacp`; URL pública `https://fsbqpyyprtymwrmzsacp.supabase.co`.
- Publicação frontend TEST LIVE: commit `976148b384107b3fd00026e734b992da1c120d9d`, deploy `dep-db207trncjis73c2kumg`; smoke HTTP PASS do painel/seleção, oferta/opt-out e Service Worker 29. Registro posterior somente documental.
- Render homologação: `srv-date0i6k1f9s73ft9vo0`, workspace `tea-da7iss0u01pc73d6vflg`, branch `v3.0-bloco-b`, auto-deploy por commit. PROD `srv-davto4tg1s2s73brihf0` segue com auto-deploy desligado.
- Migrations locais/remotas aplicadas apenas em TEST:

| Arquivo local | Versão remota TEST |
|---|---|
| `20261005174543_recovery_test_campaign.sql` | `20261005182509` |
| `20261005180118_recovery_test_dispatcher.sql` | `20261005182738` |
| `20261005183709_recovery_config_safe_update.sql` | `20261005183747` |
| `20261005184537_recovery_conversion_attribution.sql` | `20261005185417` |
| `20261005184923_recovery_checkout_creation_guard.sql` | `20261005185422` |
| `20261005190348_recovery_marketing_optout.sql` | `20261005190449` |

Os timestamps remotos foram gerados pelo MCP; não reaplicar migrations antigas porque os nomes locais diferem. A correção `safe_update` acrescenta filtro do singleton exigido pelo PostgREST real.

- Edges TEST atuais: `recovery-worker` v10, `recovery-checkout` v4, `mercado-pago-webhook` v23; `verify_jwt=false` com autenticação explícita própria descrita acima. Auditoria temporária `recovery-contract-audit` foi aposentada em v2 e responde somente HTTP 410 `RETIRED`.
- Variáveis existentes utilizadas: `SUPABASE_URL`, `SUPABASE_SECRET_KEYS`/`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEYS`/`SUPABASE_ANON_KEY`, `BREVO_API_KEY`, `BREVO_TEMPLATE_ACCOUNT_CREATED`, `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_LIVE_MODE`, `MERCADO_PAGO_TEST_PAYER_EMAIL`. Segredos não foram copiados para o Git nem exibidos.
- Vault existente: `pepday_supabase_project_url`. Configuração comercial não secreta em `recovery_config`: `enabled`, `provider_ready`, `template_ids`.
- Templates Brevo exclusivos `PepDay TEST recovery-v1`: warning **12**, ended **13**, resume **14**, offer **15**, last **16**. Nenhum template de produção foi alterado.
- Sondagem de contrato pendente: `640b166fb7a54686b29fc446f608facc`; requisição pg_net **24**: `TEST_SETUP_READY`, R$ 14,90/BRL e limite prorrogado confirmado, contrato cancelado; nenhuma autorização/cobrança. Sondagens anteriores também foram canceladas pelo setup, sem tocar contratos normais.
- Smoke worker pg_net **26**: HTTP 200 `TEST_RECOVERY_COMPLETE`, enviados/falhas/cancelados/ajustes = zero; seleção vazia, zero campanhas e zero e-mails aceitos.

## Verificação e próxima ação

- **PASS automatizado:** regressão atual 424/424; PostgreSQL local/PGlite 38 verificações de duplicidade, locks, consentimento, datas, uso único, cortesia, assinatura durante sequência, atribuição, grants e opt-out isolado. Runner: `scripts/test-recovery-sql-local.mjs`; nenhuma rede ou destinatário real.
- Regressão SQL do painel, sintaxe e build PASS; conferência visual local da seleção recolhida/expandida e atribuição com dados ilustrativos PASS.
- Advisors TEST: nenhum ERROR novo; [RLS sem políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) é intencional nas tabelas privadas acessadas somente pelos RPCs restritos. As RPCs públicas têm autenticação/escopo próprio ou AAL2 administrativo; avisos históricos permanecem documentados.
- **PASS HUMANO / NÃO REPETIR — recuperação ponta a ponta TEST:** entrega/jornadas comerciais já haviam sido comprovadas; em 05/10/2026 a conta dedicada `wpontieri+pepday-recovery-openended-20261005@gmail.com` recebeu a oferta correta, o checkout sandbox aprovou R$ 9,90 por saldo TEST, o PepDay ativou PRO até 05/11/2026 e a campanha foi convertida/suprimida automaticamente. Contrato canônico `e1111a529d954575b28fe1572bd01aca` ficou `authorized`, R$ 14,90/BRL mensal, `next_payment_date=05/11/2026`, `end_date=null`, com somente a fatura inicial `7032632352` de R$ 9,90.
- **PASS de replay / NÃO REPETIR:** worker v10 rodou novamente após a conversão e preservou uma única conversão, uma única mensagem enviada, fila ativa zero e nenhuma segunda cobrança. Não é necessário esperar 05/11 para considerar a configuração da renovação validada; só retestar se billing/checkout/reconciliador sofrer alteração futura.
- **Próxima ação:** bloco de recuperação TEST fechado. Revisar diff/deploy e pedir autorização expressa do proprietário antes de qualquer promoção para PROD. Não enviar clientes PROD sem essa autorização.

Para pausar novas campanhas, definir `recovery_config.enabled=false where singleton is true`. Manter a manutenção financeira do cron enquanto existir contrato de recuperação, pois ela protege o preço normal e a janela de renovação.

Fontes primárias consultadas: [gerenciamento de assinaturas Mercado Pago](https://www.mercadopago.com.br/developers/en/docs/subscriptions/subscription-management), [criação de assinaturas](https://www.mercadopago.com.br/developers/en/reference/online-payments/subscriptions/create-preapproval/post), [templates Brevo](https://developers.brevo.com/reference/create-smtp-template), [idempotência Brevo](https://developers.brevo.com/changelog/2021/11/10) e [agendamento Supabase](https://supabase.com/docs/guides/functions/schedule-functions). O comportamento de `end_date:null` foi observado no sandbox, não presumido da documentação.

Validação subsequente: [RECOVERY-E2E-20261005.md](RECOVERY-E2E-20261005.md). Entrega/jornadas, pagamento R$ 9,90, ativação PRO, troca para R$ 14,90 e replay sem duplicação estão comprovados em TEST. Cache TEST 30; correção do `reason` limitado a 60 caracteres e carga do consentimento de marketing seguem publicadas somente em homologação.
