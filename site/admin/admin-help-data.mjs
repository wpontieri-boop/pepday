// Conteúdo operacional não sensível: os dados ficam no painel autenticado.
// Atualizar junto às telas e docs/CURRENT-STATE.md; nunca publicar segredos ou dados de clientes.
export const helpVersion='2026-10-11';
export const helpTopics=[
 {id:'acesso',title:'Entrar no painel com segurança',category:'Admin',status:'Disponível',roles:['OWNER','ADMIN','VIEWER'],steps:[
 'Acesse /admin/ no ambiente correto (PROD ou homologação).',
 'Informe seu próprio e-mail e senha administrativa; confirme o código do aplicativo autenticador quando solicitado.',
 'Confira o papel exibido: OWNER, ADMIN ou VIEWER. Use apenas as ações liberadas ao seu perfil.',
 'Ao terminar ou trocar de operador, use Sair. Não compartilhe senha, código TOTP ou sessão.'
 ],note:'A sessão operacional sensível tem restrições de tempo. Uma sessão expirada pede novo login completo, não contorno por atualização da página.'},
 {id:'dashboard',title:'Entender o painel e o funil',category:'Admin',status:'Disponível',roles:['OWNER','ADMIN','VIEWER'],steps:[
 'Na tela inicial escolha 7, 30 ou 90 dias para as métricas de aquisição.',
 'Leia separadamente novas contas, cartão/QR, trials, PRO pago e recuperação; não some grupos sobrepostos.',
 'Cartão/QR no painel representa atribuição de conta, não leitura anônima de QR.',
 'Verifique a atualização e interprete “—” como ausência de base adequada, nunca como taxa zero.'
 ],note:'Códigos de cortesia e cartão físico de 30 dias são benefícios diferentes. Uma conversão paga depende de cobrança aprovada.'},
 {id:'cartao',title:'QR Code e cartão de 30 dias',category:'Comercial',status:'Disponível',roles:['OWNER','ADMIN','VIEWER'],steps:[
 'O QR público do cartão encaminha clientes a /cartao/ e oferece 30 dias PRO conforme regras de elegibilidade.',
 'Para indicar uma loja específica, use /cartao/?ref=slug do parceiro já ATIVO ou o código de indicação público.',
 'Um parceiro em rascunho pode ter um código reservado, mas ele ainda não atribui clientes.',
 'Consulte indicadores de origem no Admin; cliques e intenções não equivalem a comissões pagas.'
 ],note:'Não confunda QR de cliente com convite PRIVADO para cadastro documental do parceiro. O convite ainda está planejado.'},
 {id:'promo',title:'Criar códigos PRO de cortesia',category:'Promoções',status:'Disponível — conforme permissão',roles:['OWNER'],steps:[
 'Entre em “Códigos PRO de cortesia” no Admin.',
 'Escolha a duração aprovada: 30, 60 ou 90 dias.',
 'Defina a validade do resgate e, se necessário, o e-mail exclusivo destinatário.',
 'Confirme a criação e copie o código de forma segura; use a busca para consultar situação e resgates.'
 ],note:'Código de cortesia é de uso único e não é o QR do cartão. Respeite validações, elegibilidade e permissões atuais; não prometa emissão para contas sem conferência.'},
 {id:'parceiros',title:'Cadastrar um parceiro em uma visita',category:'Parceiros',status:'Disponível — cadastro P1/P2',roles:['OWNER','ADMIN'],steps:[
 'Acesse Admin > Parceiros & Afiliados > Cadastrar parceiro.',
 'Preencha nome público, tipo de parceiro, cidade, descrição e contato comercial/WhatsApp.',
 'Clique Salvar cadastro para criar um RASCUNHO. Esse ato não envia convite e não ativa o código.',
 'O OWNER completa e confere dados legais, destinatário/PIX e percentual individual antes de ativar.',
 'Depois da ativação, compartilhe o código/link de indicação público do parceiro.'
 ],note:'O novo convite privado por WhatsApp, preenchimento pelo próprio parceiro e lembretes D+2/D+5 estão APROVADOS COMO PRODUTO, mas AINDA NÃO IMPLEMENTADOS.'},
 {id:'financeiro-cadastro',title:'Configuração financeira de parceiros',category:'Parceiros',status:'Disponível — conforme permissão',roles:['OWNER'],steps:[
 'Na ficha do parceiro, abra Configuração financeira · OWNER.',
 'Confira nome/razão social, CPF/CNPJ, titular, tipo/chave PIX e percentual individual acordado.',
 'Selecione o motivo apropriado e salve ou ative apenas após conferir os dados.',
 'Para mudar dados financeiros após a primeira ativação, siga o desafio adicional de senha e novo TOTP.'
 ],note:'Não existe percentual padrão. Não digite senhas nem códigos de autenticação em campo de observações.'},
 {id:'comissoes',title:'Consultar comissões e repasses',category:'Financeiro',status:'Somente homologação (P3 TEST)',roles:['OWNER'],steps:[
 'Em homologação, entre em Parceiros > Comissões e repasses · TEST.',
 'Escolha o parceiro e consulte valores, revisão, reconciliação e estados das comissões.',
 'A elegibilidade exige a regra de liberação após 30 dias do primeiro pagamento confirmado e demais controles.',
 'Repasses são MANUAIS e feitos fora do PepDay. O sistema nunca transfere PIX automaticamente.',
 'Não confirme lote como pago sem comprovante/referência privados, valor e data exatos e autorização.'
 ],note:'P3 financeiro ainda não foi promovido a PROD. Não use valores sintéticos de TEST como repasses reais.'},
 {id:'fiscal',title:'Fiscal e documentos',category:'Financeiro',status:'Somente homologação (P3 TEST)',roles:['OWNER'],steps:[
 'Em homologação, entre em Parceiros > Comissões e repasses > Fiscal e documentos.',
 'Selecione o parceiro e confira se CPF/CNPJ, situação e bloqueios estão corretos.',
 'Só envie documento quando tipo, arquivo e campos exigidos estiverem completos.',
 'Retenções, guarda documental, aprovação fiscal e líquido dependem de parecer da contadora/jurídico.',
 'Enquanto houver pendências obrigatórias, o sistema bloqueia a liberação e confirmação do repasse.'
 ],note:'CPF sintético, CNPJ visual e QA do upload privado já têm evidências técnicas/humanas específicas no projeto. Não repetir PASS / NÃO REPETIR sem motivo.'},
 {id:'contabilidade',title:'Fechamento mensal e relatório para a contadora',category:'Financeiro',status:'Somente homologação — exportação preliminar TEST',roles:['OWNER'],steps:[
 'No Admin TEST, abra Parceiros > Comissões e repasses > Relatórios para a contadora.',
 'Clique Exportar conferência pré-pagamento para baixar CSV de comissões, estados, valores em centavos e datas disponíveis, sem autorização de PIX.',
 'Clique Exportar conciliação pós-pagamento para baixar somente os lotes com estado PAGO no P3, usando valores e datas disponíveis.',
 'Os campos de retenções e líquido conciliado permanecem VAZIOS até confirmação da contadora; nunca interprete vazio como zero.',
 'O fechamento, as retenções CPF/MEI/CNPJ e o aviso documental continuam aguardando parecer contábil.'
 ],note:'CSV informativo exclusivo TEST, autorizado apenas ao OWNER. Não libera repasse, não envia WhatsApp, não inclui CPF/PIX nem emite NFS-e/RPA.'},
 {id:'convites',title:'Convite WhatsApp e documentação do parceiro',category:'Parceiros',status:'Planejado — não publicado',roles:['OWNER','ADMIN'],steps:[
 'Fluxo aprovado: ao cadastrar o parceiro, operador confirmará o botão Enviar convite pelo WhatsApp; salvar rascunho não envia mensagem.',
 'O convite será individual, temporário e verificado, diferente do link/QR público de indicação.',
 'O parceiro completará dados e aceite; lembretes condicionais serão D+2 e D+5 para quem continuar pendente.',
 'Documentos cadastrais tendem a ser coletados uma vez. Notas ou comprovantes fiscais podem ser exigidos por competência, conforme a contadora.'
 ],note:'Portal, envio pelo WhatsApp e lembretes não foram implementados. Não envie documentos sensíveis pelo WhatsApp como substituto do portal.'},
 {id:'equipe',title:'Equipe, funções e auditoria',category:'Segurança',status:'Disponível — conforme permissão',roles:['OWNER'],steps:[
 'No Admin, acesse Equipe administrativa para consultar OWNER, ADMIN e VIEWER.',
 'Atribua o menor nível de acesso necessário às responsabilidades de cada pessoa.',
 'Use contas individuais e confirme as ações sensíveis com autenticação reforçada quando solicitada.',
 'Consulte Auditoria para identificar alterações; não compartilhe credenciais, chaves ou informações de clientes.'
 ],note:'ADMIN não pode alterar financeiro protegido; VIEWER é leitura. Nunca repasse a conta do OWNER a um funcionário.'},
 {id:'ajuda',title:'Pesquisar, consultar e imprimir instruções',category:'Treinamento',status:'Disponível nesta central (TEST)',roles:['OWNER','ADMIN','VIEWER'],steps:[
 'Abra a Central de Ajuda no painel após seu login.',
 'Digite palavras como cadastro, QR, cupom, comissão ou segurança no campo de pesquisa.',
 'Abra um guia para ver passos e cuidados. Guias restritos são exibidos apenas ao perfil autorizado.',
 'Clique Imprimir guias para gerar uma versão impressa/PDF dos tópicos autorizados.',
 'Consulte o Manual Operacional PepDay em Word para treinamento completo e checklists.'
 ],note:'Se uma tela divergir do guia, suspenda a operação sensível e peça revisão das instruções; não improvise procedimentos financeiros.'}
];
export function normalized(text){return String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();}
export function visibleTopics({role,query='',topics=helpTopics}){
 const needle=normalized(query);
 return topics.filter(topic=>topic.roles.includes(role)&&(!needle||normalized([topic.title,topic.category,topic.status,...topic.steps,topic.note].join(' ')).includes(needle)));
}
