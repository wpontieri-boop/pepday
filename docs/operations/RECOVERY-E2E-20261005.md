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

### Nova tentativa com comprador autenticado — confirmação pendente

Proprietário concluiu o login do comprador e informou “entrou”. Menu da conta no navegador comprovou o e-mail sandbox documentado `test_user_5204056972286070843@testuser.com`. Nenhuma senha capturada pela automação. O login não comprova por si só a causa da recusa anterior.

Criada **outra conta descartável**, sem liberar intenção/travas da conta anterior nem reativar seu contrato. Alias `wpontieri+pepday-recovery-e2e-authenticated-20261005@gmail.com`; user `f3c4301a-274e-45de-8ca2-e4f1d98162a6`; campanha `2b9df928-bf3a-4043-93c6-5a09fcc9a595`; subscription `ad77b6d6-f2f9-4c4a-a3c3-a56436609f36`. Dados/aceites e trial expirado são sintéticos, exclusivos TEST. Fonte trial, oferta 05/10/2026 20:46:22.513688Z → 08/10/2026 20:46:22.513688Z (72h, até 17:46 Brasília). Quatro etapas anteriores suprimidas `PAYMENT_ONLY_QA_NO_REPEAT_EMAIL`, last pending para conferir supressão após aprovação. Fixture offer anterior retirada da seleção, stopped `DISPOSABLE_QA_FINISHED`; sua última mensagem suprimida. Nenhuma alteração em contas aprovadas ou PROD.

Helper temporário protegido TEST/sandbox/token único/identidade fixa confirmou contrato anterior cancelled e zero faturas antes de obter sessão Auth apenas da nova fixture via generate_link/verify administrativos (sem envio de e-mail, senha, JWT ou OTP exposto). Chamou o endpoint real recovery-checkout v3. Primeira chamada auxiliar pg_net58 foi rejeitada HTTP400 por formato incorreto requestId, antes de reservar/criar contrato; corrigido para request_id apenas no helper. pg_net59: HTTP200 CHECKOUT_READY, um contrato `2e0794e7c57549b89f404018ce1f98f0`, intenção `207bea97-902d-46b2-b9d4-07bcb094224e`, preço inicial9,90, posterior14,90. Helper aposentado v9 RETIRED sem acesso ao provedor. Esse acesso administrativo sintético não é PASS de login humano PepDay.

Checkout no navegador do comprador autenticado mostrou cartão documentado Santander/Mastercard final3311 e revisão R$9,90. Código fictício123 preenchido; botão Confirmar deixado ao proprietário. Nenhum novo envio de campanha ou confirmação automática. Sem alterações no código do produto; testes424/424 e SQL38 anteriores permanecem válidos.

### Segunda recusa e comparação sem cobrança nova

Print do proprietário `Captura de tela 2026-10-05 175640.png` confirma “Não foi possível processar seu pagamento” também com comprador autenticado. Auditoria pg_net62 HTTP200: novo contrato cancelled, last_modified 2026-10-05T20:56:15.958Z; comprador3722905913/recebedor3722905909 corretos; valor9,90/BRL, limite08/10/2026 20:46:22Z, quotas1, payment_method_id null; invoices=[] e payments=[] para a referência exata. Worker61 não cancelou nem enviou mensagens. Login não resolveu; causa exata continua desconhecida. Console do checkout não forneceu erro adicional. Nenhuma terceira tentativa/contrato criada.

Comparação pg_net63, exclusivamente GET do contrato antigo780d00053e8943fb84096d104c18583e: authorized, mesmo comprador/recebedor, mensal14,90/BRL, sem end_date e quotas null, payment_method_id account_money, charged_quantity1/charged_amount14,90. Portanto o PASS antigo valida saldo TEST; não valida cartão3311. Diferenças cartão versus saldo e contrato limitado72h versus sem limite ainda não foram isoladas. Essas são hipóteses, não causas comprovadas. A documentação oficial de criação de assinatura descreve end_date, mas não resolveu a recusa genérica. Não remover a proteção do desconto recorrente/validade para tentar aprovar.

Fixture autenticada retirada da seleção; campanha stopped DISPOSABLE_QA_FINISHED, last suprimido. Evidências preservadas. Auditoria temporária v10/11 apenas leituras canônicas, tokens de uso único e guard TEST/sandbox; aposentada v12 RETIRED sem imports/acesso ao provedor. Nenhuma alteração de código ou novo envio, nenhuma cobrança aprovada. Não marcar pagamento/PRO/conversão/renovação/replay PASS.

### Terceira tentativa autorizada — saldo fictício também recusado

Proprietário autorizou expressamente R$9,90 com saldo fictício do mesmo comprador TEST. Partida limpa/sincronizada5f00d50, fetch0/0. Nova fixture isolada, nenhuma liberação de travas anteriores: alias `wpontieri+pepday-recovery-e2e-balance-20261005@gmail.com`, user `45bb42bf-be48-4d6f-8708-195add70139c`, campanha `740651c3-b9eb-437b-a541-2cc42ebbd73d`, subscription `43af1b80-65f9-460c-a690-bd2df26f4722`; trial e consentimentos sintéticos, oferta05/10/2026 20:57:34.837302Z →08/10/2026 20:57:34.837302Z (72h). Etapas anteriores suprimidas PAYMENT_ONLY_QA_NO_REPEAT_EMAIL; último aviso pending antes da tentativa. Nenhum envio de campanha novo.

Helper v13 guard TEST/sandbox/token único/conta fixa verificou primeiro o segundo contrato cancelled/sem faturas e chamou recovery-checkout v3 com sessão apenas da nova fixture, sem expor credenciais. pg_net65 HTTP200 CHECKOUT_READY, preapproval `b1371c4cbf414d1c9f52f67373fe0a63`, referência `pepday:43af1b80-65f9-460c-a690-bd2df26f4722:monthly:recovery:740651c3-b9eb-437b-a541-2cc42ebbd73d`. Helper inicialmente aposentado v14. Navegador autenticado mostrou **Saldo na sua conta Mercado Pago R$9.910,60**; opção escolhida e revisão confirmou9,90. Clique Confirmar automatizado sob autorização específica, sem nova aceitação de termos na revisão autenticada. Resultado: “Não foi possível processar seu pagamento”. Evidências locais `recovery-balance-review.png` e `recovery-balance-error.png`; nenhum cartão/saldo real utilizado.

Auditoria canônica somente leitura v15/pg_net67 HTTP200: cancelled, last_modified2026-10-05T21:03:52.237Z, payer3722905913, collector3722905909, auto_recurring monthly9,90BRL, start_date21:02:54Z/end_date08/10/2026 20:57:34Z; quotas1, payment_method_id null, charged_quantity/charged_amount null, invoices=[] e payments=[] pela referência exata. Worker66/68 HTTP200 reset0/canceled0/sent0/failed0. A recusa não foi causada por cancelamento desses workers. O saldo fictício elimina o cartão como explicação exclusiva, mas não comprova qual parâmetro foi recusado pelo provedor.

IDs públicos de diagnóstico do checkout: redirect `acb22774-0641-4541-b1b2-59a14dcd5721`, preference `3722905909-d24a3606-89e7-4981-aa3a-05df6b970c8b`, router-request `c180c459-0afe-40e6-b73b-41f702c8bf1d`. Não registrar parâmetros de sessão/autenticação. A documentação oficial consultada de assinaturas não forneceu motivo específico desta recusa; end_date/quotas1 continuam hipótese. Não remover a proteção para tentar aprovar.

Após recusa: selecionadas0, fila ativa0, mensagens sent6 preservadas. Fixture stopped DISPOSABLE_QA_FINISHED/último aviso suppressed. Subscription free/billing none; campanha redeemed_at/first_invoice_id/first_amount/price_reset_at/converted_at null. Helper v16 aposentado sem imports/provedor; pg_net69 HTTP410 RETIRED. Não houve mudança no produto; regressão424/424 + SQL38 anterior continua válida. Não marcar pagamento, PRO, conversão, renovação14,90, reutilização após pagamento ou replay financeiro PASS.

**Próxima ação:** diagnosticar contrato mensal com cutoff72h/quotas1 em TEST, usando evidências acima para obter motivo específico do provedor ou validar alternativa que preserve a janela72h e impeça outra mensalidade9,90. Não repetir pagamentos da configuração recusada nem reativar contratos cancelados. Após correção comprovada e pagamento9,90 aprovado, retomar PRO/saída, renovação14,90, atribuição, uso único e replay. Não repetir seis envios nem PASS antigos. PROD bloqueado; nenhuma confirmação humana adicional necessária agora.
