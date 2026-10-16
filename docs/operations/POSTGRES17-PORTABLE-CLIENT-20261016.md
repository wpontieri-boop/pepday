# PepDay — PostgreSQL 17 portable no PC CenterPhone (16/10/2026)

## Continuidade e decisão do proprietário
- Recuperados `AGENTS.md` e `docs/CURRENT-STATE.md` do GitHub, mais `docs/operations/BACKUP-TEST-PREPARATION-20261016.md`, antes de qualquer alteração. Branch oficial `v3.0-bloco-b`; `git fetch`, HEAD=origin `40273c021e70089f877972696662ca850866dd77`, divergência **0/0**, árvore limpa no PC antes deste trabalho.
- Proprietário informou explicitamente nesta conversa que **a única cópia da chave de recuperação TEST está numa mensagem privada para si no WhatsApp; NÃO existe cópia em papel nem cofre de senhas independente**. Optou por manter assim por enquanto. **A verificação da chave recuperada continua PASS HUMANO/NÃO REPETIR**, mas custódia resiliente a comprometimento/perda de WhatsApp **NÃO COMPROVADA**; não apresentar armazenamento em WhatsApp como cofre seguro, não exigir que o proprietário repita teste. Não ler, copiar, exportar ou utilizar a chave neste trabalho.
- Autorização para continuar o PepDay: preparar ferramentas técnicas e testes não sensíveis. Não interpretar como autorização para dump de dados, uso de chaves reais, backup definitivo, novo custo, acesso PROD, WhatsApp real, documentos reais ou ativação da Central IA.

## Instalação portátil realizada no PC da loja
- Ambiente: Windows x64, usuário **não administrador**, `winget` existente. Nenhum servidor PostgreSQL, serviço Windows, instalador MSI/EXE ou daemon foi iniciado.
- Origem: arquivo binário oficial EnterpriseDB do PostgreSQL 17 `postgresql-17.11-3-windows-x64-binaries.zip`, HTTPS `https://get.enterprisedb.com/postgresql/postgresql-17.11-3-windows-x64-binaries.zip`; SHA-256 publicado pela equipe da EnterpriseDB na issue [edb-installers #682](https://github.com/EnterpriseDB/edb-installers/issues/682): `4b8db0930c38f6ef845db919551dedda3b6b845aeb0927b3d79a6e8e9e4537cf`.
- Download completo de **341.325.378 bytes**, hash local SHA-256 correspondeu exatamente ao hash do fornecedor **antes da extração**.
- Somente o subdiretório `pgsql/bin` do ZIP foi extraído para `%LOCALAPPDATA%\\PepDay\\tools\\postgresql-17.11\\pgsql\\bin` (~74,9 MiB). A pasta contém bibliotecas e outros binários do ZIP, sem inicialização de banco. Não foi acrescentada ao PATH global/sistema/usuário; ao usar, passar caminho explícito ou acrescentar ao `PATH` apenas do processo atual. ZIP original temporário removido após conferir executáveis.
- Binários verificados localmente **por execução `--version`, sem conexão**:
  - `pg_dump.exe = pg_dump (PostgreSQL) 17.11`
  - `pg_restore.exe = pg_restore (PostgreSQL) 17.11`
  - `psql.exe = psql (PostgreSQL) 17.11`
  - `pg_dumpall.exe = pg_dumpall (PostgreSQL) 17.11`
- `Get-Process -Name postgres` confirmou **zero processos de servidor** no instante da inspeção. Não foram consultados bancos, arquivos de credenciais, clipboard nem o cofre/WhatsApp.

## Preflight do PepDay confirmado
- Com somente um `PATH` temporário para o comando de inspeção, `node scripts/security/backup-test-preflight.mjs` retornou **exit 3** (esperado), `status=BLOCKED_PREPARATION_ONLY`, `executionAllowed=false`, **zero** bloqueios `POSTGRES17_*`.
- Permanecem em aberto, sem qualquer mudança de flags:
  1. `PROTECTED_TEST_CREDENTIALS_NOT_VERIFIED`
  2. `ISOLATED_RESTORE_TARGET_NOT_AUTHORIZED`
  3. `STORAGE_EXPORT_NOT_IMPLEMENTED`
  4. `ENCRYPTED_DRIVE_ROUNDTRIP_NOT_PROVEN`
  5. `REAL_RESTORE_NOT_PROVEN`
  6. `SCHEDULE_RETENTION_ALERTS_NOT_CONFIGURED`
- TEST Render LIVE `40a9deb`, PROD Render LIVE `fc12b0a` conferidos nesta sessão. Nenhum deploy, migração, criação de servidor, serviço ou instalação na Hostinger ou projeto externo. Focados `tests/backup-test-preflight.test.mjs` + `tests/hostinger-backup-target.test.mjs` **12/12 PASS** e `git diff --check` PASS. Os 658/658 testes anteriores permanecem registrados como PASS, sem repetição de QA humano nem regressão integral de código não modificado.

## Limites e próxima ação
- PostgreSQL 17 **CLIENTE** disponível, mas isso **não** é um backup, não é licença para conectar a Supabase e não configura restauração.
- **Não executar exportação/backup definitivo usando a chave que está somente no WhatsApp**. A escolha do proprietário de manter a chave lá é respeitada para fins de preparação técnica; antes de cifrar dados que precisem ser recuperados, propor custódia independente resiliente a perda/comprometimento e confirmar recuperação da cópia independente sem exigir novo teste do algoritmo.
- **Próxima ação curta:** identificar e validar um alvo de restauração isolado/testável, sem custo novo e sem reutilizar Central IA; preparar exportação sintética/contrato de Storage antes de solicitar acesso privado TEST; manter envio Drive e operações sobre dados reais desligados até guards.
