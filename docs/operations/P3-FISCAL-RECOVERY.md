# P3 Fiscal — recuperação do trabalho interrompido (10/10/2026)

## Estado e escopo
- **Exclusivamente TEST** no Supabase `fsbqpyyprtymwrmzsacp`. Nenhuma autorização para PROD.
- GitHub oficial antes da recuperação: branch `v3.0-bloco-b`, HEAD `a796db1`, 0/0, árvore limpa.
- Cópia isolada: `C:/Users/wagne/Documents/PepDay-P3-Fiscal-Recovery`, branch `recovery/p3-fiscal-test`, sem sobrescrever o checkout oficial.
- A sessão Work original desapareceu; seus arquivos não commitados da interface não foram localizados. **A interface desta branch foi reconstruída**, não recuperada literalmente.
- O armazenamento privado com PDF sintético (upload/leitura/403 público/remoção) foi relatado PASS pelo Work anterior; não foi repetido nesta recuperação. Helper de prova aposentado (resposta 410 relatada).
- Migration TEST remota **20261009211431 partners_p3_fiscal_test** já aplicada — **NÃO REAPLICAR**.
- Edge `partner-documents` v1 ativa e seus dois fontes recuperados do Supabase live para `supabase/functions/partner-documents/`. Bucket privado `partner-documents-test`, limite 5 MB, PDF/PNG/JPEG. Não converter a Edge de TEST em versão PROD.
- `P3-FISCAL-FUNCTIONS-TEST-SNAPSHOT.sql` é **referência das funções live** somente. **NÃO EXECUTAR COMO MIGRATION**. Não contém schema completo, grants, políticas RLS, triggers nem regras de storage.
- Para eventual reconstrução de ambiente/promoção PROD, é obrigatório recuperar/validar migration fiscal completa e comparar com o schema remoto antes de qualquer aplicação. Não assumir que este snapshot basta.

## Interface fiscal reconstruída em branch isolada
- Rota TEST: `/admin/parceiros/fiscal/` e alias `/site/admin/parceiros/fiscal/` via build TEST.
- Seleção inicial do tipo de documento é **sempre vazia**: opção placeholder desabilitada, campo obrigatório, submit bloqueado enquanto tipo/lote não for explícito.
- CPF/CNPJ somente leitura a partir do cadastro existente; não criar um segundo cadastro de identidade.
- `admin_partner_fiscal` consulta status, documentos e lotes. `admin_partner_fiscal_action` usa `admin_prepare_partner_finance` após senha + novo TOTP; ticket vinculado ao payload/ator/sessão e consumido uma vez.
- Contrato vinculado ao parceiro, fiscal/recibo/comprovante vinculados a lote reservado; upload e download privados via Edge.
- Perfil fiscal `pending/divergent/approved`, retenção por tipo (`validated`, `legal_basis`, `start_event`, `months` opcional) e referências contábil/contratual sem defaults jurídicos.
- Lote fiscal `pending/divergent/approved`, valor retido em centavos informado pela contabilidade e valor líquido calculado pelo banco; nenhum tributo ou alíquota presumidos.
- OWNER opera com MFA recente, ADMIN/VIEWER consultam sem dados privados. Sem pagamento automático.
- Arquivos: `site/admin/parceiros/fiscal/index.html`, `fiscal.mjs`, `fiscal.css`, link TEST de `site/admin/parceiros/financeiro/index.html`, runner isolado `scripts/test-partners-p3-fiscal-ui.mjs`.

## Validação técnica e publicação em TEST (10/10/2026)
- Código recuperado em `recovery/p3-fiscal-test` e commit `db33996` (0/0, limpo); fast-forward seguro desse commit à branch oficial `v3.0-bloco-b`, push/fetch sincronizado.
- **PASS técnico novo:** sintaxe JS, `npm run build:test`, testes focados 4/4 e `npm test` **487/487**, zero falhas e zero skips após atualização da interface.
- **PASS browser sintético isolado:** Chrome 12/12 e Edge 12/12, OWNER/ADMIN/VIEWER × ambiente TEST/PROD bloqueado × 390×844/1280×900; toda requisição interceptada. Escolha do documento inicialmente vazia, tipo e lote obrigatórios, refresh, TOTP inválido/retry e nenhuma escrita sem confirmação; sem overflow nem erro JS.
- **TEST LIVE:** deploy Render `dep-db4rmo8ae00c7393r4ng` do commit `db33996`; oito artefatos HTML/JS/CSS, incluindo dois aliases, em `https://homologacao.pepday.com.br` responderam HTTP200 e apresentaram SHA256 igual ao build local (normalizado CRLF/LF).
- Não houve nova migration, Edge deploy, transferência, cobrança, documento real ou fixture persistente. PASS anterior do PDF sintético permanece válido e não foi repetido. Smokes no navegador foram **sintéticos**, não autenticação OWNER humana nem E2E de uploads.
- Revisão fiscal/contábil e contratual **não homologada**. Nunca aprovar automaticamente retenção ou prazo de guarda. **PROD/main/V2.9 preservados**, auto-deploy PROD OFF.

## Próxima ação
Completar a recuperação da migration fiscal integral (schema/tabelas, RLS, grants, triggers e storage) para permitir reprodução fiel em outro ambiente, antes de qualquer promoção para PROD. Se necessário, QA humano **somente da interface fiscal nova em TEST**. Definições CPF/CNPJ e retenção aguardam parecer contábil/jurídico. PROD exige autorização específica.
