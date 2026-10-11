# P3 Fiscal — recuperação do trabalho interrompido (10/10/2026)

## Fechamento técnico da pendência da migration — 11/10/2026

- No **Mac** sincronizado por fast-forward seguro a `cb3b264`, recuperou-se diretamente de `supabase_migrations.schema_migrations.statements[1]` do Supabase TEST a **migration ORIGINAL integral** `20261009211431 partners_p3_fiscal_test` (36.076 bytes; MD5 `cc707dc687f2a73bbd2912a2224d58e6` remoto e arquivo local **idênticos**).
- Arquivo restaurado no GitHub: `supabase/migrations/20261009211431_partners_p3_fiscal_test.sql`. É uma **restauração histórica**, não uma nova migration. **NÃO EXECUTAR / NÃO REAPLICAR NO TEST.** O texto original termina com quebra CRLF/linha vazia; esses bytes foram preservados deliberadamente para manter o MD5 original. A verificação de whitespace do Git foi aplicada aos demais arquivos, enquanto a integridade deste SQL foi verificada criptograficamente.
- Inclui guard TEST em Vault/URL, 3 tabelas, alterações em perfis e repasses, índices e constraints, RLS, grants, trigger imutável, bucket privado 5 MB e policy restritiva, funções e bloqueios fiscais. O antigo snapshot de funções ainda é útil para comparar assinaturas, mas NÃO precisa substituir a migration original.
- Verificações read-only no TEST: três tabelas RLS=TRUE; bucket `partner-documents-test` privado, `5242880` bytes e formatos PDF/PNG/JPEG; policy restritiva com `polpermissive=false`; trigger imutável ativo; `anon` sem EXECUTE nas RPCs fiscais; `partner_document_complete` executável exclusivamente por service_role; admins exigem contexto autenticado e guardas internos.
- Teste novo `node --test tests/partners-p3-fiscal-migration.test.mjs`: **3/3 PASS**, verificando MD5 e invariantes críticos. Nenhum PASS humano ou PDF sintético repetido, nenhuma mutação de banco/Edge feita.
- PROD não foi modificado. Não reaproveitar diretamente SQL com URL/bucket específicos de TEST. Requer plano de promoção, confirmação fiscal/contratual CPF/CNPJ e autorização expressa.

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
**Migration fiscal integral recuperada e preservada no repositório; pendência técnica de versionamento encerrada.** Se necessário, QA humano **somente da interface fiscal nova em TEST**, sem refazer login/Admin2FA/P1/P2 nem upload do PDF sintético aprovado. Definições CPF/CNPJ, retenções e prazo documental aguardam parecer contábil/jurídico. Para PROD, elaborar adaptação de ambientes/rollback e obter autorização expressa; não usar a migration TEST em PROD.
