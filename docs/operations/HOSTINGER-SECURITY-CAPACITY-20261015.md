# PepDay — capacidade Hostinger e segregação de segurança TEST
Data: 15/10/2026 (Brasília; leitura do host 16/10/2026 UTC).

## Autorização e limite
O proprietário autorizou avaliar e hospedar exclusivamente **antivírus e backup do PepDay** na VPS Hostinger já existente, com condição expressa: **não mexer em nada da Central IA — WP GROUP e não provocar lentidão ou travamento**. A autorização não se estende à Central IA, produção PepDay, uso de dados reais, mensagens, abertura de portas, contratação de serviços ou acesso cruzado a bancos/volumes da Central.

## Inventário remoto real, somente leitura
- Host autenticado pelo alias SSH local `central-ia`, sem revelar endereço, chave ou segredo. Ubuntu 26.04.1 LTS, Docker 29.9.0; 4 vCPUs.
- Memória total 15 GiB, ~1,3 GiB usada, ~14 GiB disponível no instante da amostra; swap 0. Load 1/5/15 min inicialmente 0.01/0.07/0.04, pressão de RAM avg10=0.00.
- Disco raiz 193 GiB, antes da imagem 6.4 GiB usados/187 GiB disponíveis (4%). Após download oficial ~6.8 GiB usados/187 disponíveis (4%). Sem reserva/cota real de disco criada.
- Sete contêineres `central-*` encontrados, todos **healthy** antes e depois: executive-panel-test, model-broker, scec-p1-test, telegram, hermes-test, scec e postgres. Banco **da Central** é contêiner `central-postgres` (Postgres 18.6); **NÃO usar** para PepDay, cujo Supabase TEST é PostgreSQL 17.6.
- Os contêineres Centrais já têm limites individuais de RAM. Redes existentes `central_ia_backend` e `central_ia_cognition` não foram alteradas. Zero contêiner, rede ou volume PepDay pré-existente.

## Preparação realizada
- Consultadas especificações oficiais do ClamAV: contêiner requer tipicamente **3–4 GiB de RAM**, podendo elevar consumo temporariamente ao recarregar assinaturas. Reserva técnica sugerida: limite de **4 GiB RAM**, **0,75 vCPU**, **128 PIDs**, sem portas expostas e sem montar bancos/volumes da Central; manter dados de assinaturas em volume dedicado e logs limitados.
- Imagem oficial `clamav/clamav:1.5.4` obtida com sucesso no cache local do Docker (401 MB descompactados informados pelo Docker); digest obtido no pull: `sha256:638d90201ee7ee6a82d249a2fc23b132e578673b5f1f2766852b127676ca1ef6`. **Download de imagem NÃO é serviço iniciado nem comprovação de assinaturas atualizadas.**
- Tentativa de criar rede, volume, diretório e contêiner isolados foi **recusada pela ferramenta Remote Desktop Commander com “Command not allowed” ANTES de executar**. Respeitado o bloqueio; não houve tentativa de contorná-lo. Inventário posterior confirmou **zero contêiner/rede/volume PepDay e diretório /srv/pepday-security inexistente**. Central permaneceu healthy; nenhuma alteração em Compose, firewall, serviços, bancos, portas ou redes dela.
- Não foi executado EICAR operacional na VPS, FreshClam, importação de dados TEST, dump remoto, restore, cron, integração do portal ou upload de documento. **Antimalware operacional e backup real continuam NÃO PASS/BLOQUEADOS**.

## Arquitetura segura aprovada para preparar quando houver execução permitida
1. Rede Docker **própria PepDay** (não usar as redes da Central), sem bind de portas TCP externas, sem acesso aos contêineres ou volumes da Central. Contêiner ClamAV versão específica/digest conferido, memória até 4 GiB e CPU até 0,75, atualizador de assinaturas oficiais, verificação de saúde e negação se desatualizado/inacessível. Só arquivos sintéticos TEST; nunca varredura de todo o host.
2. Backup: processar PostgreSQL **Supabase TEST** e Storage separadamente, com exportação autorizada, pacote AES-256-GCM e hashes/manifest; temporários em diretório privado com limpeza limitada, e **cópia cifrada fora da própria VPS**, pois snapshot exclusivamente nela não cobre falha total da Hostinger. Sem assumir que Free possui backup gerenciado. Não usar Postgres da Central e não exportar/testar com dados pessoais sem alvo isolado, acesso e custódia definidos.
3. Monitorar consumo, limitar espaço de logs/temporários, horário de tarefa fora dos picos e parar somente contêiner PepDay se ocorrer interferência. Não modificar daemon Docker/Compose da Central nem reiniciar serviços compartilhados. Verificar novamente todos contêineres healthy após qualquer futura implantação.
4. Nenhum novo custo autorizado nem provisionado. Não confundir infraestrutura suficiente **no instante da medição** com SLA ou garantia de capacidade futura.

## Fontes externas
- https://docs.clamav.net/manual/Installing/Docker.html
- https://supabase.com/docs/guides/platform/backups

## Próxima ação curta
**Recuperar via via autorizada permissão de implantação de contêiner PepDay na Hostinger**, sem contornar a recusa da ferramenta; então ativar scanner isolado e testar assinaturas oficiais usando somente amostras QA. Em paralelo, definir armazenamento externo cifrado/credenciais privadas e alvo de restore independente antes de iniciar backup TEST real. Preservar PROD, Central IA e PASS/NÃO REPETIR.
