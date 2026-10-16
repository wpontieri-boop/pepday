# PepDay — escopo de conclusão aprovado em 16/10/2026

**Fonte oficial:** `AGENTS.md` + `docs/CURRENT-STATE.md`, repositório `wpontieri-boop/pepday`. Esta decisão substitui a interpretação de que Hostinger é pré-requisito para concluir o aplicativo principal. Ela **não** substitui proteções técnicas antes de funcionalidades reais sensíveis.

## Decisão expressa do proprietário
“**A única coisa que tá aguardando é o telefone do WhatsApp e os documentos que vão precisar pra contadora. Só isso que eu quero deixar pra trás, o resto eu quero fazer tudo, que a gente tem que terminar.**”

Interpretar como **somente duas dependências externas adiadas**: (1) número/conta Meta/WhatsApp e homologação/envio transacional real; (2) documentos e parâmetros fiscais/comprovação da contadora, incluindo retenção/calendário e ativação documental/repasse que dependam deles.

**NÃO interpretar** como permissão para publicar PROD, ativar flags reais de parceiros, enviar mensagens, coletar documentos, fazer repasses ou tornar invisíveis outras pendências técnicas. Trabalhar essas pendências técnicas agora, sem bloquear o núcleo do produto por integrações futuras.

## Quadro verificável de escopo

| Frente | Situação agora | Ação necessária |
|---|---|---|
| Calculadora, tutorial, rotinas, FREE/PRO, pagamentos/recovery, PWA, push, Auth/Admin/2FA, cartão/QR | Existem em versões aprovadas/publicadas; múltiplos PASS HUMANO / NÃO REPETIR | Preservar; retestar manualmente só se alteração futura atingir o fluxo |
| Landing, calculadora e guia na web pública | PROD release isolada `fc12b0a` LIVE, PASS humano registrado | Preservar release; manter anúncios reais OFF até aprovação/decisão autorizada |
| Segurança do build Windows | 635/635 testes automatizados PASS, `npm run build:test` PASS; commit `3d4f024` somente teste | Preservar; executar novas regressões apenas para novo delta |
| Backup de TEST DB+Storage | Pasta exclusiva Drive privada; manifesto OFF; ensaio sintético local PASS | **PENDENTE DE EXECUÇÃO REAL:** custódia de chave, credencial privada, exportação DB PG17 + bytes Storage, cópia cifrada, retenção, restore isolado e alertas |
| ClamAV/worker de documentos | Compose isolado preparado; nenhuma instalação operante na Hostinger | **PENDENTE DE EXECUÇÃO REAL:** caminho autorizado, assinaturas oficiais FreshClam, fail-closed, fila/Storage/ACL, QA operacional; mantém coleta real OFF |
| Chaves Google TEST/PROD | Restrições antigas e push aprovados no escopo; inventário recente sem console | Verificar restrições, API/quota e eventuais alertas com acesso autorizado; não rotacionar PROD no escuro |
| P3 parceiros, portal, financeiro, CSV e telas de documentação | Preparações e testes sintéticos em TEST, funções reais ainda gated | Concluir tudo que não depende das duas entradas externas; deixar envios/identificação real/repasse efetivo OFF |
| AdSense | Pedido em análise externa; 3 páginas novas com PASS | Aguardar resultado Google, sem novo pedido/alteração PROD/ads real por inferência |
| WhatsApp real Meta | **DEPENDÊNCIA EXTERNA ADIADA #1** | Aguardar número / parâmetros necessários; protótipo/QA offline mantidos |
| Documentos/parâmetros da contadora | **DEPENDÊNCIA EXTERNA ADIADA #2** | Aguardar documentação/decisões, sem fingir aprovação fiscal |

## Linha de corte de release
- Branch de desenvolvimento `v3.0-bloco-b` tem **127 arquivos diferentes** da release PROD isolada `fc12b0a` (comparação `git diff --name-only fc12b0a HEAD`, em 16/10/2026). Isso inclui documentação, migrations, funções, Admin/P3 e integrações TEST.
- Portanto, **proibido** publicar o HEAD de TEST como se fosse a release estável; só publicar candidato de escopo revisado, comparado ao PROD byte a byte, com rollback e autorização expressa do proprietário.
- Preservar `main`/V2.9 e os registros PASS/NÃO REPETIR. Commit documental usar `[skip render]`; não ativar deploy PROD/TEST por documentação.

## Inspeção sem repetição de QA humano
- Em 16/10/2026, PC CenterPhone: 12/12 respostas HTTP **HEAD 200** nos caminhos: PROD `/`, `/app/`, `/calculadora/`, `/guia-calculadora/`, `/admin/`, `/cartao/`, `/robots.txt`, `/sitemap.xml`, `/ads.txt`; TEST `/`, `/admin/`, `/site/admin/parceiros/financeiro/`.
- Isso demonstra existência HTTP, **não** cliques/logins reais, aprovação fiscal, proteção operacional, AdSense aprovado ou equivalência binária de publicação. Não repetir QA humano fechado para confirmar essas rotas.
- Render antes dessa decisão: TEST LIVE `40a9deb` em `srv-date0i6k1f9s73ft9vo0`; PROD LIVE `fc12b0a` em `srv-davto4tg1s2s73brihf0`. Nenhum deploy realizado neste checkpoint.

## Próxima ação curta
**Continuar a finalizar segurança/backup/testes com fluxo PC → GitHub → TEST, sem tocar Central IA nem produção.** Revisar diffs de qualquer funcionalidade candidata, manter somente WhatsApp e contadora como dependências externas adiadas, e preparar autorização específica antes de publicar PROD.
