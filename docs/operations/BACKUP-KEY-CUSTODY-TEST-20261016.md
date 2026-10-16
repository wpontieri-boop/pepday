# PepDay — procedimento de custódia de chave TEST (16/10/2026)

## Contexto e autorização
- Proprietário respondeu **“Pode seguir, segue”** à proposta de criar chave de recuperação AES-256 para backups PepDay TEST e guardá-la em cofre de senhas sob controle do proprietário.
- Essa resposta autoriza **preparar o gerador local seguro**, não fornece acesso ao cofre, não significa que o segredo tenha sido salvo e não autoriza descarregar dados reais, ativar PROD ou compartilhar a chave.
- Fonte oficial de continuidade: `AGENTS.md`, `docs/CURRENT-STATE.md`, `docs/operations/GOOGLE-DRIVE-BACKUP-TEST-20261015.md`.

## Interface local de custódia, sem tráfego externo
- Arquivo: `tools/security/pepday-backup-key.html` — **apenas no PC/checkout Git**, não vai no build TEST/PROD.
- `Content-Security-Policy` impede conexões/recursos externos; script local gera **32 bytes** via `crypto.getRandomValues` e codifica em **Base64url, 43 caracteres**.
- Chave nunca é impressa no console, em ferramenta remota, logs, histórico, URLs, Git, Drive, Supabase ou na conversa. A página não salva no storage do navegador/disco.
- O proprietário deve, **pessoalmente**, copiar a chave para o cofre de senhas que já controla sob o título `PepDay — Backup TEST — AES-256`. O item deve permanecer recuperável sem este PC; não enviar segredo ou screenshot.
- Clicando `Salvei no cofre — verificar`, a página apaga a chave do campo original e exige **recuperar o valor do cofre** para comparar localmente SHA-256 do valor; após confirmação, apaga o campo e mostra apenas fingerprint de 16 hex **não secreto**.
- O uso de clipboard deixa conteúdo acessível temporariamente ao Windows e aplicativos locais. Após salvar, limpar/substituir clipboard. A interface recomenda fazê-lo; NÃO automatizar leitura do clipboard a partir de ferramentas remotas.
- O instrumento só informa **PASS local de verificação** depois da ação do proprietário, não cria backup ou credencial de serviço. Se navegador for fechado antes de guardar chave, gere uma nova (nenhum backup real foi cifrado com ela).

## Garantias técnicas verificadas e limites
- `tests/backup-key-ceremony.test.mjs`: invariantes CSP offline, random criptográfico, digest, fluxo manual de verificação, ausência de upload/localStorage, formato roundtrip, exclusão do pacote TEST. **Evidência técnica desta etapa (PC CenterPhone):** 8/8 testes focais PASS; 652/652 regressão completa PASS; `npm run build:test` PASS; página ausente de `preview/`. A suíte **não prova** que o proprietário salvou no cofre.
- `.gitignore` atualizado para bloquear por padrão padrões de backup/dump/chave e pasta `private-backups/`. `git add -f` poderia contornar; revisar diff/segredos antes de commit.
- As chaves geradas nesta página são inteiramente privadas ao navegador do proprietário. Não persistir chave no repositório/servidor por automação.

## Status e gates
- **Chave real gerada?** NÃO CONFIRMADO até o proprietário clicar Gerar.
- **Cópia em cofre externo?** NÃO CONFIRMADO até o proprietário concluir comparação do valor recuperado do cofre.
- **Exportação DB PostgreSQL 17 TEST?** NÃO ATIVADA. O PC CenterPhone não possui `pg_dump`/`pg_restore`/CLI PostgreSQL17 no PATH; execução da exportação exige caminho credenciado e destino seguro.
- **Storage?** Duas buckets privadas, zero objetos no inventário anterior; inventário de bytes deverá ser refeito no momento do backup.
- **Google Drive:** pasta TEST privada `1eM-rWJoBTkhNrxfTVAhoJ0PfiY859XMO` (não colocar chave nela), ainda sem exportação criptografada.
- **Restauração real isolada?** NÃO PASS; requer alvo apartado de TEST/PROD, validação do DB e hashes do Storage, cron/webhooks/pagamentos desativados.
- **Central IA e PROD:** intocados. Apenas WhatsApp real e documentação/parecer da contadora foram adiados; backup permanece objetivo ativo.

## Próxima ação curta
**Proprietário abre a janela local do gerador, guarda a chave no próprio cofre, recupera-a no mesmo formulário e informa somente “Chave salva e verificada”.** Depois, preparar exportação PostgreSQL17 TEST e Storage com criptografia antes de enviar ao Drive, mais restauração isolada; não tratar posse da pasta/chave como backup pronto.
