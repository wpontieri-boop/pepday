# PepDay — Rollout de Recuperação PROD — 05/10/2026

## Escopo aprovado

O proprietário autorizou expressamente a promoção do primeiro bloco de recuperação para produção após o E2E TEST fechar PASS. O rollout preservou `main`/V2.9 e utilizou a branch `v3.0-bloco-b`.

Regra comercial em produção:
- primeiro mês de retomada: R$ 9,90;
- recorrência posterior: R$ 14,90/mês;
- anual permanece R$ 99,90/ano;
- oferta válida por 72 horas no PepDay, sem limitar a duração do contrato Mercado Pago;
- uso único por conta;
- não acumulável com cortesia;
- comunicação promocional somente com consentimento atual de marketing.

## Código e validação prévia

Commit de rollout: `1551de674f5354ac0b717b12b0241fe5afe2e534` — `feat: prepare recovery automation for production`.

Validações antes de PROD:
- `npm test`: 425/425 PASS;
- recovery focado: 20/20 PASS;
- sintaxe das Edges/admin: PASS;
- build público: PASS;
- `git diff --check`: PASS;
- nenhum segredo real foi incluído no diff.
- o runner `scripts/test-recovery-prod-sql-local.mjs` foi adicionado, mas não foi executado nesta máquina; não conta como evidência de PASS.

A proteção de ambiente exige pareamento exato:
- TEST: Supabase `fsbqpyyprtymwrmzsacp` + Mercado Pago sandbox;
- PROD: Supabase `oslefjmwfnddxlotalxu` + Mercado Pago LIVE.

Checkout PROD usa o e-mail autenticado do próprio cliente e `back_url=https://pepday.com.br/app/?recovery=1`.

## Revalidação TEST após generalização

Funções publicadas em TEST:
- `recovery-checkout` v5;
- `recovery-worker` v11;
- `mercado-pago-webhook` v24.

Evidência:
- pg_net 93: HTTP 200 `TEST_SETUP_READY`; probe `eaac2d7825d847979d3b9e69137d9b4c`, cancelado; update R$ 14,90 BRL confirmado;
- pg_net 94: HTTP 200 `TEST_RECOVERY_COMPLETE`; sent/reset/canceled/skipped/failed = 0.

Não repetir esse smoke sem alteração posterior direta nas Edges/regras de ambiente.

## Supabase PROD

Migration remota aplicada: `recovery_production_campaign`.

A migration nasceu com:
- `enabled=false`;
- `provider_ready=false`;
- zero campanhas;
- zero itens de outbox;
- cron `pepday-recovery-prod-worker` a cada 5 minutos.

A elegibilidade PROD é automática e não utiliza a allowlist de homologação. Exige conta comercial não-admin, consentimento atual de marketing, ausência de PRO pago vigente e ausência de cortesia vigente. Cartão tem precedência sobre trial.

Funções PROD publicadas:
- `recovery-checkout` v1;
- `recovery-worker` v1;
- `mercado-pago-webhook` v8.

Setup PROD, ainda com automação desativada:
- pg_net 2: HTTP 200 `PROD_SETUP_READY`;
- Mercado Pago LIVE verificado por leitura da conta, sem criar assinatura/preapproval e sem cobrança;
- `provider_ready=true`;
- templates Brevo PROD: warning 17, ended 18, resume 19, offer 20, last 21.

## Frontend PROD

Serviço Render: `pepday-public`, branch `v3.0-bloco-b`, auto-deploy OFF.

Deploy manual:
- ID `dep-db22iq6i0phs73d2514g`;
- commit exato `1551de674f5354ac0b717b12b0241fe5afe2e534`;
- build/deploy SUCCEEDED.

Smokes HTTP 200:
- `https://pepday.com.br/app/`;
- `https://pepday.com.br/app/?recovery=1`;
- `https://pepday.com.br/admin/`;
- `/app/src/account-ui.mjs`;
- `/admin/admin.mjs`.

O build publicado contém a UI de recuperação PROD e o carregamento de métricas `loadRecoveryProduction`.

## Ativação controlada

Após migration, Edges, setup e frontend verdes:
- `recovery_config.enabled=true`;
- `provider_ready=true`.

Primeiro ciclo manual:
- pg_net 3;
- HTTP 200 `PROD_RECOVERY_COMPLETE`;
- sent=0;
- failed=0;
- skipped=0;
- reset=0;
- canceled=0.

Log da Edge confirmou POST 200 no `recovery-worker` v1. Cron job 2 permanece ativo a cada 5 minutos.

## Fila inicial real

A primeira preparação encontrou uma campanha pós-cartão real, com cinco etapas futuras e zero envio imediato:
- benefício: 05/10/2026 14:42Z → 04/11/2026 14:42Z;
- warning: 01/11 → 04/11;
- ended: 04/11 → 05/11;
- resume: 06/11 → 08/11;
- offer: 09/11 → 11/11;
- last: 11/11 → 12/11;
- expiração comercial da oferta: 12/11/2026 14:42Z.

Na checagem final do rollout:
- sent_total=0;
- due_now=0;
- nenhuma mensagem foi disparada manualmente.

## Advisors e limites

Advisors PROD não apontaram erro novo específico do recovery. Permanecem avisos gerais/históricos, incluindo RLS sem policy em tabelas privadas acessadas por RPCs e avisos de funções SECURITY DEFINER já existentes no projeto. Esses itens devem ser tratados em revisão de segurança separada, sem invalidar o rollout atual.

Não foi criada cobrança LIVE para teste. O PASS financeiro R$9,90 → R$14,90 continua vindo do E2E sandbox já fechado; a primeira prova financeira PROD deve ser uma conversão orgânica de cliente real elegível.

## PASS / NÃO REPETIR

PASS PROD do rollout:
- migration;
- isolamento TEST/PROD;
- Edges;
- setup sem cobrança;
- templates;
- frontend;
- cron;
- primeiro ciclo controlado sem envio;
- fila inicial futura coerente.

NÃO REPETIR:
- pagamento sandbox já aprovado;
- capability probe TEST;
- setup PROD;
- deploy do mesmo commit;
- primeiro ciclo manual, salvo alteração posterior que afete diretamente esses componentes.

## Próxima ação

Acompanhar a primeira mensagem real programada em PROD. Quando houver a primeira conversão orgânica de recuperação, validar uma única vez:
R$ 9,90 aprovado → PRO ativo → campanha convertida/suprimida → contrato recorrente R$ 14,90 → replay sem duplicação.

Não criar cobrança LIVE artificial só para teste.
