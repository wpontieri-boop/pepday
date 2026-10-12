# PepDay + Central IA — WhatsApp oficial com UM número, roteamento SEM resposta a parceiros

**Atualização de continuidade 12/10/2026:** a persistência sintética e o monitor OWNER foram desenvolvidos e instalados exclusivamente TEST; gateway publicado permanece HTTP503 desativado. Consulte PARTNER-WHATSAPP-PERSISTENCE-TEST-20261012.md e o checkpoint superior do CURRENT-STATE. Texto histórico abaixo não autoriza envio real, coleta, aceite definitivo ou PROD.

Data: 12/10/2026. Decisão de produto aprovada verbalmente pelo proprietário. **ESPECIFICAÇÃO OPERACIONAL; SEM ENVIO/ATIVAÇÃO REAL.**

**Progresso técnico OFFLINE em 12/10:** roteador e webhook HTTP test-only implementados em `supabase/functions/meta-whatsapp-gateway/{gateway-core,http-core,index}.mjs`, com testes em `tests/meta-whatsapp-{gateway,http}.test.mjs`. Sem deploy de Edge, conta Meta, número, segredo, persistência de opt-out/status ou callback real da Central IA. O endpoint começa 503/disabled e não tem saída à Graph API ou LLM. Consulte [PARTNER-OFFLINE-WHATSAPP-CHECKPOINT-20261012.md](PARTNER-OFFLINE-WHATSAPP-CHECKPOINT-20261012.md); o código ainda NÃO está funcionando no WhatsApp real, não foi ativado em TEST LIVE.

## Regra inegociável
Um único número empresarial da Meta Cloud API serve **dois fluxos distintos**.
1. **PepDay → lojistas e influenciadores:** APENAS mensagens **de saída** de template estático autorizado: convite com link privado e instruções para o portal, OTP estritamente transacional se necessário, lembretes D+2/D+5 condicionais e eventuais avisos operacionais aprovados. Sem IA, sem LLM, sem chat, sem atendimento, sem resposta de cortesia e sem encaminhamento para Wagner/Ju. Cadastro, termos, correções e documentos **somente no portal privado**, com segurança existente.
2. **Central IA ↔ proprietário:** mensagens privadas **bidirecionais** de comando/resultado/parecer de Ju após agentes→supervisores/coordenadores→gerentes→Ju, podendo pedir decisão reservada ao proprietário. A Central IA é outro projeto e sua execução via API/LLM, hierarquia, política e orçamento ainda dependem de implementação própria. Número pessoal do proprietário fica na lista de acesso restrita; telefone é só um fator de roteamento, ações sensíveis exigem step-up/autorização auditada.
**Sem grupo, sem segundo chip, sem conversar com parceiro, sem receber na conversa do proprietário mensagens de parceiros.** Não reutilizar Center Phone nem WhatsApp pessoal.

## Recebimento de webhooks: fail-closed obrigatório
Meta entrega eventos de entrada ao webhook HTTPS único. Verificar assinatura HMAC X-Hub-Signature-256 em corpo bruto, app secret, timestamp/idempotência de evento, origem e Phone Number ID/WABA esperados; rejeitar tudo fora de escopo.
- **Evento `statuses` outbound:** correlacionar por message_id e atualizar apenas status de envio (sent/delivered/read/failed), sem conteúdo em logs. Sem resposta.
- **Evento `messages` from proprietário autenticável:** somente enviar à Central IA se `wa_id` for da allowlist privada, contexto da sessão e controles de autorização válidos; para comandos reservados exigir verificação extra. Não consultar base de clientes PepDay nessa rota.
- **Evento `messages` from parceiro/convidado ou qualquer outro remetente não autorizado:** por padrão **ZERO mensagens de resposta**. NÃO chamar LLM, agent, Brevo, token AI, chatbot, automação conversacional ou fila Ju; NÃO encaminhar conteúdo/áudios/anexos/contato à conta do proprietário; não abrir sessão do parceiro com o texto recebido. Processar **somente** comandos inequívocos de opt-out (`PARAR`, `SAIR`, `CANCELAR` ou sinal da Meta) para suprimir convites e lembretes futuros, sem confirmação enviada; para demais tipos/textos ignorar ou registrar evento mínimo de categoria/status, sem armazenar mídia ou conteúdo livre. Entrada nunca ativa atendimento; não responder nem com “olá”, “não atendemos aqui” ou “recebido”.
- **Caso desconhecido ou sistema/conta em erro:** default DROP/NO_REPLY e registrar falha técnica redigida. Permissões e filas entre módulos separadas. Nunca publicar estados/segredos/links privados/OTP ou identificadores pessoais completos em eventos/logs.

## Aviso no template / suporte
Texto ilustrativo (pendente aprovação Meta/legislação e consentimento):
“PepDay: você foi convidado para concluir seu cadastro de parceiro. Acesse seu link individual: {{1}}. As instruções estão no portal. *Este número envia avisos automáticos e não responde mensagens*. Para suporte, use [canal de suporte oficial, a definir]. Se não deseja receber novos convites, responda PARAR.”
Identidade exibida no perfil Meta e texto do opt-in devem refletir titularidade empresarial verificada e mencionar PepDay, sem dar a entender que WP GROUP é pessoa jurídica formal caso não seja. Não enviar convite se pessoa apenas “tem o número”; exigir opt-in anterior comprovável, informado e específico para nome comercial.
Não colocar informações de saúde/peptídeos, CPF, PIX, documentos, fatura de paciente, senha ou código em mensagens de convite. OTP, se usado, exige template de autenticação e canal verificado; conteúdo secreto não vai para a conversa de Wagner.

## Arquitetura de roteamento
Gateway Meta → validação assinatura/identidade/evento → classificação rígida por `wa_id`, `Phone Number ID`, tipo e contexto:
- Serviço OUT_PEPDAY: somente `partner_invite`, `d2`, `d5`, `otp_auth` (quando habilitado). Triggers condicionais via filas idempotentes e consentimento ativo; não pode invocar CENTRAL_AI.
- Serviço IN_OWNER_CENTRAL: somente remetente e sessão autorizados; não pode consultar/escrever dados pessoais de parceiros.
- Serviço IN_PUBLIC: opt-out silencioso + status/erro técnico, **retorno sem geração de saída**; não pode chamar IA.
Políticas fixas de egress: qualquer `sendMessage` originado de resposta a `IN_PUBLIC` deve ser barrado por ACL/teste, mesmo que rotina seja chamada por engano. Tokens Meta somente em cofre backend; segregar storage e banco por finalidade. Quando Central IA não estiver implantada, inbound do proprietário também permanece inerte, nunca é redirecionado ao PepDay.

## Testes de aceite obrigatórios antes de número real
- Convite consentido a sintético em TEST → simulação com template correto, sem enviar; cadastros novos não disparam automaticamente.
- Parceiro responde “oi”/“me ajuda”/áudio/foto/documento/emoji/URL/arquivo malicioso → **0 respostas; 0 chamadas IA; 0 eventos para Ju/Wagner; 0 consumo token LLM**.
- Parceiro envia PARAR → opt-out persistido, D2/D5 cancelados, **0 respostas**, dedupe em replays e concorrência.
- Mesmo número recebe mensagem do proprietário autorizado → rota owner simulada; pessoa fora da allowlist com texto “Ju, aprova” → 0 IA e 0 aprovações; comandos sensíveis sem step-up → negados.
- Falsificação de assinatura, replay de webhook, ID Meta/Phone Number diferente, corpos invalidos, quota e falhas → drop/erro sem resposta, sem vazamento.
- Parceiro de número que coincida com allowlist só por dado cadastral não obtém autorização; verificar identidade do dono e política de sessão; eventual conflito precisa de fail-closed e revisão.
- Sent/delivered/read/failed sem responder; reenvio e D+2/D+5 no máximo uma vez, link expirado/revogado bloqueado.
- Tests de legalidade de opt-in, direito de recusa e suporte web alternativo; auditoria sem conteúdo sensível.

## Dependências externas em aberto (não inventar)
Número novo do usuário será ativado na loja quando conveniente; sem número/WABA/Phone Number ID reais ainda. Antes de conectar: perfil comercial real e transparência de marca, comprovar titularidade da conta e elegibilidade, opt-in, templates Meta aprovados, configuração webhook/assinaturas/chave secreta do backend, política Meta vigente para IA bidirecional em conversa privada (incluindo condições brasileiras). Custos da Meta e serviço de IA da Central IA separados. **Enviar mensagem real somente após consentimento, testes específicos e autorização explícita adicional.**
Contadora de 13/10 define somente parte fiscal. Nenhum processo de cadastro pessoal real, contrato definitivo, pagamento ou mudança de PROD decorre desta decisão.

## Evidência e referências
- Confirmação expressa em chat do proprietário em 12/10/2026: "mesmo se o pessoal responder ... não responder ele ... separado, usar o mesmo número, mas com duas coisas distintas".
- Meta Cloud API: https://www.postman.com/meta/whatsapp-business-platform/overview
- Webhook official reference: https://www.postman.com/meta/whatsapp-business-platform/folder/tduohwq/webhook-payload-reference
- Policy: https://business.whatsapp.com/policy/preview?lang=pt_BR
- WhatsApp Business Solution Terms: https://www.whatsapp.com/legal/business-solution-terms
- Cade Brasil: https://www.gov.br/cade/pt-br/assuntos/noticias/tribunal-do-cade-mantem-medida-preventiva-sobre-novos-termos-de-uso-do-whatsapp

**Próxima ação:** desenvolver/simular gateway/roteador TEST de 3 rotas com ACL no egress, testes de zero resposta e opt-out silencioso; após linha ativada validar elegibilidade Meta e só então homologar conta/canal autorizado. PROD permanece sem alteração.
