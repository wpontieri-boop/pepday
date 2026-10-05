# Recuperação TEST — evidências de 05/10/2026

Base oficial `aca7704`, branch `v3.0-bloco-b`, PC/GitHub limpos e 0/0 após fetch. Ambiente exclusivo `fsbqpyyprtymwrmzsacp` / homologacao.pepday.com.br. PROD permaneceu no deploy `dep-db1t7vp42hec73e61t6g`, commit `f76482c`; nenhum teste humano aprovado foi repetido.

## Fixtures e limites da evidência

Sete contas descartáveis criadas no Auth/banco TEST: aliases `wpontieri+pepday-recovery-e2e-{warning,ended,resume,offer,last,trial,no-consent}-20261005@gmail.com`. Recebem na caixa do proprietário. Datas de benefício e aceites são **sintéticos de QA**, não resgate/cadastro jurídico humano; nenhum fluxo de cartão/trial aprovado foi executado novamente. Todos têm perfil comercial, sem membro administrativo, sem rotinas/saúde, com avisos operacionais desativados. Conta `no-consent` tem marketing false/accepted_at null. Seleção individual limitada a essas fixtures.

Fixtures independentes simulam cada etapa da jornada cartão; trial simula aviso proporcional. Calendário verificado pelos timestamps canônicos e fila de cinco etapas por campanha. Essa evidência não representa uma única conta aguardando 38 dias reais. Ajustes de data atingiram apenas três fixtures desta sessão; filas recalculadas antes do envio. Nenhuma conta anterior foi alterada.

## PASS técnico real / NÃO REPETIR

| Etapa | Origem | Brevo message ID | Gmail ID entregue |
|---|---|---|---|
| warning | card | `<202610052020.29755075285@smtp-relay.mailin.fr>` | `1a10db9d165849bd` |
| ended | card | `<202610052020.12049654071@smtp-relay.mailin.fr>` | `1a10db9d2af20239` |
| resume | card | `<202610052024.39313568453@smtp-relay.mailin.fr>` | `1a10dbd1c6df7841` |
| offer | card | `<202610052020.53164104461@smtp-relay.mailin.fr>` | `1a10db9d37e83b37` |
| last | card | `<202610052020.56878270245@smtp-relay.mailin.fr>` | `1a10db9d59c7680f` |
| warning | trial | `<202610052020.73069767325@smtp-relay.mailin.fr>` | `1a10db9d181fcfe9` |

- Worker pg_net 44/45 HTTP200: 5+1 aceitos; todos status sent, attempts=1. Replay 47 HTTP200, sent=0. Zero grupos duplicados `(campaign_id,stage)`, zero segunda campanha por conta. Gmail confirmou entrega dos seis e-mails; não presumir abertura/renderização física pelo usuário. HTML da oferta recebido traz preços, limite Brasília, uso único, cortesia e anual corretos.
- Sem consentimento: zero campanha/outbox e pesquisa Gmail vazia para o alias dedicado, inclusive após processamento. Isso comprova ausência nessa execução, não observação infinita.
- Oferta: janela de exatamente 72h; cartão dia35 e trial dia12. SQL remoto transacional com ROLLBACK comprovou reserva repetida retornando mesma intenção, claim único, rejeição após expiração e supressão ao revogar consentimento. Não simula pagamento aprovado.
- Navegador real da fixture: oferta individual R$9,90, depois R$14,90, anual R$99,90; planos normais continuam separados. Depois da correção/carga do novo cache, opção **Parar mensagens promocionais** visível. Não foi acionada na fixture do pagamento.

## Correções encontradas e verificadas

1. Mercado Pago recusou `reason` acima de 60 caracteres (HTTP400 explícito nos logs). Abreviado com os dois preços. Teste do POST agora confere limite e preços. `recovery-checkout` TEST v3.
2. `loadAccountState` não selecionava `marketing_opt_in`, ocultando o opt-out. Campo incluído na leitura da própria conta e coberto por teste. Cache TEST `profile-sync-30`.

Regressão **424/424**, SQL local **38**, sintaxe/build PASS. Frontend TEST LIVE `a37c7b2`, deploy `dep-db20hho473hc739100rg`.

Antes de repetir o POST rejeitado, auditoria canônica pg_net48 confirmou `contracts=[]`. Só então `checkout_started_at` da única fixture foi liberado; intenção permaneceu a mesma. Não liberar esse lock em erros desconhecidos/timeouts. A segunda tentativa criou **um** contrato, preço e comprador verificados pela API.

## Pagamento preparado — tentativa humana recusada

- Conta PepDay `5d14e810-c5ae-465e-9594-5440e774566e`, alias offer acima.
- Campanha `5f12c791-fd53-4ffc-b4b8-7f0ce1d2c707`; assinatura interna `35fffa54-7a85-4615-83b0-48ebad6c951d`.
- Preapproval `4c8e7423104a4400969f034730ab1ce1`; referência `pepday:35fffa54-7a85-4615-83b0-48ebad6c951d:monthly:recovery:5f12c791-fd53-4ffc-b4b8-7f0ce1d2c707`.
- Auditoria pg_net50/51: pending, frequência mensal, R$9,90/BRL; payer_id `3722905913`, collector_id `3722905909`; nenhuma fatura. Oferta 05/10/2026 18:21:24Z → 08/10/2026 18:21:24Z (15:21 Brasília). Contrato tem cutoff arredondado ao segundo anterior.
- Comprador já documentado `TESTUSER5204056972286070843`; e-mail fictício da configuração TEST `test_user_5204056972286070843@testuser.com`. Só o cartão público/fictício já documentado, final3311/APRO, foi preenchido. Nenhuma senha, JWT, OTP ou segredo registrado.
- Tela **Confirme a sua assinatura** mostra R$9,90 e o botão Confirmar. Clique aceita termos do Mercado Pago; solicitado ao proprietário no ponto exato. Não houve confirmação automática.
- Estado final antes desse clique: subscription free, campanha active, redeemed_at/first_invoice/first_amount/price_reset null. Um last ainda pendente permite conferir supressão após aprovação.

**Não PASS:** pagamento, PRO ativo pós-pagamento, atribuição/receita, renovação R$14,90 do novo contrato, uso único após conversão e idempotência do novo evento financeiro. Testes unitários/SQL e sondagem antiga não substituem esses resultados.

## Continuidade e limpeza

Outras fixtures retiradas da seleção, campanhas encerradas `DISPOSABLE_QA_FINISHED`, mensagens futuras suprimidas; evidências conservadas. Somente offer continua selecionada enquanto aguarda confirmação. Zero clientes PROD envolvidos. Auditoria temporária `recovery-test-audit` v4 aposentada, responde somente 410 RETIRED, sem imports/segredos/provedor. Chamadas anteriores exigiram URL TEST, sandbox, token efêmero de uso único e referência fixa; não expuseram credenciais.

### Investigação após confirmação do proprietário

O proprietário clicou Confirmar e informou a recusa. Navegador confirmou “Não foi possível processar seu pagamento”, sem motivo específico. Auditoria TEST pg_net53 HTTP200 consultou o contrato, authorized_payments e payments/search pela referência exata: contrato agora `cancelled`, nenhuma fatura e nenhum pagamento encontrado. Valor R$9,90, comprador3722905913 e recebedor3722905909 permanecem corretos. Worker pg_net52/54 registrou zero cancelamentos/envios. Campanha segue active sem stop_reason, oferta vigente, conta sem conversão. Não há evidência de pagamento aprovado; não marcar consequências financeiras PASS.

O link existente mostra “Este plano não está disponível”; não há revisão válida para confirmar novamente. Não foi criado outro contrato, liberada trava, reativada assinatura nem usado outro cartão. Causa exata da recusa permanece desconhecida. [Teste oficial de assinaturas Mercado Pago](https://www.mercadopago.com.br/developers/en/docs/subscriptions/integration-test/payment-approval) orienta usar os dados do usuário de teste. Login sandbox é hipótese a verificar, não diagnóstico concluído.

Navegador interno já identificou `TESTUSER5204056972286070843` e abriu o campo de senha. Para obter a credencial fora do Git/chat, Chrome abriu Developers → Integrações → PepDay Assinaturas, aplicação `7268916270122162`. Provedor interrompeu com “Valide que esta é a sua conta” (SMS/WhatsApp/ligação); verificação humana pendente. Nenhuma mensagem de verificação foi solicitada automaticamente. Auditoria temporária v5 reaberta somente para consulta foi aposentada em v6, HTTP410 RETIRED, sem acesso ao provedor.

Próxima ação: proprietário concluir somente essa verificação no Chrome. Recuperar a credencial sandbox sem expor, autenticar comprador e investigar uma tentativa controlada TEST após considerar o contrato cancelado, preservando uso único/idempotência. Não reutilizar o link cancelado nem liberar travas por suposição. Não repetir os seis envios. Pagamento e consequências continuam pendentes; não realizar segunda cobrança nem usar cartão real. PROD exige autorização expressa nova.
