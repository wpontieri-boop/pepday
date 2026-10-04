# PepDay — Current State

Atualização: 04/10/2026.

## Fonte de verdade operacional

- Repositório: `wpontieri-boop/pepday`
- Branch de desenvolvimento: `v3.0-bloco-b`
- Ambiente de homologação: `https://homologacao.pepday.com.br/` (Render, DNS verificado e certificado HTTPS emitido; fallback técnico `https://pepday-v3-homologacao.onrender.com/`)
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
- A UX do Perfil foi simplificada: ativar continua sendo um único passo com as quatro categorias ligadas por padrão; no estado ativo, as opções ficam recolhidas e aparece **“Alterar preferências”**. Somente ao editar aparecem os checkboxes, **“Salvar alterações”** e **“Cancelar”**. O cache V3 chegou a `profile-sync-22` no ajuste do domínio customizado de homologação; o comportamento de push aprovado permanece preservado.
- O primeiro teste destrutivo de exclusão de conta no Android revelou CORS preflight incorreto: `OPTIONS` recebia 405 e nenhum `POST` de exclusão era executado. `account-delete` foi corrigida para responder CORS/OPTIONS e implantada somente no TEST como versão 20. O reteste destrutivo passou: `OPTIONS 200`, `POST 200`, sessão encerrada e verificação direta confirmou **zero registros** da conta descartável em `auth.users` e nas tabelas vinculadas conferidas (perfil, settings, assinatura, trial, frascos, rotinas, histórico, push e outboxes). Exclusão de conta: **PASS final**.
- QA físico Android/PWA concluído: Home, Calculadora, Perfil, 30/50/100 UI, mg/mcg, tutorial, instalação/reabertura PWA, offline → online, Termos/Privacidade, exportação JSON, seringa sem corte, preferências de push, push real com app fechado e exclusão destrutiva de conta descartável: **PASS**.
- Revisão final de arquivos: nenhum `.env`, PEM, service-account/credentials JSON ou bloco real de chave privada está versionado. A Firebase Web API key do projeto TEST foi restrita no Google Cloud ao domínio de homologação e às APIs Firebase/FCM necessárias; um push real no Android com o PWA fechado continuou funcionando após a mudança. O alerta #1 do GitHub Secret Scanning (`google_api_key`) foi resolvido como `wont_fix` com justificativa de chave pública intencional e restrita. Segurança técnica da RC: **PASS**.
- Hardening jurídico implementado em TEST: Termos `terms-2026-09-30-2`, Política `privacy-2026-09-30-2`, consentimento específico e versionado para dados sensíveis (`health-data-2026-09-30`), bases legais refinadas, regras de PRO/renovação/arrependimento, gestão normal de cancelamento da assinatura e procedimento interno de incidentes LGPD. Migration TEST: `20261001020400_legal_consent_fields.sql`; `mercado-pago-checkout` v27 e `mercado-pago-cancel-subscription` v1 estão ACTIVE. Smoke não destrutivo do cancelamento: OPTIONS 200 e confirmação inválida 400.
- **PWA Install técnico concluído em TEST/código:** Android usa `beforeinstallprompt` e o prompt nativo quando disponível; iPhone/iPad mostra guia visual `Compartilhar → Adicionar à Tela de Início`; o botão some no modo standalone. Telemetria mínima e anônima registra somente identificador aleatório da instalação, evento (`installed`/`standalone_launch`) e plataforma ampla, sem conta, rotina, frasco ou conteúdo de saúde. Migration TEST: `20261001175011_pwa_install_telemetry.sql`. O painel admin exibe instalações detectadas, dispositivos instalados ativos e aberturas instaladas. Smoke real da RPC pública retornou HTTP 200 e a fixture foi removida. A métrica é **direcional**, não é fonte de autorização/faturamento e pode sofrer ruído de clientes anônimos. O advisor sinaliza a RPC `SECURITY DEFINER` disponível para `anon`; isso é intencional para medir instalação antes do login, com entrada estritamente limitada e tabela sem acesso direto.
- Identificação jurídica do fornecedor/controlador preenchida com os dados empresariais aprovados do **Wagner Pontieri Junior / WP Imports**, CNPJ `21.756.593/0001-90`, endereço empresarial em Jacareí/SP e e-mail `wagnerpontieri@gmail.com`. O bloqueio de identificação jurídica foi encerrado. Em 03/10/2026, o proprietário confirmou que a contadora aprovou manter o enquadramento/código de consultoria previamente definido para a cobrança do PepDay; a pendência fiscal/contábil da RC fica encerrada. Parecer externo de advogado continua recomendável, mas não foi obtido nesta etapa.
- Produção V2.9/main continua intocada enquanto o cutover V3 autorizado é preparado em infraestrutura separada; nenhum tráfego real foi apontado ao novo backend antes da validação final dos provedores externos.

## Checkpoint 02/10/2026 — domínio público, cartão/QR e segurança RC

- Serviço público separado `pepday-public` criado no Render a partir do commit `8914ef4`, com auto-deploy desligado; homologação permanece isolada em `pepday-v3-homologacao`.
- DNS definitivo publicado: `pepday.com.br` aponta para o serviço público, `www.pepday.com.br` redireciona para o raiz e `homologacao.pepday.com.br` continua apontando para homologação.
- Certificados TLS do domínio público emitidos; smokes HTTP/HTTPS: `/` 200, `/cartao/` 200 e `www` 301 para o domínio raiz.
- QR definitivo fechado para `https://pepday.com.br/cartao/`; arte aprovada do cartão físico preservada (verso com ampola + celular) e pacote final para gráfica preparado em 9 × 5 cm com 3 mm de sangria.
- Auditoria final de `SECURITY DEFINER`: funções de usuário autenticado validam `auth.uid()`; funções administrativas validam também `role='admin'`; rotinas internas ficam restritas a `service_role/postgres`; `record_pwa_install_event` permanece anon intencional com entrada estritamente limitada e sem conteúdo sensível.
- Tabelas operacionais com RLS sem policy não possuem grants diretos para `anon/authenticated`; acesso segue por RPCs/roles internas.
- GitHub Secret Scanning: 0 alertas abertos. Nenhum `.env`, PEM, service account ou credencial real está versionado; `.env.d2f` e `.env.d4` estão cobertos por `.gitignore` (`.env.*`).
- Alerta `Leaked Password Protection Disabled` permanece apenas por limitação do plano Supabase Free; a proteção contra senhas vazadas exige plano Pro.
- PC da loja preparado: GitHub autenticado, Render API funcional com segredo protegido localmente pelo Windows, Firebase CLI instalado/autenticado em `wpontieri@gmail.com` e projeto `PepDay V3 Test` visível.
- Pendência manual restante da RC: QA físico iPhone/iPad somente do fluxo PWA `Compartilhar → Adicionar à Tela de Início` e estado já instalado. Não repetir áreas já aprovadas.
- Produção V2.9/`main` seguem intocados até autorização expressa.
- **Estrutura pública corrigida em 02/10/2026:** o serviço `pepday-public` usa agora o build dedicado `npm run build:public` (auto-deploy continua desligado). Rotas LIVE e validadas: `https://pepday.com.br/` = landing principal, `/app/` = snapshot da V3 TEST, `/admin/` = painel privado, `/cartao/` = benefício/QR. Assets críticos de app/admin/jurídico retornam HTTP 200.
- O painel `/admin/` está protegido pelo mesmo controle administrativo via RPCs e continua conectado ao **Supabase TEST**; portanto as métricas exibidas são de teste até o cutover definitivo do backend. A homologação permanece intacta e separada.
- Regressão após o novo build público: **382/382 PASS**. Teste dedicado do empacotamento garante que a landing não volte a ser substituída pelo app na raiz.
- **Posicionamento comercial da landing refinado em 02/10/2026:** a primeira dobra agora identifica explicitamente o PepDay como **calculadora e organizador de rotina para peptídeos**, com conversões mg/mcg/mL/UI, seringa U-100, rotinas, frascos e histórico; o FREE é apresentado como calculadora de peptídeos e o PRO como camada de organização/acompanhamento. Linguagem não médica preservada, deixando explícito que o PepDay não prescreve nem recomenda doses, substâncias, tratamentos ou protocolos.
- Deploy público desse refinamento ficou LIVE no Render no commit `e243e5c`; smoke em `https://pepday.com.br/` confirmou HTTP 200 e presença dos novos textos. Regressão completa: **383/383 PASS**.
- **Refinamento visual da landing em 02/10/2026:** o hero principal foi preservado; os cards de apoio ganharam referências visuais discretas de rotina/celular e frasco; a segunda captura real do app foi substituída por versão limpa, sem o tutorial sobreposto; o bloco de frascos passou a mostrar visualmente saldo de exemplo (6,4 mg de 10 mg), barra de consumo, previsão de término e histórico preservado, com frasco visual consistente com a identidade do cartão. Deploy público LIVE no commit `779cbaa`; o asset `home-real.png` publicado foi verificado por hash contra o arquivo local. Regressão completa: **384/384 PASS**.

## Checkpoint 03/10/2026 — cutover de produção autorizado e preparado

- O proprietário deu **autorização expressa para produção**.
- Criado projeto Supabase separado **`pepday-prod`** (ref `oslefjmwfnddxlotalxu`, região `sa-east-1`) dentro da organização PepDay. O projeto TEST `fsbqpyyprtymwrmzsacp` permanece preservado para homologação.
- A organização continua no plano Free. A consulta de custo no momento da criação retornou **0/mês**; os dois projetos gratuitos disponíveis passam a ser TEST + PROD.
- A estrutura aprovada foi aplicada no PROD sem copiar dados/fixtures. As 23 tabelas de domínio estão vazias e com RLS habilitado.
- As 7 Edge Functions aprovadas foram implantadas no PROD: `account-delete`, `mercado-pago-checkout`, `mercado-pago-webhook`, `mercado-pago-cancel-subscription`, `brevo-email-worker`, `fcm-push-worker` e `fcm-push-cron-dispatcher`.
- O helper oficial/documentado de auto-RLS existente no TEST, mas ausente do histórico local, foi incorporado ao repositório pela migration `20260928174500_rls_auto_enable_baseline.sql`, com EXECUTE restrito a `postgres`, e aplicado em TEST/PROD.
- O PROD recebeu `pepday_supabase_project_url` no Vault, segredos internos novos para workers, URLs públicas de produção e os IDs dos 11 templates Brevo. O Auth PROD aponta para `https://pepday.com.br/app/`, usa OTP de 6 dígitos, confirmação por e-mail e TOTP. Google OAuth está habilitado no PROD com credencial própria de produção.
- O build público foi separado por ambiente: homologação continua usando `config.js` do TEST; `npm run build:public` passa a injetar `config.production.js` no site público e no `/app/`. Guardas impedem a configuração TEST de operar no app de produção e impedem a configuração PROD de operar fora de `pepday.com.br/app/`. Sessões Auth também usam chaves locais separadas por ambiente.
- Regressão completa após a separação TEST/PROD e o ajuste final de Auth e-mail: **387/387 PASS**.
- Advisors do PROD foram revisados: os avisos de tabelas RLS sem policy correspondem às tabelas backend-only sem grants diretos; os avisos de SECURITY DEFINER correspondem às RPCs intencionalmente expostas e já endurecidas/validadas; índices não usados são esperados em banco PROD vazio. Nenhum bloqueio novo foi identificado.
- **Virada pública executada em 04/10/2026.** O serviço `pepday-public` foi implantado manualmente no deploy `dep-db0svk9srm7s7391savg` a partir do commit `9c78d6c`; o auto-deploy continua desligado. Rollback conhecido: deploy anterior `dep-db03fmc9v7es739patu0`, commit `779cbaa`. `main`/V2.9 seguem intocados.
- Mercado Pago LIVE: `MERCADO_PAGO_ACCESS_TOKEN` já foi configurado diretamente como secret no Supabase PROD e `MERCADO_PAGO_LIVE_MODE=true` permanece ativo. A integração usa assinaturas sem plano associado; por orientação atual do Mercado Pago, o webhook reconhece `subscription_preapproval`, `subscription_authorized_payment` e também `payment`. O tópico `payment` é autenticado e confirmado sem mutação de billing para evitar duplicidade; `subscription_authorized_payment` continua sendo a fonte canônica da cobrança recorrente.
- Mercado Pago LIVE está configurado com `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET`, `MERCADO_PAGO_LIVE_MODE=true` e URL PROD cadastrada no painel. O webhook PROD foi validado com rejeição correta de chamada sem assinatura (`INVALID_SIGNATURE`).
- Brevo PROD: `BREVO_API_KEY` dedicada foi criada no Brevo e gravada diretamente como secret no Supabase PROD. Os 11 templates transacionais já validados permanecem vinculados pelos `BREVO_TEMPLATE_*` do PROD. Para Auth, o Supabase PROD usa SMTP customizado do Brevo (`smtp-relay.brevo.com:587`) com remetente verificado `PepDay <wpontieri@gmail.com>`. Os templates Auth de confirmação/login foram trocados de link para OTP de 6 dígitos (`{{ .Token }}`). Smoke real em 04/10/2026: pedido `/otp` HTTP 200, Brevo registrou `requests` + `delivered` e o Gmail recebeu `Seu código de acesso PepDay` com o OTP. **E-mail Auth PROD: PASS técnico/entrega.**
- Firebase PROD separado criado como `PepDay V3 PROD` (`pepday-v3-prod`) e app Web `PepDay Web PROD` registrado. A configuração pública do cliente e a VAPID pública de produção foram incorporadas em arquivos específicos de produção; `npm run build:public` sobrescreve somente os artefatos públicos com Firebase PROD, enquanto homologação continua usando `pepday-v3-test`. O cache do Service Worker avançou para `pepday-v3-profile-sync-24` para forçar a troca segura dos assets de Firebase/config no cutover. Regressão completa após a separação Firebase TEST/PROD: **386/386 PASS**.
- A service account do Firebase PROD foi validada localmente como `pepday-v3-prod`, gravada diretamente no Supabase PROD como `FIREBASE_SERVICE_ACCOUNT_JSON` e confirmada sem expor o valor. O JSON baixado e o arquivo temporário foram apagados do Mac após a confirmação. O cron `pepday-fcm-push-worker` está ativo a cada minuto no PROD.
- A Web API key do Firebase PROD foi restringida para `https://pepday.com.br/*` e `https://www.pepday.com.br/*`. O GitHub Secret Scanning abriu o alerta #2 por essa chave pública de cliente; após confirmar que se tratava da configuração Web Firebase intencional e já restrita, o alerta foi resolvido como `wont_fix` documentado. **Secret Scanning: 0 alertas abertos.**
- Smoke real de push no Mac em 04/10/2026 identificou erro `installations/request-failed / API key not valid`. A causa era um caractere digitado incorretamente na Web API key de produção (`0` no lugar de `O`) em `firebase-public-config.production.mjs` e `firebase-messaging-sw.production.js`. A configuração oficial foi reobtida via Firebase CLI, os dois arquivos foram corrigidos, commit `e1d52bf` publicado no Render pelo deploy `dep-db17fq3ncjis73bhnlr0`, e o `getToken()` do Firebase passou a retornar token FCM válido (142 caracteres) no navegador real. O aparelho foi registrado no PROD, `push_installations.active=true`, e um push operacional real foi enfileirado e processado pelo cron/worker com status `sent` e message ID do FCM, sem erro. **Push PROD: PASS técnico real.** Regressão após a correção: **387/387 PASS**.
- OAuth Google PROD foi criado no projeto Google `PepDay V3 PROD` e configurado no Supabase PROD com origem `https://pepday.com.br` e callback `https://oslefjmwfnddxlotalxu.supabase.co/auth/v1/callback`. O authorize PROD respondeu HTTP 302 para `accounts.google.com` com o client ID de produção e redirect de retorno para `https://pepday.com.br/app/`. O JSON OAuth baixado foi apagado do Mac após a configuração.
- Smoke público pós-cutover: `/`, `/app/`, `/admin/`, `/cartao/`, `/termos.html` e `/privacidade.html` responderam HTTP 200; `/app/config.js` usa Supabase PROD sem referência TEST; Firebase público usa `pepday-v3-prod` sem referência TEST; Service Worker usa `pepday-v3-profile-sync-24`; landing e cartão apontam para `/app/`; Google authorize PROD responde 302 para `accounts.google.com`; chamadas não autenticadas aos workers/webhook são rejeitadas como esperado; OTP Auth e sessão/login real passaram; push real foi registrado e enviado com sucesso pelo FCM. O checkout autenticado chegou corretamente ao Mercado Pago, mas o smoke com a conta do proprietário recebeu `Payer and collector cannot be the same user`, porque o e-mail da conta PepDay usada no teste coincide com a conta recebedora do Mercado Pago. Para fechar o checkout sem cobrança é necessário repetir apenas esse passo com uma conta PepDay de e-mail diferente do recebedor. Segredos nunca devem ser enviados ao Git/chat.

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

A landing page já incorpora esses benefícios nos recursos e nos planos PRO/Trial. O refinamento comercial final foi aplicado na `/site/`: FAQ, economia anual explícita (`R$ 99,90/ano` equivalente a `R$ 8,33/mês` e economia de `R$ 78,90` frente a 12 mensalidades), transparência de trial/cancelamento/preservação de dados, CTA móvel fixo e remoção de texto público de “depoimentos em coleta”. O template de relatos reais autorizados continua oculto. O proprietário conferiu a versão final no celular e aprovou FAQ, botão fixo e apresentação geral: **landing PASS humano final**.

## Testes atuais

- Regressão completa após o bloco do cartão/QR de 30 dias: **381/381 PASS**.
- Testes direcionados PWA Install: **6/6 PASS**.
- Testes direcionados Cartão/QR 30 dias PRO: **10/10 PASS**; smokes SQL reais com rollback confirmaram concessão, entitlement, substituição do trial, registro de uso, idempotência e bloqueio para PRO pago ativo.
- FCM/UX push: **19/19 PASS**.
- Bloco D / direitos de dados: **12/12 PASS**, incluindo CORS do `account-delete`.
- Sintaxe de `fcm-push-worker` e `fcm-push-cron-dispatcher`: PASS.
- Advisors Supabase executados após o DDL; nenhum novo bloqueio crítico foi introduzido.

## Próximo passo técnico

Push, exclusão de conta, QA físico mobile/PWA, assinatura/pagamentos, segurança técnica, hardening jurídico e landing final em TEST estão fechados. O proprietário refez o reaceite dos documentos atualizados no celular e aprovou também a landing final como **PASS humano**.

**Regra de encerramento da RC:** itens já validados como PASS não serão repetidos. Só haverá novo teste manual de uma área já aprovada se uma alteração futura tocar diretamente nela ou se a regressão apontar falha relacionada. Testes automatizados de regressão continuam sendo executados normalmente porque não exigem repetir o QA manual do proprietário.

### Bloco atual — PWA Install & Release Finish
1. **PASS TÉCNICO:** UX profissional implementada: Android usa o prompt instalável do navegador quando disponível; iPhone/iPad detecta iOS fora do modo standalone e mostra instrução visual para `Compartilhar → Adicionar à Tela de Início`; o botão desaparece quando o PepDay está em modo instalado;
2. **PASS TÉCNICO:** telemetria mínima de instalação/abertura instalada e métricas agregadas no painel implementadas no TEST, sem conteúdo sensível;
3. **ANDROID PASS HUMANO + iPHONE PASS HUMANO FINAL:** no Android, o proprietário desinstalou o PWA, abriu a homologação no Chrome, viu o botão **Instalar PepDay**, confirmou o prompt nativo, reinstalou e reabriu pelo ícone; a captura física confirmou modo standalone sem barra do Chrome e sem o botão de instalação. No iPhone, o fluxo real foi validado fisicamente pelo Chrome: **Compartilhar → Ver Mais → Adicionar à Tela de Início → Adicionar**, mantendo **Abrir como app web** ativo; o ícone PepDay apareceu na Tela de Início e abriu em modo aplicativo, sem barra do Chrome. A UX foi refinada para diferenciar Chrome e Safari, trocar **Entendi** por **Fechar instruções** e orientar que não é necessário trocar de navegador. O reteste visual final confirmou no Chrome do iPhone os passos específicos com **Ver Mais**. PWA mobile: **PASS final**; não repetir login, assinatura, exclusão, push, calculadora, sincronização ou demais fluxos já aprovados;
4. **PASS CONTÁBIL:** a contadora confirmou que o enquadramento/código de consultoria previamente definido pode ser mantido para o PepDay;
5. **PASS DOMÍNIO TEST + AUTH + FIREBASE REFERRER:** `pepday.com.br` foi escolhido, registrado e pago. O raiz e `www` permanecem reservados para produção e foram removidos do serviço Render de homologação. `homologacao.pepday.com.br` está com CNAME publicado para `pepday-v3-homologacao.onrender.com`, Render **Verified**, certificado **Issued** e HTTPS 200. O frontend TEST usa o hostname customizado para Auth/Termos/Privacidade; o Supabase TEST foi atualizado com `Site URL` e `additional_redirect_urls` iguais a `https://homologacao.pepday.com.br/`, verificados por `config pull`. Email e Google permanecem habilitados e o authorize Google respondeu 302 para `accounts.google.com`. Smoke HTTP das rotas `/`, `/termos.html`, `/privacidade.html`, `/site/` e `/cartao/`: 200. A restrição HTTP referrer da Firebase Web API key TEST foi ampliada para `https://homologacao.pepday.com.br/*`; o teste humano Android conseguiu ativar notificações no novo domínio e o backend registrou nova instalação FCM ativa. Produção V2.9/main seguem intocados;
6. regressão automatizada após o refinamento das instruções PWA está verde em **385/385 PASS**; o guia iOS diferencia Chrome e Safari, o cache V3 está em `profile-sync-23` e `src/pwa-install.mjs?v=23` impede JS antigo em cache. O reteste visual focado no Chrome do iPhone passou. Revisão final de segredos/checklist RC concluída: nenhum `.env`, PEM, service-account/credential ou chave privada versionada; nenhum bloco real `PRIVATE KEY`; a única referência textual a `SUPABASE_SERVICE_ROLE_KEY` é placeholder documentado; GitHub Secret Scanning com **0 alertas abertos**. Auth e Firebase no hostname customizado permanecem validados. A pendência fiscal/contábil também foi encerrada com a confirmação da contadora. O bloco PWA Install & Release Finish está fechado. Antes da promoção à produção resta somente o cutover/configuração de produção, sempre mediante autorização expressa.

### Prioridade comercial imediata — cartão físico com QR
Antes de Instagram/automação, produzir o cartão físico PepDay para distribuição em lojas, inclusive no Paraguai. Padrão aprovado: frente e verso, visual dark premium azul/ciano, formato 9 × 5 cm com 3 mm de sangria, QR grande e mensagem de benefício. A oferta é **30 dias de PepDay PRO grátis**, sem cartão e sem cobrança automática. Regra comercial fechada: benefício único por conta; uma conta que já usou o trial normal de 7 dias ainda pode receber os 30 dias do cartão, desde que não tenha PRO pago ativo; depois da concessão, o trial padrão não pode ser iniciado nem somado. Após os 30 dias, volta ao FREE se não houver assinatura. O backend foi implementado no TEST pela migration `20261001184711_card_qr_30d_benefit.sql`, com métricas de ativação, primeiro uso, término e conversão mensal/anual no painel. A arte pode ser fechada antes, mas o QR final só será gerado para `pepday.com.br/cartao/` ou redirect público equivalente depois do cutover definitivo, nunca para homologação. Estratégia de recuperação aprovada: aviso pré-expiração nos dias 27–29; retorno ao FREE no dia 30; contato de retomada nos dias 32–33; oferta de recuperação com desconto real nos dias 35–37 se ainda não houver assinatura; acompanhamento no painel até conversão mensal/anual. Códigos PRO de 30/60/90 dias continuam separados para cortesias e ações especiais; recuperação comercial terá cupom/desconto próprio. Mensagens promocionais só entram para usuários com consentimento de marketing válido. Valor/percentual da oferta de recuperação será definido antes de implementar, sem inventar regra comercial.

Versão nativa iOS/Android fica como projeto paralelo posterior ao lançamento PWA, quando houver dados reais de instalação/uso. A base web atual será reaproveitada, preferencialmente com trabalho pesado em Codex numa branch separada.

Produção, `main` e V2.9 permanecem fora deste fluxo.

## Regra para retomar em outro chat ou computador

Ao continuar o PepDay:
1. ler `AGENTS.md`;
2. ler este arquivo `docs/CURRENT-STATE.md`;
3. executar `git fetch`;
4. comparar `HEAD...origin/v3.0-bloco-b`;
5. não sobrescrever divergências entre máquinas;
6. continuar apenas a partir do checkpoint sincronizado no GitHub.

