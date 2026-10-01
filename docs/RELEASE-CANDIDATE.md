# PepDay V3.0 — Matriz de Release Candidate

Atualização: 30/09/2026.

Estados:
- **PASS** — validado por teste automatizado, SQL real, smoke ou teste humano já aprovado.
- **PASS TÉCNICO / MOBILE PENDENTE** — implementação validada; falta conferência física final em celular/PWA.
- **PASS TÉCNICO / SMOKE REAL PENDENTE** — implementação e testes automatizados validados; operação externa destrutiva não foi disparada para preservar o estado de teste.
- **BLOQUEADO POR CONFIGURAÇÃO** — arquitetura pronta; falta configuração externa de homologação.
- **NÃO EXECUTAR** — depende de autorização final para produção.

A V2.9 permanece em produção.

## Checklist obrigatório

| Item | Estado | Evidência / observação |
|---|---|---|
| HTML/CSS/JS | PASS | syntax checks, smoke HTTP e suíte completa |
| PWA | PASS | manifest/SW/assets + QA físico Android aprovados |
| manifest | PASS | suíte release candidate static |
| service worker | PASS | cache isolado V3 e Auth fora do cache |
| mobile | PASS | viewport/media queries + QA físico Android aprovados |
| desktop | PASS | smoke local/público e layout homologado |
| calculadora | PASS | fórmula e interface cobertas |
| 30/50/100 UI | PASS | opções U-100 + cálculo exemplo |
| mg/mcg | PASS | conversão e cálculo |
| 5on2off | PASS | ciclo 5 ON / 2 OFF validado |
| Rotina ↔ Frasco | PASS | testes de fluxo/repositório/versionamento |
| criar Frasco dentro da Rotina | PASS | draft salvo antes de navegar |
| retornar sem perder campos | PASS | testes de draft/fluxo |
| aplicações | PASS | RPC/transporte/outbox/testes reais anteriores |
| undo | PASS | testes transacionais e sincronização |
| saldo | PASS | movimentos/versionamento/ajuste |
| forecast | PASS | calendário, saldo e previsão |
| reposição | PASS | forecast, refillAt e preferência |
| login | PASS | validado no Bloco A |
| logout | PASS | validado no Bloco A |
| trial | PASS | B1 e backend clock |
| trial único | PASS | serialização/idempotência |
| FREE | PASS | calculadora/tutorial e gates |
| PRO | PASS | entitlement/gates/backend |
| códigos promocionais PRO | PASS | 30/60/90 dias, limite/validade/exclusividade, resgate único, RLS/RPC admin no TEST |
| admin | PASS | métricas agregadas + gestão controlada de códigos promocionais |
| migração V2.9 | PASS | snapshot/backup/importação e teste humano |
| sincronização | PASS | outbox/hydration/conflitos |
| offline/online | PASS | sync engine e reconexão |
| RLS | PASS | migrations/advisors/testes reais |
| isolamento entre usuários | PASS | RLS/testes reais anteriores |
| pagamento de teste | PASS | sandbox validado com pagamento mensal aprovado |
| webhooks de pagamento | PASS | eventos automáticos do Mercado Pago recebidos e aplicados no TEST |
| cancelamento de assinatura | PASS TÉCNICO / SMOKE REAL PENDENTE | cancelamento sandbox/webhook anterior PASS; novo botão de cancelamento normal + Edge Function v1 ACTIVE; OPTIONS 200 e confirmação inválida 400; clique real preservado para não cancelar a assinatura TEST ativa |
| expiração de assinatura | PASS | state machine e períodos de entitlement validados no TEST |
| reativação | PASS | fluxo de reativação e ordenação de eventos validados |
| e-mails transacionais | PASS | Brevo configurado; 11 templates; worker real enviou evento e persistiu message id |
| push | PASS | Firebase TEST configurado; cron seguro + dispatcher interno ativos; 4 smokes reais em `sent` com `provider_message_id`; quarto smoke exibido fisicamente no Mac com o PepDay fechado após habilitar notificações do Chrome no macOS |
| cache/update | PASS | cache profile-sync-19; vínculo de push reidratado e atualização jurídica empresarial forçada por nova versão |
| exportação de dados | PASS | RPC real com rollback + UI |
| exclusão de conta | PASS | `account-delete` v20 corrige OPTIONS/CORS; reteste Android destrutivo com conta descartável retornou OPTIONS 200 + POST 200, encerrou a sessão e deixou zero registros da conta no Auth e nas tabelas vinculadas conferidas |
| Termos/Privacidade | PASS TÉCNICO | versões `terms-2026-09-30-2` / `privacy-2026-09-30-2`; consentimento sensível separado/versionado; bases legais, CDC/assinatura, transferências e incidentes cobertos; fornecedor/controlador identificado como Wagner Pontieri Junior / WP Imports, CNPJ 21.756.593/0001-90 |

## Testes atuais

- Regressão completa: **362/362 PASS**
- Códigos promocionais: **6/6 PASS**
- Release candidate static: **11/11 PASS**
- Bloco D jurídico/direitos/local: **37/37 PASS**
- FCM/UX push: **19/19 PASS**
- Brevo: **10/10 PASS**

## Pendências externas

### Pagamentos

Sandbox Mercado Pago, planos, retorno de homologação e webhooks foram configurados e validados no TEST. Pagamento aprovado, cancelamento automático por webhook e tratamento de eventos fora de ordem foram testados; produção permanece intocada.

### E-mails

Brevo configurado no TEST: API key, remetente ativo, 11 templates transacionais e worker implantado. Smoke real processou 1 evento, recebeu aceite do provedor e persistiu `provider_message_id`. Retry/backoff permanece coberto pela suíte automatizada; antes de produção, revisar remetente/domínio definitivo.

### Push

O Firebase TEST e o cliente Web Push estão configurados. O navegador de teste confirmou “Notificações ativadas neste aparelho”. O Supabase TEST executa o push por cron seguro (`pg_cron` + `pg_net`) usando token efêmero de uso único e a Edge Function interna `fcm-push-cron-dispatcher`, que chama o worker FCM já protegido por segredo backend-only. Quatro smokes operacionais reais chegaram a `sent`, todos com `provider_message_id`. No quarto smoke, com o PepDay fechado e as notificações do Google Chrome habilitadas no macOS, o banner **PepDay — “Há um aviso operacional no PepDay.”** foi exibido fisicamente no Mac. Push encerrado como **PASS final**.

### Mobile / PWA

QA físico Android: **PASS final**.

Validado em aparelho real:
1. abertura da homologação;
2. Home / Calculadora / Perfil;
3. seringas 30 / 50 / 100 UI;
4. mg / mcg;
5. tutorial completo;
6. instalação e reinstalação do PWA;
7. fechamento e reabertura pelo ícone;
8. funcionamento offline da parte local;
9. retorno online e sincronização;
10. Termos / Privacidade;
11. exportação JSON em conta autenticada;
12. seringa sem corte horizontal;
13. persistência do vínculo de push após reload;
14. UX **“Alterar preferências”**;
15. push físico recebido com o PepDay fechado;
16. exclusão destrutiva de conta descartável com confirmação no backend.

## Segurança final

A revisão do repositório não encontrou `.env`, PEM, arquivos de credenciais/service-account ou bloco real de chave privada versionado. A Firebase Web API key do projeto TEST foi restringida no Google Cloud ao domínio de homologação e às APIs Firebase/FCM necessárias; um push real no Android com o PWA fechado foi validado depois da mudança. O alerta #1 do GitHub Secret Scanning (`google_api_key`) foi encerrado como `wont_fix`, com justificativa de chave pública intencional e restrita. **Segurança técnica: PASS.**

## Jurídico

O hardening jurídico funcional foi concluído em TEST: consentimento específico e destacado para dados sensíveis separado da ciência da Política, registro de versão/data, bases legais sensíveis refinadas, transparência sobre assinaturas recorrentes e direito de arrependimento, transferência internacional, finalidade não médica e procedimento interno de incidentes. A implementação foi revisada tecnicamente e coberta pela regressão.

A identificação jurídica do fornecedor/controlador foi preenchida com os dados empresariais aprovados de Wagner Pontieri Junior / WP Imports, CNPJ 21.756.593/0001-90, endereço empresarial e e-mail de contato. O bloqueio jurídico de identificação está encerrado. A adequação de CNAE/atividade econômica para software/serviço digital será confirmada com a contadora antes da cobrança em produção e permanece como pendência fiscal/contábil. Parecer externo de advogado continua recomendável, mas não foi obtido nesta etapa.

## Critério para RC final

A promoção para produção exige:
1. homologação externa de pagamentos — PASS em TEST;
2. homologação real de e-mail — PASS em TEST;
3. homologação real de push — PASS em TEST;
4. teste físico mobile/PWA — PASS;
5. teste destrutivo de exclusão com conta descartável — PASS;
6. hardening jurídico funcional + identificação do fornecedor/controlador — PASS TÉCNICO;
7. regressão completa verde — PASS 362/362;
8. revisão de segredos/arquivos — PASS; Firebase Web API key restrita e alerta #1 do GitHub resolvido;
9. adequação fiscal/contábil de CNAE/atividade para cobrança do PepDay — PENDENTE confirmação com a contadora;
10. conferência humana do novo reaceite jurídico/gestão de assinatura — PENDENTE após deploy da homologação;
11. release candidate final — aguarda itens 9 e 10;
12. aprovação expressa do proprietário — somente após RC final.

## Produção

**NÃO EXECUTAR automaticamente.**

Não alterar V2.9, main ou GitHub Pages até autorização expressa.
