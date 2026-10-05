# Painel de aquisição/conversão — revisão 05/10/2026

Status: implementação e validação local concluídas na branch `v3.0-bloco-b`; nenhuma publicação ou mudança de banco remoto nesta sessão. Fonte operacional: `docs/CURRENT-STATE.md`.

## Definições e limites

| Indicador | Base |
|---|---|
| Novas contas/origem, trials, conversões, cancelamentos | Eventos nos últimos 7/30/90 dias, excluindo admins |
| Base atual | Cada conta em um estado: assinatura > cartão > promo > trial > FREE |
| FREE | Nenhum acesso PRO vigente; inclui acessos encerrados |
| Cartão 30d ativo na base | Acesso pelo cartão, sem assinatura vigente |
| 30d ativos na campanha | Benefícios ainda dentro da validade, inclusive se a conta já assinou; não somar à base |
| Pós-cartão | FREE e cartão encerrado; prioridade sobre trial histórico |
| Pós-trial | FREE e trial encerrado, sem cartão concedido |
| Elegível | Pós-cartão/pós-trial + consentimento atual de marketing |
| EX-PRO | Já iniciou assinatura e está FREE; pode também estar entre expirados |
| QR → 30d | Das contas atribuídas ao cartão na janela, quantas receberam benefício até agora |
| 30d → pago / uso | Dos benefícios concedidos na janela, quantos assinaram/usaram até agora |
| Cobranças aprovadas | Recursos únicos de `subscription_authorized_payment`, `payment_approved`, `applied` no período; inclui renovações |
| Receita recebida | Indisponível: valor/moeda não persistidos. Não multiplicar contagens por preço de tabela |
| Recuperados por campanha | Indisponível até atribuição real da campanha/oferta |
| PWA | Dispositivos e sessões; indicador direcional, não usuários únicos |

Taxas sem base aparecem como `—`, não 0%. Coortes recentes ainda não tiveram tempo de converter. Conversão significa assinatura iniciada após a concessão, inclusive antes de terminar o benefício. Dados atuais independem do período; os indicadores de expiração/EX-PRO são subconjuntos, não somas à base.

## Validação local reproduzível

- `node --test tests/admin-dashboard.test.mjs tests/block-c-admin*.test.mjs tests/admin-team-access.test.mjs tests/card-qr-30d-benefit.test.mjs`: 35/35.
- `npm test`: 406/406.
- `node --check site/admin/admin.mjs` e `npm run build:public`: PASS.
- Definir `PGLITE_MODULE` para o `dist/index.js` de um runtime PGlite local e rodar `node scripts/test-admin-dashboard-sql-local.mjs`. O runner não usa rede ou bancos remotos. Schema mínimo das métricas e helper `admin_assert_access` oficial; testa a migration nova e as RPCs históricas.
- Preview visual usa dados ilustrativos separados de PROD: desktop e mobile sem overflow. Não registra novo PASS humano.

## Publicação pendente

1. Conferir branch limpa, fetch e versão sincronizada; ler `AGENTS.md`/`CURRENT-STATE.md`.
2. Aplicar somente `20261005150845_admin_dashboard_lifecycle.sql` no TEST `fsbqpyyprtymwrmzsacp`; conferir as RPCs em AAL2 e advisors. Não reaplicar migrations administrativas anteriores.
3. Publicar frontend admin v32 somente em homologação e conferir os indicadores de leitura. Nenhum novo cadastro/cartão/pagamento ou bootstrap administrativo é necessário.
4. Solicitar autorização específica para promover esse painel e essas duas RPCs agregadas a PROD `oslefjmwfnddxlotalxu`. O pedido original preserva produção; não herdar a autorização do rollout administrativo anterior como autorização genérica.
5. Após autorização, registrar migration remota real, commit/deploy e rollback, verificar smokes agregados e assets. Comparar builds: somente os três arquivos admin devem diferir. Auto-deploy permanece OFF e `main`/V2.9 preservados.

Aplicar banco antes do frontend: enquanto não houver `metrics_version=2`, o frontend novo informa atualização pendente e não exibe a métrica FREE antiga. Para rollback do frontend, manter as consultas corrigidas e as proteções AAL2; a atualização SQL é compatível com chaves históricas. Sem alterações de schema/dados, equipe ou regras de acesso.

Após fechar o painel, definir a oferta de recuperação com o proprietário antes de implementar desconto/automação. Respeitar consentimento de marketing e todos os PASS/NÃO REPETIR.
