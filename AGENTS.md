# AGENTS.md — Regras de trabalho e sincronização

## Regra de sincronização — PC da loja + MacBook
Este projeto é trabalhado alternadamente em dois computadores: PC da loja e MacBook.
Cada computador mantém uma cópia local do projeto, e o GitHub é a fonte central de sincronização.

## Antes de iniciar qualquer trabalho
- Verificar a branch atual.
- Verificar se existem alterações locais não enviadas.
- Consultar o repositório remoto.
- Atualizar a cópia local antes de modificar arquivos.
- Nunca começar novas alterações sobre uma versão desatualizada.
- Quando o usuário disser “vamos continuar”, “vamos trabalhar”, “continuar o projeto” ou equivalente, executar essa verificação antes de alterar o código.

## Ao encerrar a sessão
- Revisar as alterações realizadas.
- Verificar erros ou arquivos acidentalmente incluídos.
- Confirmar que não existe conflito remoto.
- Fazer commit com descrição clara.
- Fazer push para o GitHub.
- Confirmar ao usuário que o projeto ficou sincronizado.
- Quando o usuário disser “terminei por hoje”, “vamos parar”, “encerrar por hoje” ou equivalente, executar este procedimento.

## Segurança
- Nunca enviar ao GitHub `.env`, tokens, senhas, credenciais, chaves privadas, chaves do Supabase, Mercado Pago ou qualquer outro segredo.
- Se houver divergência entre PC, Mac e GitHub, não sobrescrever arquivos automaticamente.
- Comparar as versões, preservar o trabalho existente e resolver a divergência antes de continuar.

## Produção e branches
- Não alterar branch de produção, publicar ou fazer merge sem autorização explícita quando houver ambiente de produção separado.
- Preservar versões estáveis e ambientes de teste já aprovados.

## Objetivo operacional
Permitir que o usuário encerre o trabalho em um computador e continue no outro exatamente do mesmo ponto, mantendo GitHub e ambas as máquinas consistentes.
