# PepDay — destino de backup Google Drive TEST (preparado, não ativado)

Data: 15/10/2026 (Brasília). Escopo: apenas infraestrutura **PepDay TEST**, independente da Central IA — WP GROUP, e sem acesso a PROD.

## Decisão do proprietário
O proprietário confirmou a separação integral dos projetos e autorizou continuar a preparação do backup externo criptografado no **Google Drive existente**. O computador da loja destinado à Central IA poderá futuramente servir como segundo local de cópia, mas **não foi configurado, montado nem acessado para backup do PepDay**. A VPS Hostinger já existente serve somente como processamento privado e temporário de antivírus/backup; não usar `central-postgres`, Compose, redes, pastas ou volumes da Central.

## Drive — comprovações diretas
- Conta Google Drive autenticada: conta pessoal do proprietário; não registrar senha, token OAuth ou outros segredos no repositório.
- Armazenamento total **400 GB**, utilizado **195,19 GB**, livre aproximado **204,81 GB**, conforme print fornecido pelo proprietário em 15/10/2026. É um snapshot humano e não uma quota garantida na data de cada backup.
- Criada pasta exclusiva no Meu Drive: **`PepDay — Backups Criptografados — TEST`**.
- ID não secreto: **`1eM-rWJoBTkhNrxfTVAhoJ0PfiY859XMO`**.
- URL: https://drive.google.com/drive/folders/1eM-rWJoBTkhNrxfTVAhoJ0PfiY859XMO .
- `get_file_metadata` do Google Drive: pasta pessoal `shared=false`, única permissão retornada `type=user,role=owner`. `list_folder`: **0 arquivos**. Nenhum upload ou compartilhamento.
- **Limite:** permissões atuais da pasta não substituem criptografia; a conta pode mudar permissões/quotas; verificar no momento da operação.

## Manifesto inerte preparado
`infra/hostinger-security-test/backup-target.test.json` contém **somente IDs não secretos, políticas e gates**. Não é lido por serviço operacional. Defaults: execução, exportação DB, exportação Storage, uploads, agendamento, restauração e acesso PROD todos **OFF**. Exige AES-256-GCM pré-upload, SHA256/manifest e guarda de segredo **fora** de Google Drive, GitHub e VPS.

Testes **novos** exclusivos do manifesto em `tests/hostinger-backup-target.test.mjs`: 6/6 PASS. Essa prova de configuração **não comprova** backup real, upload, criptografia efetivamente executada, recuperabilidade, atualização de assinaturas ClamAV ou integração entre plataformas. Nenhuma validação humana PASS / NÃO REPETIR anterior foi repetida.

## Ativação ainda bloqueada
1. **Custódia: PASS HUMANO / NÃO REPETIR em 16/10/2026, PC CenterPhone**, conforme [registro da chave](BACKUP-KEY-CUSTODY-TEST-20261016.md): proprietário gerou, salvou no cofre e recuperou pela tela “Conferência local concluída”. Sem segredo/fingerprint registrado. Recuperabilidade após perda do PC não foi testada separadamente; não solicitar nova cerimônia da chave. Posse confirmada não libera exportação ou restore.
2. Definir integração Drive **de menor privilégio** em serviço privado, com fluxo OAuth/credencial técnica segregado e token protegido fora de Git; **o login do usuário no conector do ChatGPT não implica acesso de serviço/automações na Hostinger**.
3. Determinar cron, retenção, verificação de quota e alertas de falha; nenhuma duração foi aprovada ou configurada.
4. Confirmar backup lógico da instância **Supabase TEST** (Postgres 17.6) com autenticação exclusiva, mais backup dos **bytes** de objetos Storage e metadados; não usar Postgres da Central e não coletar documentos reais.
5. Configurar destino de restauração **separado** do TEST em uso e da PROD; confirmar restore de prova e hashes após exportação criptografada completa, mantendo o original intocado. Sem alvo autorizado, nenhum dump REAL a serviço externo.
6. Scanner ClamAV TEST Hostinger continua sem contêiner iniciado: comando de criação anteriormente bloqueado pela ferramenta `Command not allowed`. Respeitar bloqueio; não tentar contornar, não marcar ClamAV/backup como operacionais.

## Próxima ação explícita
**Viabilizar PostgreSQL 17, credenciais protegidas e destino de restauração isolado autorizado**, seguindo [preparação 16/10](BACKUP-TEST-PREPARATION-20261016.md). Configurar acesso Drive de menor privilégio e provar backup TEST + Storage/restauração. ClamAV continua pendente sob caminho permitido, sem tocar Central IA; não repetir custódia PASS.
