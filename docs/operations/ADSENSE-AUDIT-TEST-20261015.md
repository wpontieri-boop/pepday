# AdSense — auditoria e correções exclusivamente TEST

Data: 15/10/2026 (Brasília). Base oficial: `0c6361729787d1d9ca76aae6d65a0b8ea9597a4d`, branch `v3.0-bloco-b`, árvore limpa, fetch e divergência 0/0 antes das alterações. AGENTS.md e CURRENT-STATE.md integralmente lidos; URL-MAP.md consultado. Nenhuma autorização PROD/main/V2.9, anúncios reais ou nova revisão Google.

## Diagnóstico e grau de certeza

A reprovação por **conteúdo de baixo valor foi informada pelo proprietário nesta missão**. Não foi lido o detalhe privado do Policy Center nem um relatório de rastreamento da conta. A causa interna exata da decisão do Google não é observável nesta auditoria.

**Hipótese principal:** a utilidade do software FREE não está apresentada de forma suficientemente direta e explicada no conjunto público submetido. A landing é comercial, mas contém texto HTML original, FAQ, capturas reais, planos e links para o app/jurídico; não é uma página vazia. O app também contém os campos no HTML e permite cálculo sem login, mas começa em “Resumo de hoje”; a calculadora fica em `.screen` inicialmente oculta, acessada por botão JS `data-go`, não por URL/link de navegação HTML próprio. Um rastreador não deve depender de clicar botões ou preencher formulários para descobrir conteúdo explicativo. O primeiro acesso também inclui tutorial já aprovado; não foi removido para rastreadores.

Não há evidência de que o Google tenha visto **somente** a landing. A intenção de monetizar o aplicativo não dispensa qualidade e avaliação do site/páginas. Google Search pode executar JS; não afirmar que “AdSense não lê JavaScript”. Rastreamento, indexação Google Search e aprovação AdSense são processos distintos.

**Defeitos técnicos confirmados:** robots.txt e sitemap.xml públicos respondem 404; ausência de canonical na landing/app; título do app genérico “PepDay”; navegação interna da calculadora por botão; falta de explicação pública de fórmulas/limites. Robots ausente **não bloqueia por si só o rastreamento**, sitemap/canonical ausentes não provam causa da recusa. O ads.txt público está correto; autoriza o vendedor do inventário e não aprova qualidade do conteúdo.

**Indexação efetiva desconhecida:** pesquisa pública `site:pepday.com.br` não trouxe evidência suficiente; não prova ausência do índice. Sem URL Inspection/Search Console, logs autenticados de Googlebot/Mediapartners ou Policy Center, não declarar indexado/desindexado, último crawl ou canonical escolhido. HTTP200 e uma UA simulada não equivalem a um rastreador Google real. O mecanismo de pesquisa não conseguiu abrir as URLs do domínio; HTTP direto, independente, conseguiu.

## Evidência HTTP anterior (15/10)

| URL pública | Resultado |
|---|---|
| `/` | 200, HTML comercial interpretável, SHA256 `3c9ae74e292eeb0a5d70c221f202369665fd9adc1940e0b8cba814a87e30af88` |
| `/app/` | 200, campos FREE no HTML, SHA256 `af87f712dc14bd9f3049e73da1ff33200038d9128d1d83c27a82974d0bfc7e85` |
| `/robots.txt` | 404 |
| `/sitemap.xml` | 404 |
| `/ads.txt` | 200, linha oficial existente exata |
| `/termos.html`, `/privacidade.html` | 200, identificação/controlador e conteúdo jurídico existentes preservados |

Sem X-Robots-Tag nas cinco respostas200 conferidas. Comparação UA simulada e limites no JSON de evidência. Não houve login, submissão Search Console/AdSense, pedidos de revisão, writes de conta, pagamento ou chamadas a anúncios reais.

## Políticas oficiais consultadas em 15/10/2026

1. [AdSense Program policies](https://support.google.com/adsense/answer/48182?hl=en), página informa atualização 04/08/2026: requisitos de frames de apps; WebView API for Ads com Google Mobile Ads SDK; Android Chrome Custom Tabs e Trusted Web Activities; iOS SFSafariViewController apenas iOS9/10. Esta lista **não é autorização genérica de qualquer PWA instalado**.
2. [Ad placement policies](https://support.google.com/adsense/answer/1346295?hl=en): páginas web e WebViews aprovadas, restrições a software e janelas sem voltar/avançar/URL editável, conteúdo avaliável, navegação e cliques acidentais. A frase sobre controles está na seção pop-up/pop-under; não inventar uma regra textual específica “todo PWA é proibido”.
3. [Screens without publisher-content](https://support.google.com/publisherpolicies/answer/11112688?hl=en): conteúdo de baixo valor, telas de navegação/alertas/construção não são inventário elegível. Nenhuma exigência universal de blog, número de artigos ou palavras foi encontrada.
4. [Crawler issues](https://support.google.com/adsense/answer/2381908?hl=en) e [login-protected pages](https://support.google.com/adsense/answer/161351?hl=en): conteúdo precisa ser avaliável; crawler login é recurso após ativação e não justificativa para expor dados privados. FREE já é público; não abrir rotinas/Admin nem fornecer contas reais ao rastreador.
5. [Google Search JavaScript basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics), [crawlable links](https://developers.google.com/search/docs/crawling-indexing/links-crawlable) e [canonical](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls): HTML útil, links `<a href>`, canonical consistente; Google pode renderizar JS. Canonical/sitemap são sinais, não garantias.
6. [Personalized advertising](https://support.google.com/publisherpolicies/answer/15101728?hl=en): não usar dados de saúde para segmentar/personalizar ou formar públicos. [Publisher Restrictions](https://support.google.com/publisherpolicies/answer/10437795?hl=en) trata promoção de venda de medicamentos/suplementos não aprovados; não há nesta auditoria prova de que o PepDay recebeu essa classificação. Não adicionar alegações terapêuticas, indicação de produtos ou prescrição para “ganhar conteúdo”.

## Modelo compatível proposto (não aprovado pelo Google)

| Contexto | Decisão operacional |
|---|---|
| FREE público em navegador comum, online, calculadora com resultado | Candidato AdSense **somente após aprovação do site**, configuração/consentimento e revisão final de privacidade e posicionamento. Atualmente OFF. |
| PWA instalado standalone/fullscreen/minimal-ui/iOS standalone | **Manter anúncios reais OFF**, por decisão conservadora enquanto não houver confirmação aplicável do Google para esta implementação. Não afirmar proibição universal específica ou aprovação implícita por ser web. |
| TWA/nativo/WebView | Não implementado; TWA não é sinônimo de PWA A2HS. Avaliar separadamente uma integração oficialmente suportada (SDK/API/AdMob/Ad Manager quando aplicável), sem apenas reaproveitar script web. |
| Trial/cartão/promo/PRO pago | Sem anúncios, como aprovado. |
| Login, perfil, rotinas privadas, Admin, parceiros, alertas, offline | Sem anúncios. |
| TEST | Apenas placeholder sintético, zero inventário real; preview instalado não comprova elegibilidade do provedor. |

Não personalizar a partir de substância, quantidade, rotina, identidade ou dados de saúde. Não enviar esses dados em URL, parâmetros de anúncios, analytics ou públicos. `nonPersonalized=true` não substitui consentimento/CMP nem comprova que um script terceiro não acessará DOM/dados; antes de ativar será necessária revisão desse fluxo. CMP Google previamente configurada é PASS histórico de configuração, não nova prova de entrega/consentimento operacional nesta sessão. Sem Auto Ads indiscriminado no site, sem anúncios na landing nesta missão.

## Alterações mínimas implementadas SOMENTE no build TEST

- Novo `scripts/prepare-test-discovery.mjs`, chamado exclusivamente por `build:test`. `build:public`, `index.html`, `site/index.html`, estilos, cálculo, tutorial, manifest e fonte do SW não foram alterados.
- `/calculadora/`: alias de entrada do **mesmo HTML/cálculo/handlers aprovados**, com tela Calcular ativa, navegação coerente e `<base href="/">`. Não é uma segunda calculadora. Primeiro uso mantém tutorial existente; conclusão do tutorial mantém comportamento anterior. O link direto não persiste destino após tutorial; não foi alterada a UX aprovada para isso.
- `/site/`: mesmo CTA “Usar calculadora grátis” passa a apontar para alias TEST; palavras existentes na primeira resposta FAQ passam a ser link do guia. Sem mudar layout/CSS/imagens/planos.
- `/guia-calculadora/`: uma página estática original da equipe PepDay sobre campos, fórmulas, U-100, arredondamento/capacidade, hipótese de volume e limites; sem doses de substâncias, protocolos, prescrições, blog, depoimentos ou credenciais profissionais inventadas. Usa CSS existente e links de retorno, jurídico/suporte. Guia sem JS interpretável em HTML.
- Canonical das seis URLs públicas para **homologação**, título próprio na entrada da calculadora; sitemap com seis URLs QA, sem páginas privadas ou params. Robots libera leitura pública e bloqueia rotas privadas (não é proteção de acesso). **Todo HTML TEST recebe noindex,nofollow quando não tinha diretiva**; não submeter sitemap de TEST ao Search Console. Isto é ensaio de descoberta, não tentativa de indexar homologação.
- Loader Ads: agora respeita explicitamente `enabled`, configuração válida, tela ativa e acesso pronto. Requisições reais negadas em modos instalados, offline, iframe, WebView detectado e referrer android-app. Revalida elegibilidade após carregamento assíncrono para não enfileirar anúncio após mudança PRO. Detecção de ambiente é defesa conservadora, não certificação exaustiva de todos os wrappers.
- Cache-bust de Ads e cache SW **somente no output TEST**. Preview FREE permanece sintético; configuração PROD permanece `enabled=false` e IDs/slot vazios. Módulos fonte novos não foram publicados em PROD.

## Validação e limites

- `node --test tests/adsense-audit.test.mjs tests/ads.test.mjs tests/public-build.test.mjs tests/pwa-install.test.mjs tests/block-b1.test.mjs tests/tutorial-mobile-regression.test.mjs`: **43/43 PASS**, zero falhas/skip. Testes focados, não execução de toda a suíte global nem repetição de QA humano PASS.
- Loader real executado em Node VM com DOM inerte: PRO, configOFF, entitlement pendente, installed Android/iOS, offline, iframe, tela inativa e sem resultado ⇒ zero scripts; FREE navegador ⇒ um script sintético, um enqueue, sem auto-refresh; mudança PRO durante load ⇒ zero enqueue. Não são anúncios Google nem teste de receita.
- Build TEST, sintaxe e `git diff --check` PASS. Comparação baseline: 12 caminhos mudam (5 HTML existentes apenas metadados/cache/links; alias/guia/robots/sitemap novos; 2módulos Ads; cache SW TEST). Admin/roles/fiscal/portal/billing/MP/Auth/push/layout/cálculo originais preservados. Nenhum backend/migration/Edge alterado.
- Build público conferido pelo teste de empacotamento; não recebeu os novos caminhos/guia/robots/sitemap do ensaio. Futuro pacote de promoção precisa adaptar mapeamento público `/app/` e canonical/robots/sitemap PROD, removendo noindex **somente** das páginas públicas aprovadas.
- Chromium local indisponível; download oficial Playwright falhou por artefato truncado. Não declarar QA mobile/layout físico nem novo PASS HUMANO por esse motivo. Conferência de navegador publicada e integridade LIVE serão registradas no checkpoint de fechamento.

## Próxima ação exata para aprovação do proprietário

Aprovar **o modelo FREE com publicidade apenas no navegador e PWA instalado sem anúncios**, junto da página-guia e entrada pública da calculadora demonstradas em TEST. Depois autorizar em etapa separada preparar/promover exclusivamente o pacote público de descoberta e guardas Ads, **mantendo Ads OFF**. Não solicitar revisão AdSense até esse pacote estar publicado/inspecionado e o proprietário autorizar explicitamente a nova solicitação. Não há promessa de aprovação Google; caso anúncios no instalado sejam requisito comercial, obter confirmação do Google ou planejar integração oficialmente suportada antes de habilitar.
