# PepDay — antivírus privado na Hostinger (TEST; **não implantado**)

Última revisão: 15/10/2026 (Brasília). Fonte operacional: `AGENTS.md`, `docs/CURRENT-STATE.md`, `docs/operations/HOSTINGER-SECURITY-CAPACITY-20261015.md`.

## Limites aprovados
A VPS Hostinger já hospeda a **Central IA — WP GROUP**. O proprietário autorizou usar a capacidade ociosa **somente para o antivírus e o backup do PepDay**, desde que a Central não seja modificada nem degradada. Não existe autorização para criar serviços públicos, integrar documentos reais, fazer deploy PROD, compartilhar PostgreSQL, volumes, segredos, redes ou diretórios da Central.

O `compose.yaml` define **um único serviço** `pepday-clamav-test`, nome de projeto `pepday-security-test`, imagem oficial ClamAV 1.5.4 fixada por digest, rede bridge e volume de assinaturas **exclusivos**, sem portas publicadas, CPU máxima 0,75 vCPU, RAM máxima 4 GiB, sem swap acima do limite de RAM, 128 PIDs, `no-new-privileges`, capabilities reduzidas e limites de log 5 MiB × 2. Nenhuma montagem do host ou da Central.

**Isso é uma configuração candidata, não um serviço operacional.** A imagem já está no cache da VPS, mas pode conter assinaturas desatualizadas. O uso de capabilities reduzidas e o ciclo de atualização de assinaturas devem ser confirmados no runtime; caso a imagem falhe ao iniciar, não remova guardas nem mude serviços da Central por conta própria. A rede bridge separada não é garantia de bloqueio absoluto de acesso a serviços do host; controles de egress/ingress exigem verificação específica.

## Verificações realizadas nesta etapa
- `node --test tests/hostinger-security-compose.test.mjs` no Mac: **6/6 PASS NOVOS**, somente análise do manifesto; não são testes previamente aprovados repetidos.
- Na VPS, `docker compose -f - config --quiet` recebendo o arquivo local por stdin: **PASS de sintaxe/estrutura**, leitura apenas, sem criar ou alterar contêineres.
- **NÃO feito:** `docker compose up`, scanner residente, FreshClam oficial, EICAR na VPS, API upload, Storage, backup DB/Storage ou restore. O bloqueio anterior de criação via Remote Desktop Commander continua registrado; não contorná-lo.

## Condições para ativar em acesso legitimamente autorizado
1. Confirmar novamente GitHub/branch limpos, 7/7 serviços `central-*` healthy, memória/carga/disco, e nenhuma alteração em Docker Compose/daemon/rede da Central.
2. Implantar **somente o manifesto PepDay** em diretório e projeto exclusivos por mecanismo de implantação permitido, sem portas ou mounts extras, e com rollback limitado a esse serviço.
3. Observar limite real de RAM/CPU, saúde do contêiner e logs. Validar atualização **oficial** via FreshClam; tratar DB ausente, vencida, falha HTTP 403 ou worker indisponível como **BLOQUEIO**, sem aceitar documento.
4. Fazer QA com PNG sintético e padrão EICAR **exclusivamente no ambiente TEST**, sem ler dados pessoais; testar contenção e negação por assinatura expirada. O novo scanner precisa de worker privado conectado com segurança ao fluxo de Storage; o manifesto isolado **não é** integração com o aplicativo.
5. Conferir que os 7 contêineres Central permanecem healthy e não sofreram mudanças. Registrar no `CURRENT-STATE.md` data, serviço, digest, versão, idade de assinaturas, carga e evidências. Só então marcar PASS operacional referente ao escopo realmente confirmado.

## Backup continua independente
- Banco Supabase TEST `fsbqpyyprtymwrmzsacp` PostgreSQL 17.6: exportação lógica correta não envolve `central-postgres` (PostgreSQL 18.6, exclusivo Central).
- Backup de banco não inclui **bytes** do Storage. Exportar os dois em fluxo próprio, com hash, criptografia autenticada AES-GCM, chave fora do repositório e temporários de acesso restrito.
- A cópia deve ir para **destino externo** à mesma VPS, com política de retenção/recuperação e alvo de RESTORE isolado autorizados. A área na Hostinger seria só processamento temporário; não armazenar única cópia nela.
- **Não exportar agora dados TEST remotos**, nem configurar cron ou destino improvisado, sem autorização e controle de chaves/custos. Provas sintéticas locais existentes não fecham backup operacional.

## Próxima ação
Obter mecanismo de execução de contêiner PepDay permitido pela ferramenta/operador e validar ClamAV oficial/fail-closed, sem afetar a Central. Definir destino externo criptografado e projeto/restauração isolada para backup remoto TEST.
