# PepDay — proteção automática do escopo de release (16/10/2026)

**Objetivo:** continuar o fluxo aprovado PC/Mac → GitHub → homologação → produção somente quando o proprietário autorizar, sem promover acidentalmente a branch de desenvolvimento inteira. Não é novo ambiente, merge, deploy ou aprovação de produção.

## Resultado desta etapa
- Fonte oficial consultada: `AGENTS.md`, `docs/CURRENT-STATE.md` e `docs/operations/PEPDAY-CLOSURE-SCOPE-20261016.md`.
- PC CenterPhone em `v3.0-bloco-b`, `git fetch`, árvores e remoto sincronizados na base `4d9af388cb3d5e9ac52b9745dee4cf9171413ca0` antes da implementação.
- PROD Render `srv-davto4tg1s2s73brihf0`: commit aprovado `fc12b0a6271882097671373c6bd5ea8587f87f81` LIVE. TEST `srv-date0i6k1f9s73ft9vo0`: commit `40a9deb231677780b57d534d9de4af208c6658af` LIVE. NENHUM deploy realizado.
- Novo auditor read-only: `scripts/security/release-scope-audit.mjs`. Comando `node scripts/security/release-scope-audit.mjs --report`; compara arquivos pelo Git, usando base exata PROD. `--gate` encerra com código **3** para diferença funcional, de infraestrutura ou desconhecida. Relatório sempre traz `productionApproved:false` e `runInProduction:false`, inclusive se somente documentação mudou.
- O auditor não tem capacidade de executar deploy/merge/fetch nem lê segredos. Usa `git diff --name-only -z --no-ext-diff` para comparar commits, diferencia documentação/testes de runtime, infraestrutura/SQL e parceiros. Se não conseguir consultar a base Git, falha; não concede aprovação.
- **Inspeção inicial:** mais de uma centena de arquivos diferentes de PROD, incluindo módulos de parceiros, WhatsApp, documentos, migrations e infraestrutura: status **`BLOCKED_MIXED_RELEASE`**, como deve ser. Isso não significa bug no app; significa **não publicar branch TEST inteira em produção**.
- Novos testes do auditor em `tests/release-scope-audit.test.mjs` cobrem base exata, negação default, docs-only sem autoaprovação, caminhos de WhatsApp/documentos, SQL e infraestrutura, deduplicação, path traversal e diff real Git read-only. Guardas não substituem revisão de alterações, regressões, homologação e autorização de publicação.

## Inspeção atual Supabase TEST (somente metadados/agregados)
- Projeto `fsbqpyyprtymwrmzsacp`: `ACTIVE_HEALTHY`, PostgreSQL `17.6`.
- SQL agregada read-only: tamanho **25.513.107 bytes** (~24,33 MiB / ~25,5 MB), **2** buckets Storage e **0** objetos; não acessou linhas de usuários nem arquivos.
- Tamanho físico do banco **não representa** o tamanho de um `pg_dump` nem a consistência/validade de um backup. Plano Free continua sem prova de backup diário gerenciado; DB e bytes Storage devem ser protegidos/recuperados separadamente.
- Drive TEST `1eM-rWJoBTkhNrxfTVAhoJ0PfiY859XMO` continua somente destino de planejamento, sem exportação cifrada, credenciais de serviço, custódia de chave ou restore isolado operacional nesta etapa.

## Dependências externas adiadas somente por decisão do proprietário
1. Telefone Meta/WhatsApp e envio transacional real.
2. Documentos/parâmetros da contadora para fiscal P3.

**Demais pendências NÃO passam a ser opcionais:** backup DB+Storage cifrado e restauração comprovada, antivírus ClamAV com assinaturas oficiais se documentos reais forem ativados, revisão Google Cloud e preparação de release isolada. Persistem como NÃO PASS operacional até evidência válida. Não liberar coleta real/documentos, PIX/repasse, Meta ou Ads por interpretação desta documentação.

## Próxima ação objetiva
**Preparar e executar caminho seguro de backup TEST** após custódia da chave e alvo de restauração isolado definidos; manter gates OFF até prova DB+Storage e RESTORE. Depois revisar o conjunto mínimo de diferenças do próximo release, continuar testes em TEST e pedir autorização específica de PROD.
