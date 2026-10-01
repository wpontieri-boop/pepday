# PepDay V3.0 — Matriz de Release Candidate

Atualização: 30/09/2026.

Estados:
- **PASS** — validado por teste automatizado, SQL real, smoke ou teste humano já aprovado.
- **PASS TÉCNICO / MOBILE PENDENTE** — implementação validada; falta conferência física final em celular/PWA.
- **BLOQUEADO POR CONFIGURAÇÃO** — arquitetura pronta; falta configuração externa de homologação.
- **NÃO EXECUTAR** — depende de autorização final para produção.

A V2.9 permanece em produção.

## Checklist obrigatório

| Item | Estado | Evidência / observação |
|---|---|---|
| HTML/CSS/JS | PASS | syntax checks, smoke HTTP e suíte completa |
| PWA | PASS TÉCNICO / MOBILE PENDENTE | manifest, SW e assets validados |
| manifest | PASS | suíte release candidate static |
| service worker | PASS | cache isolado V3 e Auth fora do cache |
| mobile | PASS TÉCNICO / MOBILE PENDENTE | viewport/media queries validados |
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
| cancelamento de assinatura | PASS | cancelamento do sandbox recebido automaticamente por webhook |
| expiração de assinatura | PASS | state machine e períodos de entitlement validados no TEST |
| reativação | PASS | fluxo de reativação e ordenação de eventos validados |
| e-mails transacionais | PASS | Brevo configurado; 11 templates; worker real enviou evento e persistiu message id |
| push | PASS | Firebase TEST configurado; cron seguro + dispatcher interno ativos; 4 smokes reais em `sent` com `provider_message_id`; quarto smoke exibido fisicamente no Mac com o PepDay fechado após habilitar notificações do Chrome no macOS |
| cache/update | PASS | cache profile-sync-17; vínculo de push reidratado após reload e preferências recolhidas até “Alterar preferências” |
| exportação de dados | PASS | RPC real com rollback + UI |
| exclusão de conta | PASS TÉCNICO | função ACTIVE; smoke 400/401; teste destrutivo requer conta descartável |
| Termos/Privacidade | PASS TÉCNICO | versões vigentes; revisão jurídica profissional pendente |

## Testes atuais

- Regressão completa: **350/350 PASS**
- Códigos promocionais: **6/6 PASS**
- Release candidate static: **11/11 PASS**
- Bloco D jurídico/direitos/local: **36/36 PASS**
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

QA físico Android já aprovou Home, Calculadora, Perfil, tutorial, reinstalação do PWA, ciclo offline → online e persistência do vínculo de push após reload. A UX do Perfil foi então simplificada para mostrar **“Alterar preferências”** no estado ativo e abrir os checkboxes somente sob demanda; falta apenas retestar essa apresentação e concluir os itens restantes abaixo.

No celular real, validar:
1. abrir a homologação;
2. Home/Calculadora/Perfil;
3. 30/50/100 UI;
4. mg/mcg;
5. tutorial;
6. instalar PWA;
7. fechar e abrir pelo ícone;
8. modo offline da parte local;
9. voltar online e observar sincronização;
10. Termos/Privacidade;
11. exportação em conta de teste;
12. seringa sem corte horizontal.

## Jurídico

Os documentos estão funcionais e versionados, mas a revisão jurídica profissional final permanece obrigatória antes do lançamento comercial.

## Critério para RC final

A promoção para produção exige:
1. homologação externa de pagamentos;
2. homologação real de e-mail;
3. homologação real de push;
4. teste físico mobile/PWA;
5. teste destrutivo de exclusão com conta descartável;
6. revisão jurídica final;
7. regressão completa verde;
8. revisão de segredos/arquivos;
9. release candidate final;
10. aprovação expressa do proprietário.

## Produção

**NÃO EXECUTAR automaticamente.**

Não alterar V2.9, main ou GitHub Pages até autorização expressa.
