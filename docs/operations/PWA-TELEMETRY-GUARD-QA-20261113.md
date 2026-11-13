# PepDay — protótipo isolado de proteção contra abuso na telemetria PWA

Data: **13/11/2026**. Branch de trabalho: `security/pwa-telemetry-qa-20261113`, derivada da branch oficial `v3.0-bloco-b` em `525aaada32485e6ef9377e756f2d384f84a9e07d`.

## Por que esta branch existe
Auditoria somente leitura do Supabase TEST `fsbqpyyprtymwrmzsacp` em `docs/operations/CLOUD-SECURITY-AUDIT-20261113.md`: a RPC `public.record_pwa_install_event(uuid,uuid,text,text)` é acessível por `anon` deliberadamente, pois a instalação do PWA acontece antes de login. A tabela de destino tem RLS ativo e não permite SELECT/INSERT direto a `anon`; o problema potencial é **abuso de escrita na RPC via IDs gerados arbitrariamente pelo cliente**, inflação de contagens/consumo e ausência de limitação de volume. Não há evidência de exploração.

A fotografia agregada do banco, sem dados pessoais: **10 eventos históricos, 2 instalações distintas, 1 evento nos últimos 7 dias e pico de 1 evento por hora nos últimos 30 dias**. Limites sugeridos são **provisórios**, escolhidos somente para exercício: 12 eventos por instalação/hora e 240 eventos globais/hora. Não foram aprovados para produção.

## Arquivos e provas locais
- `scripts/security/pwa-telemetry-limit-qa.mjs`: modelo JavaScript **puramente em memória** de decisão: tipos/plataformas limitados, UUID válido, idempotência por ID de evento e instalação, janela deslizante, teto global mesmo que IDs sejam trocados, falha fechada em histórico inválido. Não contém rede, credenciais, DDL ou gravador SQL.
- `tests/pwa-telemetry-limit-qa.test.mjs`: **8/8 PASS** executados em Node 22 local de QA, em ambiente temporário independente dos computadores do usuário.
- `docs/operations/PWA-TELEMETRY-RATE-LIMIT-DRAFT-20261113.sql`: **proposta de SQL NÃO EXECUTÁVEL NESTA FASE**. Não está em `supabase/migrations` e não foi aplicada a banco algum. Mantém assinatura, acesso anônimo intencional, tabela com RLS, verificação de valores, `ON CONFLICT DO NOTHING`; propõe índice por instalação+criação, lock transacional global não bloqueante e contagens no banco sob o lock para reduzir corrida `check-then-insert`.
- `tests/pwa-telemetry-draft-contract.test.mjs`: **4/4 PASS** de contrato estático do SQL, sem executar Postgres, DDL ou Edge. Total focal: **12/12 PASS**. Esses testes não equivalem a teste de concorrência real, desempenho, índices ou migração instalada.
- Nenhum arquivo do site/PWA foi alterado. Nenhum dado real, chave ou token foi lido ou persistido. Os **672/672** testes anteriores da branch principal continuam resultados históricos aprovados; **não foram repetidos** nesta sessão cloud-only.

## Riscos e decisões pendentes
1. **UUID informado pelo cliente não identifica pessoa/origem com confiança.** Limite por instalação sozinho pode ser burlado gerando novos UUIDs. O teto global por hora coloca limite de inserções, mas um ataque ainda pode consumir todo esse teto e impedir a telemetria legítima durante o período. A telemetria é não crítica para login, pagamento, PWA e demais funcionalidades.
2. **O SQL não protege CPU/rede contra rajadas rejeitadas.** Avaliar rate-limit no gateway/WAF/Edge antes de expor mudanças, preferencialmente com identificador efêmero não persistente e política de privacidade definida; não guardar IP bruto nem token bruto. Não assumir serviço ou plano pago.
3. **Concorrência:** `pg_try_advisory_xact_lock(202611,13)` é apenas desenho. Antes da promoção, verificar colisão de namespace, custo de lock global, consistência sob altas rajadas e idempotência real. Em concorrência, um legítimo pode receber `recorded:false` por contenção; comportamento client-side deve seguir não crítico.
4. **Índice e performance:** o índice adicional pode gerar custo/lock para criar; validar tamanho atual e plano, planejar janela de manutenção e rollback antes de qualquer DDL. O Postgres TEST remoto ainda usa 17.6 e deve ter backup real/restore isolado antes de manutenção.
5. **Rollback e deploy:** não criar migration manualmente. Quando houver ambiente local autorizado, usar `supabase migration new` seguindo `--help` da versão atual da CLI (v3 alterou comportamento de comandos remotos em nov/2026), e testar com banco exclusivamente sintético e depois TEST sob autorização e backup.
6. **Produto:** conservar RPC pública para instaladores anônimos, nunca liberar SELECT direto em `pwa_install_events`; não alterar PWA client, Admin nem rotinas aprovadas como PASS HUMANO/NÃO REPETIR.

## Condições para promoção futura — NÃO EXECUTAR AGORA
- Git checkout/worktree de Mac/PC comparado ao GitHub via fetch, sem sobrescrever alterações locais (PC CenterPhone está offline nesta viagem).
- Backup **real** de Supabase TEST + Storage criptografado e restore isolado comprovados; chave de recuperação fora do WhatsApp em custódia resiliente e credenciais protegidas.
- Migration criada com CLI correta e revisada em branch TEST, e prova de teste de concorrência contra Postgres isolado.
- Executar `npm test` e `npm run build:test`, validar negados para `anon` e `authenticated` no SELECT direto, idempotência, métricas Admin e UX PWA sem repetir testes humanos históricos.
- Medir efeito do limite global no volume legítimo, confirmar a retenção de eventos e as medidas de proteção de gateway. Plano de rollback sem apagar dados.
- Aplicação ao Supabase TEST, merge da branch e deploy exigem autorização/escope de mudança próprios. **Produção `main`/V2.9 e Central IA não foram tocadas.**

**Próxima ação curta:** executar prova de concorrência e plano de índices em PostgreSQL isolado quando runtime local autorizado estiver disponível; após backup real, avaliar migration limitada ao Supabase TEST. Sem ativação de feature/SQL remoto nesta branch.
