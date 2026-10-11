# PepDay — P3: proposta de documentação fiscal autônoma do parceiro
Data: 11/10/2026 | Ambiente de planejamento: TEST | Status: DECISÃO DE PRODUTO / ESPECIFICAÇÃO — NÃO IMPLEMENTADO
Repositório/branch: wpontieri-boop/pepday · v3.0-bloco-b

## Decisão do proprietário (11/10/2026)

O **lojista ou afiliado que recebe comissões** deverá preencher pessoalmente as informações fiscais pertinentes, aceitar o contrato e enviar os documentos exigidos usando um **link individual seguro no celular**, sem receber senha ou autorização do Admin PepDay. O OWNER revisa, solicita correções e aprova apenas após conferir a documentação e as orientações contábeis/jurídicas. O sistema mantém a trava de comissões/repasses em caso de pendência.

**Não confundir os links:** `/cartao/?ref=...` e o código de indicação são públicos, servem para clientes e nunca autenticam parceiros. O novo convite é privado, temporário, sem dados cadastrais no endereço. Não permitir que um link público de indicação acesse cadastros, comprovantes ou arquivos.

### Atenção à compatibilidade com P1/P2

O P1 aprovado exige que o OWNER configure dados legais/PIX, percentual e valide a ativação. O P3 atual permite apenas ao OWNER enviar/validar arquivos. Esta decisão **solicita nova funcionalidade**, mas **não autoriza alterar silenciosamente P1/P2**. Projetar:
- Fase A: OWNER cria rascunho comercial, combina percentual e envia convite ao contato cadastrado; parceiro informa/complementa suas próprias informações e documentos. O sistema recebe em estado `submitted/pending_review`; nunca ativa automaticamente.
- Fase B: OWNER revisa identidade/PIX/documentos e realiza a ativação explicitamente (com proteção existente de senha/TOTP/step-up conforme a ação). Habilitar código de indicação somente sob os requisitos atuais P1; regra de comercialização permanece intacta.
- Quando a implementação permitir que o parceiro **grave CPF/CNPJ/PIX antes preenchidos pelo OWNER**, tratar como **alteração nova ao fluxo P1, em TEST isolado**, com revisão de permissões, testes específicos e autorização expressa antes de implantação. Até esse ajuste, o link de documentação não pode alterar o perfil financeiro P1 e o OWNER ainda participa da ativação.
- O envio documental **não** modifica percentuais de comissão, não aprova documentos/tributos, não libera pagamentos e não permite acesso a dados de consumidores.

## Experiência pretendida

1. No Admin, criar rascunho comercial e escolher `Convidar para documentação` para o contato já conferido. Mostrar convite pendente/enviado/expirado/concluído; reemissão revoga link anterior. Não enviar convite sem confirmação explícita do OWNER.
2. O parceiro recebe **convite privado** via canal confirmado; ao abrir, vê nome público da parceria, propósito do tratamento, política de privacidade e procedimento de verificação (código de uso único enviado ao contato registrado). Não exibir PII antes da verificação.
3. Após autenticação individual, o parceiro confirma dados próprios, visualiza contrato versionado e aceita eletronicamente; envia **apenas os documentos habilitados para seu enquadramento**, com nome e finalidade claros, dentro do portal. Permitir salvar/retomar e substituir pendências, sempre sem editar diretamente documento já aprovado ou dados sensíveis sem revalidação.
4. No Admin, OWNER recebe itens `recebido`, `em análise`, `corrigir`, `aprovado` com motivo, autor/data, arquivo privado e audit trail; documentos de pagamento futuro permanecem fluxo da empresa, não exigência antecipada do parceiro.
5. Erros seguros: link vencido/revogado, limite de tentativas, upload inválido, indisponibilidade; sem vazamento de existência de parceiro ou cadastro via enumeração. Leitura permitida só do parceiro autenticado e seus próprios itens.

## Regras mínimas de segurança — aceitação técnica

- Convite aleatório imprevisível, armazenado por hash, curto, revogável, expirável, nunca em logs/analytics/referrer. Link sozinho **não** autoriza leitura ou upload; conferir posse de e-mail/telefone por OTP com expiração e rate limiting, vinculando a sessão ao partner_id no servidor. Não adicionar role administrativa nem usar `partner_id` do cliente como prova de autorização.
- Sessão parceira distinta das sessões de cliente e Admin; CSRF/CORS, proteção de replay, anti-bruteforce e resposta genérica para URLs inválidas. Inspecionar riscos de e-mail/telefone público do parceiro e de vazamento por preview de WhatsApp. Nunca incluir documentos no próprio WhatsApp.
- Upload por interface isolada com autorização servidor para parceiro autenticado: PDF/PNG/JPEG, limite 5 MiB já usado por P3, checagem de assinatura de arquivo e SHA-256, bucket **privado TEST**; proibir URLs públicas ou permissões Storage amplas. O backend atual `partner-documents` só autoriza OWNER: **não remover nem relaxar guardas**; criar caminho/par de grants específico para o parceiro, com RLS/isolamento entre A/B e acesso de administrador separado.
- Políticas de finalidade/necessidade LGPD. Informar base legal correta (execução de contrato/obrigação legal conforme caso, não fingir consentimento como base universal); limitar coleta, acesso e retenção. Nunca pedir cópia integral de RG/CNH ou selfie automaticamente, nem extrato bancário, cartão, senha, código TOTP, token, dado de saúde, documento de consumidor.
- Aceite eletrônico precisa guardar texto e versão do contrato, data do servidor, vínculo autenticado e hash, com evidência proporcional; validade jurídica/formato da assinatura devem ser aprovados por advogado. Não presumir que checkbox equivale a assinatura qualificada.
- Sem dados pessoais reais em TEST; fixtures sintéticas isoladas, com rollback/limpeza de storage. Sem uploads do PDF humano já marcado PASS/NÃO REPETIR; testar somente o fluxo novo.
- Configuração de tipos de documento e obrigatoriedade `draft/under_review/approved` baseada em matriz validada por contabilidade/jurídico. **Nenhuma alíquota, prazo de guarda, documento obrigatório ou aprovação fiscal padrão é presumido**. Não ativar coleta real antes da política aprovada.
- Manter P1/P2/PROD, permissões OWNER/ADMIN/VIEWER, MFA, step-up, liberação manual e bloqueio fiscal intactos.

## Proposta jurídica/contábil preliminar — a VALIDAR (não normativa)

### Comuns aos dois tipos
- Dados identificadores estritamente necessários: nome completo ou razão social, CPF/CNPJ verificado, contato autenticado, endereço/localidade **somente se necessário para obrigações fiscais/contratuais**, nome do recebedor e dados PIX conforme P1; aceite do contrato de indicação/comissionamento e ciência da privacidade.
- Não exigir envio de documento de identificação com foto como requisito universal. Preferir validação do CPF/CNPJ por informação digitada/consulta oficial, e verificação documental adicional proporcional ao risco de fraude; manter canal de correção.
- Contrato disciplinando divulgação e uso do código, % combinado, primeira cobrança elegível, prazo de 30 dias da comissão já aprovada, devoluções/estornos, suspensão, manualidade do repasse, responsabilidades de dados e publicidade, dados bancários, obrigações fiscais e foro/solução de disputas — revisão jurídica própria.
- Comprovante de **repasse** é produzido/registrado pela empresa pagadora depois do pagamento, **não** é arquivo obrigatório a solicitar antecipadamente ao parceiro.

### Pessoa física (CPF) — sugestão de campos/arquivos
- Dados: nome completo, CPF, contato confirmado, endereço/município quando necessário, titular/chave PIX; aceitação contratual.
- **Avaliar com a contadora** se a comissão é remuneração de serviços, indicação/agenciamento, outra natureza; se deve emitir Recibo de Pagamento a Autônomo (RPA)/recibo equivalente **pela pagadora**, como comprovar o pagamento e calcular IRRF, INSS, eventual ISS e declarações eSocial/EFD-Reinf. Não tratar `RPA` como documento que todo parceiro obrigatoriamente envia e não inventar alíquotas.
- Comprovante de situação cadastral CPF pode ser consultado na Receita quando necessário; cópia RG/CNH, selfie e comprovante de residência somente mediante justificativa antifraude/tributária formal, não como padrão.

### Pessoa jurídica (CNPJ, inclusive MEI) — sugestão de campos/arquivos
- Dados: razão social/nome empresarial, CNPJ, inscrição municipal e endereço apenas se necessários ao faturamento, enquadramento (MEI, Simples, outros), contato, representante autorizado e PIX de titularidade compatível, aceitação contratual.
- Situação cadastral CNPJ consultável na Receita Federal; evitar upload de PDF se a validação eletrônica for suficiente. Para MEI, comprovante CCMEI **se a contabilidade achar necessário** para checar enquadramento/atividade. Contrato social/documento de representação/procuração **somente quando não houver outro meio proporcional** de comprovar poderes.
- **NFS-e ou outro documento fiscal adequado** relativo à comissão de serviço: comprovar a natureza da operação, o enquadramento tributário, o município e a competência com a contadora; normalmente é documento emitido para a cobrança/pagamento aplicável, não algo a exigir antes de a comissão existir. MEI que presta serviços à pessoa jurídica deve emitir NFS-e nacional, conforme Portal NFS-e; Receita divulgou adoção da NFS-e Nacional por ME/EPP do Simples em 01/11/2026, com ressalvas de enquadramento.

### Políticas a serem definidas formalmente
- Matriz do que pedir **na entrada**, **antes do primeiro repasse** e **a cada pagamento**; quem emite o quê; se a atividade de publicidade/afiliados é permitida no enquadramento do MEI e qual código de serviço/ISS se aplica.
- Tributos e retenções PF/PJ; se existem obrigações de escrituração no eSocial, EFD-Reinf, DCTFWeb e respectivas competências; despesas e obrigações da empresa pagadora.
- Base legal LGPD, minimização de documentos, política de armazenamento e prazo/fato inicial de guarda individual por categoria; tratamento de suspensão/desligamento e direito do titular. Não configurar `months`, `start_event` ou marcar `validated` sem parecer.

## Fontes oficiais consultadas em 11/10/2026

- Receita Federal — consulta pública de CPF: https://www.gov.br/pt-br/servicos/consultar-cadastro-de-pessoas-fisicas
- Receita Federal — emissão do comprovante de CNPJ: https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/Cnpjreva_S.aspx
- Portal da NFS-e — MEI prestadores: https://www.gov.br/nfse/pt-br/mei-prestadores-de-servico-de-todo-o-pais-estao-obrigados-a-emitir-nfs-e
- Receita Federal (14/08/2026) — ME/EPP Simples e NFS-e Nacional desde 01/11/2026: https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/agosto/simples-nacional-nfs-e-nacional-sera-obrigatoria-para-me-e-epp-a-partir-de-1o-de-novembro-de-2026
- Receita Federal — Contribuições previdenciárias PJ (pagamentos a contribuinte individual): https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/tributos/contribuicoes-previdenciarias-pj
- Receita Federal — pagamentos PF/PJ no EFD-Reinf e distinção eSocial: https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/perguntas-frequentes/sped/efd-reinf/efdr/1-geral/1-17-as-informacoes-sobre
- ANPD — FAQ de hipóteses legais LGPD: https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes
- ANPD — Guia de segurança para pequeno porte: https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-orientativo-sobre-seguranca-da-informacao-para-agentes-de-tratamento-de-pequeno-porte
- ANPD — glossário, princípio da necessidade: https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/glossario-anpd/p

## Texto para enviar à contadora em 13/10/2026 (terça-feira)

Olá! Estamos estruturando o programa de parceiros do PepDay, um aplicativo de assinatura. Lojas, influenciadores ou pessoas físicas indicam assinantes por um código/QR e recebem comissão sobre a primeira assinatura paga elegível, conforme contrato; o repasse é manual e só depois dos controles financeiros/fiscais. Queremos cadastrar parceiros tanto CPF quanto CNPJ/MEI.

Você pode nos orientar, por escrito, sobre:
1. Qual a natureza fiscal mais adequada da comissão por indicação/divulgação para PF, MEI, Simples e demais CNPJ? Há alguma restrição relevante de atividade/CNAE no MEI?
2. Quais dados e documentos são realmente necessários **na adesão** e quais devem ser apresentados **apenas antes de um repasse**? Podemos validar CPF/CNPJ por consulta, sem guardar foto de RG/contrato social?
3. Para CPF, o pagamento exige RPA/recibo emitido pela empresa, INSS/IRRF/ISS ou outra retenção? Quem gera/assina, quando recolhe e quais eventos eSocial/EFD-Reinf/DCTFWeb se aplicam?
4. Para CNPJ/MEI, quando precisamos de NFS-e e qual descrição/código de serviço e tratamento tributário recomendados? Quais retenções podem variar com regime e município?
5. Quem deve emitir, guardar e disponibilizar recibo, NFS-e e comprovante PIX; qual prazo de guarda e marco inicial para cada um?
6. Como parametrizar cadastro, bloqueio e conferência de valores para não autorizar pagamentos indevidos?

Queremos que o parceiro preencha e envie seus próprios documentos num portal privado, e que o OWNER aprove somente após validação. **Por favor, aponte o mínimo documental por CPF/CNPJ e a matriz de obrigações por evento**, sem adotar automaticamente percentuais ou exigir arquivos desnecessários. O contrato e as regras de privacidade também passarão por revisão jurídica.

## Estado de trabalho e próxima ação

Este documento é um **planejamento**: o novo portal público/privado de parceiros ainda **não está implementado, testado ou publicado**. Somente P1/P2 existentes e P3 fiscal Admin/TEST anteriores continuam nos estados de PASS registrados. Próxima ação técnica: **construir o fluxo de convite/verificação/upload isolado em TEST sem alterar P1/P2 e sem ativar exigências documentais não homologadas**; ao receber o parecer contábil e jurídico, configurar a matriz de obrigatoriedade e validar antes de considerar PROD. Evitar misturar backlog antigo de P5 mini painel com novo portal restrito a documentos.
