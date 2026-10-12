> Atualização 12/10/2026: revisão interna concluída e aprovada comercialmente pelo proprietário, sem contratação de advogado externo. A recomendação histórica de revisão externa abaixo foi substituída por esta decisão. Obrigações legais e guardas reais permanecem. Ver PARTNER-INTERNAL-LEGAL-REVIEW-20261012.md e PARTNER-INTERNAL-SECURITY-20261012.md.

# PepDay — Revisão jurídica técnica, segurança e canais externos (pré-ativação)
Data de referência: 11/10/2026 (Brasil). Ambiente: TEST. Fonte oficial de continuidade: AGENTS.md + docs/CURRENT-STATE.md.

**ATUALIZAÇÃO OBRIGATÓRIA 12/10/2026 — CANAL REVISTO PELO PROPRIETÁRIO:** a recomendação histórica de OTP Brevo/e-mail nesta revisão foi **substituída** pela decisão de manter **WhatsApp Meta como canal único de mensagens de parceiros (convite, OTP autorizado, D+2 e D+5)**; Brevo continua apenas nos fluxos PepDay preexistentes, sem integração obrigatória ao portal. Mesmo número Meta compartilhado com a futura Central IA (Ju ↔ proprietário), porém inbound de parceiros/lojistas deve receber **ZERO respostas / ZERO IA / ZERO encaminhamento ao proprietário**; opt-out silencioso obrigatório. Ver o checkpoint superior CURRENT-STATE.md e [WHATSAPP-SINGLE-NUMBER-SILENT-PARTNERS-20261012.md](WHATSAPP-SINGLE-NUMBER-SILENT-PARTNERS-20261012.md). Esta alteração é de **decisão/arquitetura**, não implica canal real integrado, legal aprovado ou novo deploy. Texto da seção Brevo abaixo preservado apenas como alternativa histórica, NÃO executar sem nova autorização.
**Natureza:** análise informativa, minuta e especificação técnica. Não é parecer jurídico de advogado habilitado, aprovação de conformidade regulatória, validação independente de segurança ou autorização para contratos/contatos reais.

## 1. Evidências técnicas e limitações efetivamente encontradas
- GitHub wpontieri-boop/pepday, branch v3.0-bloco-b, HEAD/origin `036c4f1` e árvore limpa (verificados antes desta revisão). Render TEST deploy `dep-db644uh5efls73b7p690` LIVE; PROD `166de8f` inalterado.
- O contrato atual em `supabase/migrations/20261012013353_partner_portal_test.sql` é uma única frase `qa-draft-1`: “MINUTA TECNICA SINTETICA — SEM VALIDADE CONTRATUAL. Parecer juridico pendente. Nenhuma ativacao ou pagamento autorizado.” O banco proíbe `legal_approved=true` no contrato QA e impede aceite definitivo. **Não remover esses bloqueios por documentação.**
- No portal de QA há token com hash, TTL, OTP demonstrativo, sessão curta, papel OWNER e RLS, arquivos sintéticos privados e relatórios. Testes SQL rollback e serial 538/538 foram registrados; **não houve validação ponta a ponta de identidade/canais reais, contratação ou armazenamento pessoal real**.
- `privacidade.html` do PepDay já diferencia dados de saúde (sensíveis, art. 11 LGPD) dos dados de conta e separa consentimento específico e marketing. Entretanto, **não há anexo específico e definitivo da relação contratual com parceiros** (coleta/recebimento/retificação de CPF/PIX/representantes etc.).
- O titular da empresa/controlador e contato atualmente publicados estão em `privacidade.html`. Confirmar situação registral/representação antes do contrato final; não colocar identificadores pessoais ou assinaturas reais nesta minuta técnica.

## 2. Legislação, parâmetros e riscos jurídicos (consultas oficiais)

**Código Civil (Lei 10.406/2002, arts. 104, 107, 421, 422, 423 e seguintes):** objeto lícito e determinado, liberdade de forma quando a lei não exigir, boa-fé e interpretação favorável ao aderente se ambiguidade de contrato de adesão; não impor renúncias genéricas ou cláusulas contraditórias. Fonte https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm

**MP 2.200-2/2001, art. 10 §2º:** documentos eletrônicos podem demonstrar autoria e integridade por meio diverso da ICP-Brasil admitido pelas partes ou por quem o documento for oposto. Evidência de clique+OTP+hash+versão+horário ajuda, mas **não garante, por si, identidade do signatário, representação de PJ ou validade automática**. Fonte https://www.planalto.gov.br/ccivil_03/mpv/antigas_2001/2200-2.htm

**LGPD Lei 13.709/2018 (arts. 6º, 7º, 9º, 11, 15/16, 18, 33, 37, 46/48):** minimização por finalidade, bases adequadas por operação (cadastro contratual, obrigação legal, exercício de direitos; WhatsApp com opt-in próprio de canal), aviso específico de parceiros, segurança, titular e eventual transferência internacional por fornecedor. Dados de saúde no **produto PepDay** são sensíveis, distintos de dados cadastrais do parceiro; afiliados não recebem históricos, usuários identificáveis nem dados de saúde. Fonte https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm e ANPD https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes

**Regras e segurança ANPD:** checklist de medidas técnicas/administrativas, incidente confirmado com risco/dano relevante sujeito a comunicação, verificação do enquadramento de pequeno porte e de prazos aplicáveis. Fonte https://www.gov.br/anpd/pt-br/centrais-de-conteudo/checklist-vf.pdf e https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis

**Regulação sanitária:** o site define o PepDay como calculadora/organizador matemático, não prescritor. Evitar publicidade que prometa cura, dose recomendada, segurança terapêutica ou tratamento. Qualquer alteração que forneça decisão clínica/terapêutica exige análise específica de enquadramento de software como dispositivo médico (SaMD) segundo RDC Anvisa 657/2022; disclaimer não substitui a finalidade real do produto. Fonte https://www.gov.br/anvisa/pt-br/assuntos/noticias-anvisa/2022/software-como-dispositivo-medico-perguntas-e-respostas/

**WhatsApp Business Messaging Policy (Meta):** fornecedor só inicia contato com pessoa que forneceu número e opt-in explícito para receber mensagens da empresa, deve respeitar opt-out; contato iniciado pela empresa exige template aprovado e fora da janela de 24 horas após mensagem do usuário só se comunica por template aprovado; revisar categoria/política da Meta, especialmente pois a marca é ligada ao contexto de saúde. Fonte https://business.whatsapp.com/policy/preview?lang=pt_BR

**Riscos de qualificação jurídica NÃO resolvidos por cláusula:** representação comercial/agência/afiliado, subordinação laboral e prestação de serviços dependem do funcionamento fático, não do título “parceiro independente”; a contadora define tratamento tributário da remuneração conforme caso. Parceiro pessoa jurídica precisa de representante com poderes; CPF, MEI e PJ podem exigir documentos fiscais diferentes. **Não presumir emprego nem ausência de vínculo como fato protegido por declaração.**

## 3. Minuta de referência — Contrato de Parceria de Divulgação e Indicação PepDay (NÃO VINCULANTE)

**Status:** `LEGAL-PARTNER-DRAFT-2026-10-11-1`, **DRAFT/JURÍDICO PENDENTE**. Não substituir `qa-draft-1` ativo nem habilitar aceite no portal até revisão independente e aprovação expressa. Campos entre [COLCHETES] são deliberadamente não preenchidos.

### Partes e definições
CONTRATANTE: [razão social completa da responsável pelo PepDay], [CNPJ e endereço cadastral conferidos], representada por [representante habilitado].
PARCEIRO: [nome/razão social], [CPF/CNPJ], [contato verificado], [representante legal se PJ].
“Plataforma”: aplicativo PepDay. “Indicação elegível”: indicação atribuída pelo código/QR aprovado e convertida no **primeiro pagamento** efetivamente confirmado conforme regras financeiras documentadas e versionadas, após a verificação de histórico completo.

### Cláusula 1 — Objeto e limites
A parceria tem por objeto divulgar o **software de organização e cálculo PepDay** por meios e materiais autorizados e encaminhar interessados voluntários pelo código/link de indicação. O parceiro **não vende medicamentos ou peptídeos em nome do PepDay**, não presta consulta, diagnóstico, prescrição ou orientação terapêutica, não representa legalmente a empresa nem vincula o PepDay a obrigação não autorizada.

### Cláusula 2 — Ativação, independência e boa-fé
A criação do cadastro, envio de documento ou leitura da minuta **não ativa** a parceria. A ativação depende da análise e autorização expressa do OWNER, identificação/representação regular, regra de comissão individual acordada por escrito e requisitos legais aplicáveis. Cada parte atua por sua conta dentro da realidade fática da relação, sem cláusula capaz de afastar direitos inderrogáveis. Não exclusividade/ausência de obrigação de resultados só se compatível com a prática efetiva.

### Cláusula 3 — Comissão e elegibilidade
Percentual **individual**, aceito em anexo comercial versionado, sem taxa padrão ou alteração unilateral retroativa. A elegibilidade observará a primeira cobrança efetivamente comprovada após a atribuição; renovações não geram nova comissão salvo aditivo futuro expresso. Estornos, chargebacks, autoindicação, valores não reconciliados e fraude são tratados com bloqueio/revisão e registro auditável. Regra já aprovada de **30 dias após pagamento confirmado**, além dos controles de reconciliação, é condição de liberação operacional, **não promessa de repasse incondicional**.

### Cláusula 4 — Pagamento, documentos e tributos
O repasse exige conciliação financeira, conferência do recebedor e PIX, autorização OWNER e requisitos contábeis/fiscais legais, podendo haver documento/retenção quando aplicável. A data exata de pagamento, competências, retenções e documentos por CPF/MEI/CNPJ serão anexados **após parecer da contadora**; até lá não definir prazo fixo, imposto padrão ou “pagamento antes e regularização depois”. O PepDay não executa PIX automático nem emite RPA/NFS-e. O documento não transfere à contadora a responsabilidade legal da empresa quando não permitido.

### Cláusula 5 — Regras de publicidade e marca
Utilizar somente identidade e peças aprovadas, identificar conteúdo publicitário quando aplicável e evitar promessas falsas, garantias de renda, alegações clínicas, doses, recomendações de substâncias ou uso de imagens/marcas de terceiros sem direitos. Vedar spam, bots não autorizados e divulgação a públicos impróprios. O link do parceiro é de divulgação; **nunca** é credencial para acessar cadastros privados.

### Cláusula 6 — Dados pessoais, sigilo e WhatsApp
PepDay recebe apenas dados necessários à qualificação/contrato/pagamento/legalidade, conforme aviso específico ao parceiro, e aplica controles de acesso e retenção definidos por finalidade. O parceiro não acessa CPF, dados financeiros, saúde, listas de clientes, e-mails pessoais dos usuários ou histórico do aplicativo; somente indicadores agregados necessários. Comunicações WhatsApp com opt-in distinto (registrado com texto/versão/data/canal/origem); opt-out imediato. Nenhuma obrigação contratual de aceitar marketing. Compartilhamento com contadora/prestadores apenas conforme finalidade, base legal, contratos de tratamento e eventuais salvaguardas de transferência internacional.

### Cláusula 7 — Segurança e documentos
Convites privados temporários com OTP do contato, revisão e trilha de auditoria. Documentos eventualmente necessários são enviados por portal privado, nunca em WhatsApp, sujeitos à matriz contábil/jurídica, finalidade, revisão e guarda pelo tempo legalmente justificado. O contrato não exige RG, CNH, selfie, comprovante de residência ou NFS-e como requisito universal sem avaliação da finalidade e da lei.

### Cláusula 8 — Irregularidades, revisão e término
O OWNER pode suspender novas indicações por fraude comprovada, descumprimento contratual ou risco legal, com motivo, comunicação e possibilidade adequada de contestação. Encerramento por ambas as partes conforme aviso e prazos **a negociar**, preservando prestações válidas/obrigações legais e conciliação de valores pendentes. Evitar confisco genérico de comissões já adquiridas ou rescisão desproporcional.

### Cláusula 9 — Provas eletrônicas e versão
A versão final aprovada será exibida integralmente ao parceiro antes de confirmar; evidência incluirá ID do contrato, hash SHA-256 de texto íntegro, versão, servidor/data, sessão/contato verificado, IP proporcional e ato inequívoco; nova versão material exigirá novo aceite quando aplicável. Verificação apenas de e-mail confirma posse da caixa, não identidade civil ou poderes de representante. Para documentos/assinatura com exigências formais específicas, adotar método apropriado.

### Cláusula 10 — Disputas e alterações
Resolução inicial administrativa documentada; forma de notificação, lei aplicável e foro **a serem ajustados por advogado** conforme tipo de contratante e equilíbrio contratual. Alteração futura de percentual não é retroativa e exige confirmação do parceiro. Não afirmar automaticamente que contrato é título executivo ou que assinatura eletrônica simples é assinatura qualificada.

**Anexos a preparar:** A) cadastro/representação; B) condições comerciais únicas por parceiro; C) matriz fiscal por CPF/MEI/PJ (contadora, em 13/10); D) aviso de privacidade do parceiro; E) opt-in WhatsApp separado; F) registro de aceite; G) política de documentos/retenção.

## 4. “Validação de segurança”: checklist objetivo antes de dados reais

**Base já evidenciada em TEST:** RLS/grants de schema privado e SQL negativo A/B, OTP QA limitado, token aleatório/hashed/TTL/replay, arquivos sintéticos privados, bloqueio de aceite/ativação, 538/538 serial, 27/27 arquivos e PROD preservada. **Isto não equivale a pentest independente nem a avaliação real de segurança.**

**Gate técnico adicional (PASS com evidências ou manter bloqueado):**
1. Revisão independente do código/arquitetura de Edge `partner-portal` (a Edge usa `verify_jwt=false` por desenho e deve verificar credenciais/autorizações em TODAS as rotas; não presumir que esse parâmetro seja falha sozinho).
2. Testes negativos de BOLA/IDOR entre parceiros A/B; escalonamento OWNER/ADMIN/VIEWER; token de convite nunca autentica sozinho; caso OTP errado/repetido/vencido; concorrência de sessões/revogação; contenção de abuso/IP e rate limit distribuído.
3. CSRF/CORS/same-origin, conteúdo sensível fora de URL/query/referrer/cache, TLS e headers, revisão de XSS e download/CSV injection.
4. Arquivos privados: MIME real/magic bytes, 5 MiB se mantida política, anti-malware e quarentena quando ativar upload real, path/ACL por parceiro, URLs temporárias, logs sem nome de arquivo sensível.
5. Segredos: verificar GitHub secret-scanning e alertas anteriores, revogar/rotacionar qualquer chave exposta antes de conexão real; ambiente TEST separado PROD; tokens Brevo/Meta em segredos de backend, nunca browser/repo; permissões mínimas.
6. Registros/observabilidade: sem OTP/token/documento/PIX/CPF completo em logs ou analytics, trilha de auditoria sem dados excessivos, opt-out imediato, backup/restauração e plano de incidente LGPD.
7. Validação ponta a ponta REAL de canal apenas com contato/tester explicitamente autorizado, confirmação de entrega/replay, falha/timeout, opt-out/webhook assinatura; não confundir mocks com entrega real.
8. Análise do contexto de **dados de saúde sensíveis do PepDay** (não compartilhados com parceiros), revisão de hipóteses art. 11, uso de fornecedores e finalidade real do software Anvisa.
9. Revisão adicional por profissional externo (advogado e teste de intrusão independente) **recomendada antes de coletar documentos/PIX/CPF reais**, não afirmar que todo software tem obrigação universal de pentest terceirizado.

**Referências:** OWASP ASVS 5.0 https://github.com/OWASP/ASVS/blob/master/5.0/en/0x16-V7-Session-Management.md e BOLA https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/ e checklist ANPD https://www.gov.br/anpd/pt-br/centrais-de-conteudo/checklist-vf.pdf

## 5. Decisão de arquitetura proposta para canais REAIS — PRONTA PARA IMPLEMENTAR OFFLINE

### OTP do parceiro — Brevo transacional por E-MAIL, separado de Supabase Auth cliente/Admin
**Escolha preferencial:** reutilizar infraestrutura Brevo transacional já mencionada no projeto, com remetente e domínio verificados. O próprio `partner-portal` mantém a sessão independente; não substituir a verificação de identidade pela conta SUPABASE de cliente/Admin. OTP de seis dígitos gerado no backend, curta validade/limitação existente; código entregue só ao **e-mail de contato cadastrado e conferido**, nunca retornado em endpoint real, nunca registrado em logs. Verificar status real do Brevo/domínio antes de marcar configurado; não presumir credencial válida. A confirmação prova acesso à caixa de e-mail, não CPF, CNPJ nem poderes de representação. Recusar ativação automática sem revisão OWNER. Canal de telefone/WhatsApp OTP fica como **fase opcional**, não requisito do primeiro lançamento.
**Variáveis PROPOSTAS (não necessariamente criadas):**
`PARTNER_OTP_PROVIDER=brevo_email`; `PARTNER_OTP_REAL_SEND_ENABLED=false`; `PARTNER_OTP_FROM_EMAIL`; `BREVO_API_KEY` (secret do backend); `PARTNER_OTP_SENDER_NAME=PepDay`; `PARTNER_OTP_MAX_ATTEMPTS`, `PARTNER_OTP_TTL_SECONDS` (valores efetivos já no SQL, não duplicar sem coordenação). Opcional usar SMTP Brevo dedicado em vez de API, conforme setup existente. Registrar secret somente no secret manager do serviço apropriado.
**Habilitação controlada:** domínio com SPF/DKIM/DMARC, templates de autenticação e entrega transacional testados; após autorização explícita de um destinatário próprio de teste, comprovar entrega e no replay; só ativar OTP para parceiros reais após bloqueios legais resolvidos. Referências: https://help.brevo.com/hc/pt/articles/7924908994450-Envie-e-mails-transacionais-usando-o-Brevo-SMTP e https://supabase.com/docs/guides/auth/auth-smtp

### WhatsApp — Meta WhatsApp Business Platform CLOUD API oficial, exclusivo PepDay
**Escolha preferencial:** Meta Cloud API direta, sem automação informal/WhatsApp Web, com número comercial **PepDay**; não reutilizar número pessoal/CenterPhone sem avaliar impacto. Necessários: Meta Business Portfolio, aplicativo Meta Developer com produto WhatsApp, WABA ID, Phone Number ID e número habilitado, tokens do usuário de sistema com escopos mínimos `whatsapp_business_messaging` e `whatsapp_business_management` quando necessário, webhook HTTPS validado por challenge e assinatura `X-Hub-Signature-256`, modelos de mensagem submetidos/aprovados (convite, lembrete D+2, D+5), consentimento comprovável e gerenciamento de opt-out e notificações de status.
**Regras:** salvar rascunho NUNCA envia. OWNER/ADMIN solicita convite e confirma; disparo real só após canal ativado, consentimento e template aprovado, com idempotência/eventos. D+2/D+5 excedem janela de 24 horas, portanto exigem modelos aprovados; conteúdo e categoria sujeitos à classificação/aprovação da Meta. Um link privado NÃO autoriza acesso sem OTP. Não incluir dados sensíveis/saúde/CPF/PIX na mensagem. Evitar promoção de peptídeos ou afirmações clínicas, inclusive risco de política Meta de produtos/serviços regulados.
**Variáveis PROPOSTAS:** `WHATSAPP_PROVIDER=meta_cloud`, `WHATSAPP_REAL_SEND_ENABLED=false`, `META_WABA_ID`, `META_PHONE_NUMBER_ID`, `META_ACCESS_TOKEN` [secret], `META_APP_SECRET` [secret], `META_WEBHOOK_VERIFY_TOKEN` [secret], `META_GRAPH_API_VERSION`, `META_TEMPLATE_INVITE`, `META_TEMPLATE_REMINDER_D2`, `META_TEMPLATE_REMINDER_D5`. Nenhuma variável existente é presumida. IDs não secretos podem ir em docs; NUNCA guardar tokens no Git, chat, frontend ou logs.
**Referências:** https://business.whatsapp.com/policy/preview?lang=pt_BR e coleção oficial Meta https://www.postman.com/meta/whatsapp-business-platform/overview e https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api

## 6. Pendências verdadeiras / proibições

**Sem necessidade de aguardar contadora:** minuta real com essas cláusulas, anexo de privacidade/opt-in do parceiro, revisão de segurança e configuração dry-run para Brevo/Meta, webhooks inertes, fila com switches falsos, testes de abuso/mocks.

**Pendente contadora 13/10:** matriz fiscal por CPF/MEI/CNPJ, natureza jurídica tributária da remuneração, retenções, documento obrigatório em cada etapa, competência e calendário, valor líquido e aceite de repasse; sem padrão presumido.

**Pendente fornecedor/usuário:** acesso/registro Meta Business/WABA/número de PepDay, verificação do domínio remetente Brevo, templates Meta aprovados, titularidade/representação legal; **sem confirmação NÃO afirmar que canais estão ativados**. Nenhum envio a terceiro real por esta revisão.

**Pendente profissional responsável:** revisão contratual específica por advogado habilitado (qualificação, representação, natureza da atividade, foro, riscos de vínculo, publicidade e LGPD) e recomendação de pentest independente; não prometer blindagem jurídica.

**Próxima ação executável curta:** implementar em branch separada TEST a interface com provedores Brevo/Meta e envios estritamente desabilitados por default, textos/templates, testes de assinatura de webhook e idempotência; registrar IDs não secretos quando obtidos, completar parecer da contadora e exigir habilitação expressa antes de uso real.
