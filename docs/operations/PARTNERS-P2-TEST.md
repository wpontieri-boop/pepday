# Parceiros/Afiliados — P2 TEST

Atualização: 08/10/2026. PASS técnico; QA humano da nova jornada pendente. P1 fechado e todos os PASS/NÃO REPETIR preservados.

## Continuidade e escopo

- Oficial: `wpontieri-boop/pepday`, branch `v3.0-bloco-b`. PC `C:/Users/wagne/Documents/PepDay-V3` conferido após fetch: limpo, HEAD=origin **2b297dc241f14a77695c503422bc0e35bebf8649**, 0/0. Trabalho em clone isolado `pepday-p2` do mesmo checkpoint; cópias antigas divergentes não sobrescritas. Docs obrigatórios e operações P1 lidos integralmente.
- TEST Supabase `fsbqpyyprtymwrmzsacp`, `https://homologacao.pepday.com.br/`; Render `srv-date0i6k1f9s73ft9vo0`, workspace `tea-da7iss0u01pc73d6vflg`, auto-deploy ON, branch de desenvolvimento, `npm run build:test`, publicação `preview`.
- TEST anterior: `2b297dc`, deploy `dep-db3dvp8473hc73be8eeg` LIVE, terminado 08/10/2026 00:12:33 UTC (07/10 21:12 Brasília).
- PROD preservado: `8035511ad9a19f431d38b894ac2fcb1ff0881829`, deploy `dep-db23o8uk1f9s73909fn0` LIVE, serviço `srv-davto4tg1s2s73brihf0`, auto-deploy OFF. Main/V2.9/Supabase PROD intocados.
- Somente P2: intenção, continuidade, atribuição atômica, snapshot e indicadores básicos. Sem ingestão financeira, cálculo/liberação/pagamento de comissão, ledger, repasse, mini painel, PWA Admin final ou P3+.

## Implementação

- Capability aleatória de 64 caracteres hexadecimais emitida no servidor, somente SHA-256 no banco, created/expires server-side e validade exata 30 dias. O navegador guarda somente a capability, chave exclusiva TEST, sem ID/prazo/regra confiáveis. Mesma origem/storage permite continuidade por reload, cadastro/login, retorno OAuth e onboarding.
- Link/código válido substitui antes da ativação. Autocomplete só seleciona após clique; escolha manual diferente de indicação explícita exige modal e confirmação no servidor. Cancelamento conserva anterior. Ref inválida não cria intenção, conserva escolha anterior visível e permite optar sem indicação; esta opção limpa o token local mesmo sem rede.
- Grant do cartão + vínculo + snapshot de regra/versão/percentual + consumo na mesma transação. Lock perfil → intenção → parceiro ativo compartilhado; unicidade por conta/grant/intenção, snapshot imutável, prazo revalidado após esperas. Parceiro/status/financeiro coordenados com locks P1.
- Benefício comercial preservado: onboarding incompleto não fecha origem; ADMIN inelegível e PRO pago ativo seguem regras anteriores. Intenção inválida/expirada/substituída/consumida ou parceiro suspenso/arquivado nunca bloqueiam benefício legítimo: ausência é selada. Legadas também selam ausência. Seis grants históricos foram selados `historical_none`, sem origem retroativa/novo grant.
- `/cartao/`: “Você veio por …”, nome/cidade/descrição pública, busca, código, confirmação e sem indicação; oferta de 30 dias intacta. App TEST usa nova RPC e mostra origem efetivamente fechada ou ausência. Ref posterior não muda benefício anterior. Fora do TEST, cliente conserva RPC antiga.
- `/admin/parceiros/`: agregados de cliques, intenções criadas/substituídas/expiradas/consumidas, grants novos com/sem parceiro e ativações por parceiro. Cliques não são conversões nem visitantes únicos. Expiradas são as ainda não consumidas/substituídas; histórico não conta como novo benefício sem parceiro. Nenhuma identidade do cliente ou cálculo financeiro.

## Migrations, RPCs e segurança

| Local CLI | Versão remota TEST | Nome |
|---|---|---|
| `20261008202729_partners_p2_test.sql` | `20261008204601` | `partners_p2_test` |
| `20261008210119_partners_p2_privacy.sql` | `20261008210257` | `partners_p2_privacy` |

Não reaplicar por diferenças de timestamp.

- Tabelas: `partner_referral_intents`, `partner_attributions`, `partner_click_events`, `partner_click_daily`; RLS sem policies, todos os grants diretos revogados inclusive service_role. Todas as FKs indexadas. Trigger impede alteração do vínculo/snapshot, admitindo somente remoção dos identificadores nas FKs de exclusão.
- Gate `partner_config.referral_enabled`: default OFF, independente de P1 já ON. Ainda OFF durante os testes; concessão antiga continua funcionando com ausência selada. Ativar somente após verificações e publicação TEST.
- RPC `partner_referral_action`: somente service_role, via Edge pública intent/inspect/clear; capability autentica intenção existente, body/ref/op limitados, quota compartilhada com busca P1 **120 chamadas/minuto**. CORS sozinho não autoriza. Não aceita partner_id/prazo do cliente.
- Edge nova `partner-referral`: ID `eae07879-ad63-4929-9c2f-b75926f82049`, **v1 ACTIVE**, `index.mjs`, verify_jwt=false para criação pública anterior ao login com autenticação por capability nas operações existentes; TEST URL/origin, POST/OPTIONS, máximo1024bytes, projeção mínima/allowlists, quota SQL. Edge P1 `partner-public` v2 preservada.
- Variáveis existentes: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` ou `SUPABASE_SECRET_KEYS`. Nenhuma env/secret nova, nenhum valor no Git. Sem token bruto/PII/IP/fingerprint/log de payload.
- `claim_partner_card_acquisition(text,timestamptz)`: authenticated + auth.uid. Legada `claim_card_acquisition(timestamptz)` mantém shape comercial. Helpers `claim_card_acquisition_core_p2` e `partner_claim_card` privados, sem EXECUTE dos papéis API. Core comercial preservado verbatim, digest anterior **4b66fcb9c9c68b33883ab10ad95dc03a**, comparado normalizando só o nome. `get_entitlement` intacto, digest **329cdee20d77a221ec365af6a4fb0de6**.
- `admin_partner_referral_metrics()`: authenticated, membership ativa, AAL2, sessão não revogada e provas senha/TOTP até8h P1; OWNER/ADMIN/VIEWER leem agregados, cliente não.
- `export_my_data()`: preserva exportação/auditoria e adiciona só atribuição do auth.uid, origem/data/parceiro público, sem capability/hash/percentual/CPF/PIX/contato privado. Core `export_my_data_core_p2` privado e preservado, digest anterior **185c06d43cb30c0015b731aafaaf4bf6**. Exclusão de fixture real confirmou user_id/card_grant_id nulos, snapshot anônimo preservado.
- Cliques: purga oportunista após30dias em ações/indicadores, agregado diário preservado. Sem cron novo; quando não há atividade, limpeza aguarda próxima operação. Política definitiva de retenção PROD continua fora da fase.
- Cache TEST `pepday-v3-profile-sync-32` inclui módulo público da capability; Auth/API/POST/conteúdo privado e tokens não são cacheados.

## PASS técnicos — 08/10/2026

- `node --test tests/partners-p2.test.mjs`: **18/18**. Storage/capability, troca, falha de rede, sem indicação, resposta de outra aba, onboarding, RPC nova/antiga, erros, limites/privacidade Edge.
- `node --test tests/*.test.mjs`: **464/464**, sem falha/skip. Três leitores de testes SQL antigos normalizam CRLF no PC; três checks acompanham cache32. Migrations antigas/fluxos preservados.
- `scripts/test-partners-p2-sql-local.mjs`: PostgreSQL local PGlite0.5.8 via `PGLITE_MODULE`; núcleo real de cartão/exportação, preservação/backfill, gate, link/código/manual, homônimos, confirmação/cancelamento, expiração/status, snapshot, onboarding/elegibilidade, retry/replay, ausência/legadas, grants/RLS, exportação/isolamento/exclusão e indicadores.
- `scripts/test-partners-p2-real.mjs`: `SUPABASE_DB_URL` protegida fora do Git; suite SQL TEST real com rollback. Cliente/membership inativa/sessão vencida não acessam indicadores; ADMIN/VIEWER válidos recebem só agregados. OWNER usa a mesma guarda de leitura já aprovada, sem novo QA de senha/TOTP.
- Concorrência real **new-new, legacy-new, new-legacy**: duas conexões sobrepostas, `pg_blocking_pids` comprovou lock, segunda ALREADY_GRANTED, 1grant/atribuição, primeira origem/ausência conservada. Gate ON existiu somente na transação A, voltou OFF antes do commit; visitantes nunca viram ON durante testes. Setup isolado precisou commit para visibilidade entre conexões; cleanup verificado zerou todas as fixtures. Runner exige gate OFF: não repetir com módulo ON sem coordenação.
- Depois: **2 parceiros (1ativo/1arquivado), 6grants anteriores, 6historical_none, 0intenções/atribuições de fixtures**. Nenhuma conta humana/parceiro aprovado editado para teste; SQL-only fixtures não fizeram signup/login/envio.
- `scripts/test-partners-p2-ui.mjs`: browser sintético Playwright/Chrome, **390×844/1280×900**, link/reload, homônimos sem atribuição automática, modal cancelar/confirmar, código, inválido, sem indicação e sem overflow. Screenshots revisadas, ignoradas em test-output. Não equivale a E2E Auth/OAuth/PASS humano.
- Build TEST, sintaxe e diff PASS; revisão de segredos/paths antes de commit. Outputs, screenshots, dependências e ambientes fora do Git.
- Advisors após última DDL: **0ERROR/0FK nova sem índice**. INFO RLS sem policies nas4tabelas é isolamento deliberado com grants revogados. WARN SECURITY DEFINER authenticated esperado/revisado por auth.uid/membership. Avisos anteriores de record_pwa_install_event público e leaked-password protection OFF,5FKs históricas sem índice, e INFO índice de expiração ainda sem uso: preservados, fora do P2.
- Referências: [RLS sem policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [RPC authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [FK/índices](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [proteção de senha](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Publicação e QA novo pendente

Nesta versão documental inicial, aguarda publicação/conferência do código TEST. Depois conferir Render LIVE/hashes/rotas, ligar somente referral_enabled TEST e registrar.

QA humano exclusivamente P2, com **conta TEST descartável nova fornecida/criada pelo proprietário**, no mesmo navegador:

1. [Link Parceiro Teste Mac](https://homologacao.pepday.com.br/cartao/?ref=parceiro-teste-mac): conferir origem pública, cadastrar/entrar e concluir onboarding normal.
2. Confirmar30diasPRO; conferir backend dessa conta nova: grant, source link, regra/versão/16%, intenção consumida e vínculo fechado. Sem resultado/credencial presumidos.
3. Nova ref ou sem indicação após ativação mantém vínculo original e não cria segundo benefício.

OAuth/PWA real e limitações de storage dependem do QA novo se usados. Registrar relato/data/ambiente/evidência, nunca senha/token. Não usar contas de PASS nem repetir QA P1/compras/recovery/push/PROD. Próxima ação após publicação: **QA humano P2; P3 só após fechamento/novo pedido**.
