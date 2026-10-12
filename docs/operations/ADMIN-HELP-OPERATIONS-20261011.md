# PepDay — Central de Ajuda e Manual Operacional Admin
**Data:** 11/10/2026 · **Branch:** `v3.0-bloco-b` · **Escopo:** documentação e nova Central de Ajuda no **TEST**; nenhuma alteração permitida em PROD/main/V2.9.

## Nova visualização exclusiva, autorizada e tecnicamente validada — 11/10/2026

O proprietário autorizou separar a Central de Ajuda do longo rodapé do Dashboard. Em TEST, a implementação `#adminHelpView` dentro do `/admin/` abre com `?view=ajuda` somente após autenticação administrativa AAL2 e perfil OWNER/ADMIN/VIEWER; botão `← Voltar ao painel`, busca, impressão e 12 guias mantidos. O JavaScript de Ajuda não executa login, `signOut` ou RPC novo. URL externa ou `?view=ajuda` **não autoriza** o conteúdo se a sessão não estiver autenticada.

PASS técnico: 22/22 regressão focada Admin/Ajuda/equipe, 505/505 suíte total, build TEST e revisão diffs. Manual Word revisado para v1.1, com explicação da nova visualização. **NÃO classificar PASS HUMANO/PROD sem verificação adicional.** Próxima ação: publicar TEST, conferir artefatos e solicitação de observação exclusiva do layout novo, não do fluxo 2FA já aprovado.

## PASS HUMANO / NÃO REPETIR da navegação atual — 11/10/2026 (TEST)

O proprietário confirmou espontaneamente: “agora deu certo, tá abrindo aqui”, após clicar no botão `Central de Ajuda` já corrigido. Também descreveu corretamente que o botão mantém o painel na mesma página e rola até a ajuda no rodapé. Isso fecha **somente a validação humana do clique sem novo login/saída**, em homologação no deploy `dep-db625ic9v7es739ka55g` / commit `e14de84`. **NÃO REPETIR** sem mudança que afete esse fluxo; não inferir aprovação humana de impressão, busca e outras telas.

### Possível evolução de layout, ainda aguardando autorização

O proprietário questionou se uma seção longa no rodapé pode prejudicar o painel e sugeriu central separada. Recomendação técnica: rota exclusiva, protegida e acessível pelo Admin, por exemplo `/admin/ajuda/`, preservando 12 guias, busca, impressão, filtros OWNER/ADMIN/VIEWER, sessão/admin ACL, botão **Voltar ao painel** e sem pedir outra senha/2FA em navegação normal. **Não implementada**: aguardar aprovação para mudar UX e então homologar somente o novo fluxo. Nenhuma mudança deve alcançar PROD/main/V2.9.

## Correção focada do atalho pós-2FA — 11/10/2026 (TEST LIVE)

- Usuário relatou retorno indevido ao login ao clicar `Central de Ajuda` logo após o 2FA.
- Corrigido no PR [#1](https://github.com/wpontieri-boop/pepday/pull/1), merge commit `e14de84560fe580f0f43d234fc46dbe7a805c0fb`: após AAL2, `authStage('dashboard')` limpa desafio de histórico; o botão Ajuda executa somente `scrollIntoView`, sem mudança de fragmento, histórico ou sessão. Cache-busting `admin.mjs?v=38` e `admin-help.mjs?v=2`.
- Testes novos e focados Admin/Ajuda/roles **21/21 PASS**, incluindo validação dinâmica com estado MFA simulado, `node --check`, build TEST e `git diff --check`; suíte total paralela 502/503 com uma falha concorrente em replay B2.2-C **não alterado**; teste desse arquivo isolado 14/14 PASS. Não registrar suíte total como 100%. Chrome headless sintético não iniciou em 20s, portanto **browser não validado automaticamente**.
- Deploy Render TEST **`dep-db625ic9v7es739ka55g` LIVE** e SHA-256 10/10 assets iguais ao build (index, admin.mjs, help.mjs, data.mjs e CSS nos aliases `/admin/` e `/site/admin/`). Produção `166de8f` intocada. Sem novas permissões nem supressão da validação 2FA.
- **PASS HUMANO da correção ainda PENDENTE**: pedir somente a observação específica de um clique no botão Central de Ajuda após acesso Admin TEST; não repetir login/2FA fiscal ou demais PASS anteriores. Manual Word já descreve a Ajuda como seção interna, portanto texto não precisa mudar.
- **Próxima ação:** registrar PASS HUMANO do clique novo se o proprietário confirmar, então retomar portal de parceiros/relatórios após parecer contábil.

## Decisão aprovada pelo proprietário
A Central de Ajuda é o padrão de treinamento operacional do PepDay: navegação no próprio Admin autenticado, busca por assunto, guias específicos por perfil de acesso (OWNER/ADMIN/VIEWER) e impressão. O Word **PepDay_Manual_Operacional_Admin_2026-10-11.docx** serve como material editável de treinamento e checklist impresso; a continuidade técnica permanece no GitHub (`AGENTS.md` + `docs/CURRENT-STATE.md`).

**Não expor `AGENTS.md`, `CURRENT-STATE.md`, migrations, variáveis internas ou segredos para funcionários.** A central contém apenas instruções operacionais sem dados pessoais. Não substituir autenticação/permite roles com instruções UI.

## Implementação da Central de Ajuda — TEST
- Integrada em `site/admin/index.html` **dentro** de `#dashboard.hidden`, acessível por atalho "Central de Ajuda" depois do login Admin; não cria nova página pública nem desativa qualquer controle existente.
- `site/admin/admin-help-data.mjs`: 12 tópicos de documentação em português, com títulos, categorias, situação (“Disponível”, “Somente homologação”, “Planejado”) e filtro de papéis. Parte disponível: login/2FA, painel, cartão/QR, cupons conforme permissão, cadastro P1/P2, configuração financeira do OWNER, equipe; P3 financeiro/fiscal explicitamente **TEST**; convite WhatsApp e relatórios contábeis explicitamente **planejados**.
- `site/admin/admin-help.mjs`: busca tolerante a acentos/caixa, contagem, expandir tópicos, botão Limpar, botão Imprimir e restauração do estado de busca/expansão após a impressão. O conteúdo renderizado usa `textContent` (nenhum HTML de origem externa).
- `site/admin/admin-help.css`: visual dark premium existente e A4 para impressão; conteúdo impresso limitado à central, com tópicos permitidos ao papel da sessão.
- `tests/admin-help.test.mjs`: testes novos de integração ao dashboard, cobertura, status, filtro OWNER/ADMIN/VIEWER, busca com acentos, impressão e ausência de HTML dinâmico inseguro.
- **Limite de segurança:** o catálogo estático contém somente material de treinamento não sensível; filtro por papel é auxílio de UX, **não mecanismo de autorização**. As permissões reais continuam no backend e no Admin atual. Nenhuma credencial, CPF, PIX real, arquivo fiscal ou dado de assinante incluído no guia. Uma rota que distribui arquivos estáticos não pode garantir sigilo do próprio texto; procedimentos confidenciais/segredos não pertencem a esses arquivos.

## Princípios de conteúdo
1. Descrever somente telas e botões realmente presentes no ambiente correspondente.
2. Não prometer como publicado o WhatsApp do parceiro, a área privada de upload, os lembretes D+2/D+5, os novos relatórios pré/pós para a contadora, a matriz fiscal nem P3 PROD.
3. Cadastro presencial P1/P2: rascunho não envia convite nem atribui clientes; OWNER confere perfil financeiro e ativa; código público ≠ convite privado.
4. Promoções: cortesia de 30/60/90 dias ≠ cartão/QR de 30 dias; benefício gratuito ≠ receita paga.
5. P3: só TEST; repasse manual OWNER fora do PepDay, guardas financeiros e fiscais mantidos; não emitir NFS-e/RPA.
6. Retenção, tributos, data de fechamento e a hipótese de pedir documentos dez dias antes aguardam parecer da contadora em 13/10/2026 e revisão jurídica.
7. Ao alterar funcionalidade, atualizar guia/Word e `CURRENT-STATE.md` no mesmo ciclo, com evidência e sem repetir PASS HUMANO / NÃO REPETIR.

## Treinamento sugerido
A equipe deve estudar: (a) segurança e papéis, (b) leitura dos indicadores, (c) QR/código de indicação, (d) cadastro de parceiro no ambiente apropriado, (e) promoções autorizadas. Responsáveis financeiros OWNER estudam adicionalmente comissão, conferência fiscal e auditoria. Manual impresso deve ter versão/data; recolher versões antigas após mudanças.

## Critérios técnicos e aceite
- Testes focados da Central e regressão das áreas afetadas, `npm run build:test`, `git diff --check`, sem segredos/arquivos indevidos.
- TEST: confirmar deploy Render LIVE para commit técnico, rota `/admin/` e alias `/site/admin/` com hashes HTML/CSS/JS/data idênticos ao build TEST. Verificar a integridade do Admin e que o dashboard continue oculto até login.
- Validar em navegador apenas novo fluxo de ajuda, busca, status, responsividade e impressão, quando houver harness disponível; **não repetir login/2FA, cartão, P1/P2, CPF/CNPJ, Storage ou demais PASS anteriores**.
- NOVO PASS **HUMANO** de clareza/legibilidade requer captura específica posterior do usuário; automatização não equivale a prova humana.

## O que ainda impede o fechamento de toda a operação
- Receber orientação da contadora sobre documentação CPF/MEI/CNPJ e obrigações pré-pagamento; revisão jurídica do contrato e LGPD.
- Construir e homologar convite privado de parceiro e preenchimento no celular, lembretes WhatsApp (sem disparos reais não autorizados), isolamento de sessão/Storage e workflow de documentação.
- Construir e homologar exportação de relatório pré/pós-pagamento, com campos aprovados pela contadora.
- Definir calendário após parecer, proceder com aprovação humana de UX nova, elaborar promoção/rollback P3 e receber autorização expressa para PROD.
- **Próxima ação:** após o parecer da contadora, especificar e executar em TEST o portal do parceiro e relatórios contábeis, mantendo P1/P2/PROD intactos. A Central de Ajuda em TEST é uma entrega separada; não declarar encerramento integral do P3.
