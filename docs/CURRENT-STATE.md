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
- Fila de push aceitou uma notificação operacional de teste (`queued: 1`).
- Ainda falta fechar o disparo automático/seguro do `fcm-push-worker` e confirmar a entrega visual de uma notificação real no dispositivo.
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

- Regressão completa: **344/344 PASS**.
- Pacote direcionado de push + landing + static: **32/32 PASS**.
- Sintaxe de `app.js` e `src/account-ui.mjs`: PASS.

## Próximo passo técnico

Fechar o pipeline real de push em TEST:
1. configurar um disparador seguro e periódico do `fcm-push-worker`;
2. processar a notificação operacional já enfileirada ou criar um novo smoke;
3. confirmar notificação real no Mac/celular;
4. somente então marcar push como PASS na matriz de Release Candidate.

Depois disso, seguir para validações finais de mobile/PWA e demais pendências da matriz.

## Regra para retomar em outro chat ou computador

Ao continuar o PepDay:
1. ler `AGENTS.md`;
2. ler este arquivo `docs/CURRENT-STATE.md`;
3. executar `git fetch`;
4. comparar `HEAD...origin/v3.0-bloco-b`;
5. não sobrescrever divergências entre máquinas;
6. continuar apenas a partir do checkpoint sincronizado no GitHub.

