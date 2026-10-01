# PepDay — Current State

Atualização: 30/09/2026.

## Fonte de verdade operacional

- Repositório: `wpontieri-boop/pepday`
- Branch de desenvolvimento: `v3.0-bloco-b`
- Ambiente de homologação: `https://pepday-v3-homologacao.onrender.com/`
- Produção V2.9 / `main`: **não alterar sem autorização expressa**.
- Antes de qualquer alteração, ler `AGENTS.md`, conferir branch, alterações locais e sincronização com `origin/v3.0-bloco-b`.

## Estado atual aprovado

- Firebase TEST configurado para Web Push.
- Service account do Firebase está configurada somente como segredo no Supabase TEST.
- Cliente Web Push usa VAPID público e registra a instalação no Supabase por RPC autenticada.
- Arquivo de service worker do Firebase está publicado em `src/firebase-messaging-sw.js`; o 404 anterior foi corrigido.
- Teste humano confirmou no Mac: **“Notificações ativadas neste aparelho.”**
- Disparo periódico seguro de push foi configurado somente no Supabase TEST com `pg_cron` + `pg_net`, token efêmero de uso único e a Edge Function interna `fcm-push-cron-dispatcher`.
- Migrations TEST: `20260930224101_fcm_push_cron_dispatcher.sql` e `20260930224752_route_fcm_cron_dispatcher.sql`.
- Quatro smokes operacionais reais foram processados ponta a ponta: todos ficaram em `sent` e todos persistiram `provider_message_id` do Firebase.
- O quarto smoke foi exibido fisicamente no Mac como banner **PepDay — “Há um aviso operacional no PepDay.”** após habilitar as notificações do Google Chrome no macOS. Push: **PASS final**.
- No QA físico Android, a reidratação do vínculo do aparelho após reload foi corrigida e retestada com sucesso: a RPC por usuário `get_push_installation_status` mantém o aparelho ativo após reload e Ativar/Desativar não aparecem juntos. Migration TEST: `20260930235204_push_installation_status.sql`.
- A UX do Perfil foi simplificada: ativar continua sendo um único passo com as quatro categorias ligadas por padrão; no estado ativo, as opções ficam recolhidas e aparece **“Alterar preferências”**. Somente ao editar aparecem os checkboxes, **“Salvar alterações”** e **“Cancelar”**. Cache V3 atualizado para `profile-sync-18` após o hardening jurídico; o comportamento de push aprovado permanece preservado.
- O primeiro teste destrutivo de exclusão de conta no Android revelou CORS preflight incorreto: `OPTIONS` recebia 405 e nenhum `POST` de exclusão era executado. `account-delete` foi corrigida para responder CORS/OPTIONS e implantada somente no TEST como versão 20. O reteste destrutivo passou: `OPTIONS 200`, `POST 200`, sessão encerrada e verificação direta confirmou **zero registros** da conta descartável em `auth.users` e nas tabelas vinculadas conferidas (perfil, settings, assinatura, trial, frascos, rotinas, histórico, push e outboxes). Exclusão de conta: **PASS final**.
- QA físico Android/PWA concluído: Home, Calculadora, Perfil, 30/50/100 UI, mg/mcg, tutorial, instalação/reabertura PWA, offline → online, Termos/Privacidade, exportação JSON, seringa sem corte, preferências de push, push real com app fechado e exclusão destrutiva de conta descartável: **PASS**.
- Revisão final de arquivos: nenhum `.env`, PEM, service-account/credentials JSON ou bloco real de chave privada está versionado. A Firebase Web API key do projeto TEST foi restrita no Google Cloud ao domínio de homologação e às APIs Firebase/FCM necessárias; um push real no Android com o PWA fechado continuou funcionando após a mudança. O alerta #1 do GitHub Secret Scanning (`google_api_key`) foi resolvido como `wont_fix` com justificativa de chave pública intencional e restrita. Segurança técnica da RC: **PASS**.
- Hardening jurídico implementado em TEST: Termos `terms-2026-09-30`, Política `privacy-2026-09-30`, consentimento específico e versionado para dados sensíveis (`health-data-2026-09-30`), bases legais refinadas, regras de PRO/renovação/arrependimento, gestão normal de cancelamento da assinatura e procedimento interno de incidentes LGPD. Migration TEST: `20261001020400_legal_consent_fields.sql`; `mercado-pago-checkout` v27 e `mercado-pago-cancel-subscription` v1 estão ACTIVE. Smoke não destrutivo do cancelamento: OPTIONS 200 e confirmação inválida 400.
- **Bloqueio jurídico de produção:** preencher a identificação jurídica real do fornecedor/controlador (nome ou razão social, CPF/CNPJ quando aplicável, endereço físico e eletrônico). Esses dados não foram inventados. Parecer externo de advogado permanece recomendável, mas não foi obtido nesta etapa.
- Produção continua intocada.

## UX de notificações aprovada

Fluxo oficial:
1. Após completar o cadastro, se a permissão do navegador ainda estiver no estado padrão, o app retorna à Home e destaca o convite de lembretes.
2. A Home mostra convite leve: **“Deixe o PepDay lembrar por você”**.
3. Se a pessoa ainda não tiver ativado notificações, ao criar a primeira rotina aparece o convite contextual: **“Sua rotina está pronta”**.
4. A permissão nativa só é solicitada após clique explícito em **“Ativar lembretes”**.
5. O Perfil permanece como área de manutenção para ativar/desativar o aparelho e escolher preferências.

Mensagens comerciais aprovadas:
- **“Lembretes no celular, mesmo com o PepDay fechado.”**
- **“Não dependa só da memória.”**
- PRO destaca **experiência sem anúncios**.
- Trial de 7 dias apresenta recursos PRO, lembretes no celular e experiência sem anúncios.

A landing page já incorpora esses benefícios nos recursos e nos planos PRO/Trial.

## Testes atuais

- Regressão completa após hardening jurídico/billing: **362/362 PASS**.
- FCM/UX push: **19/19 PASS**.
- Bloco D / direitos de dados: **12/12 PASS**, incluindo CORS do `account-delete`.
- Sintaxe de `fcm-push-worker` e `fcm-push-cron-dispatcher`: PASS.
- Advisors Supabase executados após o DDL; nenhum novo bloqueio crítico foi introduzido.

## Próximo passo técnico

Push, exclusão de conta, QA físico mobile/PWA, segurança técnica e hardening jurídico funcional em TEST estão fechados. Próximos passos:
1. preencher a identificação jurídica real do fornecedor/controlador nos Termos e na Política, sem inventar dados;
2. fazer uma conferência humana curta do novo reaceite jurídico e da apresentação de gestão da assinatura na homologação; o cancelamento real não foi disparado porque existe uma assinatura TEST ativa;
3. fechar formalmente a Release Candidate e somente depois solicitar aprovação expressa para promoção à produção.

Produção, `main` e V2.9 permanecem fora deste fluxo.

## Regra para retomar em outro chat ou computador

Ao continuar o PepDay:
1. ler `AGENTS.md`;
2. ler este arquivo `docs/CURRENT-STATE.md`;
3. executar `git fetch`;
4. comparar `HEAD...origin/v3.0-bloco-b`;
5. não sobrescrever divergências entre máquinas;
6. continuar apenas a partir do checkpoint sincronizado no GitHub.

