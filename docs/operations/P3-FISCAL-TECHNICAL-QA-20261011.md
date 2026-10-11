# P3 — QA técnico fiscal TEST — 11/10/2026

## Escopo e recuperação
Mac /Users/mdc/Projects/pepday, branch v3.0-bloco-b; fetch inicial confirmou HEAD=origin=fe0f673, divergência 0/0 e árvore limpa. Nenhuma alteração anterior não commitada estava presente. AGENTS.md, CURRENT-STATE.md e operações P3 foram consultados. Preservados todos os PASS HUMANO / NÃO REPETIR, inclusive PDF privado; não foram repetidos login humano, CNPJ ou upload PDF.

## Backend real — PASS técnico, rollback
Supabase TEST fsbqpyyprtymwrmzsacp. Contratos RPC e guardas reais foram inspecionados antes da execução de supabase/tests/partners_p3_fiscal_cpf_assertions.sql. Migration fiscal já aplicada foi apenas conferida, não reaplicada; Edge/Storage/configuração não alterados.

Fixture CPF: sequência deliberadamente inválida de 11 zeros inserida somente no perfil privado sintético dentro da transação. Isso prova classificação estrutural CPF, não identidade, checksum ou validação cadastral P1. Usuário sintético @example.invalid e sessão SQL descartável; claims AAL2/step-up simuladas para os testes, sem alterar senha, TOTP ou associação OWNER existente.

PASS: CPF reconhecido; pendente e bloqueado; aprovação incompleta recusada; configuração de retenção inválida recusada; aprovação de documento sem arquivo armazenado recusada; documento fiscal sem lote recusado; replay de ticket recusado; comissão sintética não liberada; reserva e confirmação de lote bloqueadas por pendência fiscal; AAL1, step-up vencido e sessão desconhecida recusados; privilégios anon/authenticated restritos. Política e referências estritamente sintéticas, sem alíquota tributária ou prazo fiscal inferidos; comissão sintética não representa tributo. Nenhum provedor financeiro ou transferência foi acionado.

ROLLBACK completo. Contagens antes/depois: usuários 17, sessões 13, parceiros 2; perfis fiscais, documentos, eventos fiscais, pagamentos, comissões, lotes e ledger 0. Digests dos parceiros/perfis privados, memberships e guardas centrais iguais antes/depois. Não ficaram registros sintéticos permanentes.

## Defeito novo e correção mínima
Browser reproduziu botão habilitado ao selecionar Contrato sem arquivo/motivo. fiscal.mjs agora exige arquivo não vazio, MIME permitido, limite 5 MiB e validade dos campos obrigatórios, inclusive lote quando necessário; recalcula em input/change e após limpeza de arquivo por visibilitychange. Estado inicial vazio e reset preservados. Cache fiscal.mjs v5; CSS v4 sem mudança. Nenhuma alteração de backend, autenticação ou pagamentos.

## Interface — PASS técnico
scripts/test-partners-p3-fiscal-readiness-ui.mjs: Chrome automatizado em contextos isolados, viewports efetivamente 390×844 e 1280×900. Auth/RPC interceptados com fixture; zero escrita de backend. Arquivo PNG em memória usado só na seleção local, sem upload/Storage.
Todos os cinco checkboxes do formulário e Sem retenção no modal: caixa 20px, legenda à direita, diferença vertical central 0px. Sem overflow horizontal ou erro JS. Seleção inicial e após Atualizar vazias; envio bloqueado sem tipo/arquivo/motivo/lote e com MIME inválido. Categorias Contrato/Documento fiscal/Recibo/Comprovante de repasse verificadas. Não é PASS humano nem autenticação E2E.

## Verificação
Sintaxe JS PASS; testes focais fiscais 13/13 PASS; npm test 496/496 PASS (0 falha/skip); npm run build:test PASS; git diff --check PASS. Evidências locais ignoradas: test-output/fiscal-regression-20261011.log, fiscal-qa.json e screenshots fiscal-qa-390.png/fiscal-qa-1280.png. Deploy TEST `dep-db5stnuk1f9s73engm10` LIVE em 11/10/2026 18:01:24 UTC, commit `e96d5d238c8cdc9fd2229a4ac16a7f6944705772`. Oito arquivos em ambos aliases com HTTP 200 e SHA256 iguais ao build (LF/CRLF normalizados). Runner no frontend publicado PASS em 390×844 e 1280×900, zero escrita/erro JS; evidências `test-output/fiscal-integrity-live.json`, `fiscal-qa-live.json` e screenshots com sufixo `-live`. PROD permanece no deploy anterior `dep-db4gualg1s2s739d8sn0`, commit `166de8f`. Fechamento documental usa `[skip render]` para preservar o deploy técnico validado.

## Pendências e próxima ação
Parecer contábil/jurídico real continua pendente: regras CPF/CNPJ, documentação, retenções, alíquotas aplicáveis, fundamento legal, marco inicial e prazo de guarda. Não há aprovação jurídica/contábil. Manter repasses bloqueados até documentação e validação fiscal. Próxima ação: obter decisões formais contábeis/jurídicas e configurar/validar em TEST numa etapa autorizada. PROD/main/V2.9/P1/P2 e pagamentos reais intocados.
