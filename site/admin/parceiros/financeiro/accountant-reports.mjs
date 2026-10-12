// OWNER-only informational TEST CSV. No tax calculation, document issuance or payment.
const HEADERS={
 pre:['Tipo','ExtraidoEmUTC','ParceiroID','ParceiroPublico','ComissaoID','SituacaoP3','ValorComissaoCentavos','ReservadoCentavos','PagoCentavos','LiberacaoPrevista','PercentualContratual','Plano','SituacaoContabil','RetencoesCentavos','LiquidoAutorizadoCentavos','Observacao','PagamentoOrigemUTC','ReferenciaOrigem','BrutoOrigemComprovadoCentavos','ReembolsoComprovadoCentavos','HistoricoComprovado','BloqueioFiscal','CompetenciaFiscal','MesDataFonte'],
 post:['Tipo','ExtraidoEmUTC','ParceiroID','ParceiroPublico','LoteID','SituacaoP3','ValorRepasseCentavos','CriadoEmUTC','PagoEmUTC','RetencoesInformadasCentavos','LiquidoConciliadoCentavos','Observacao','DocumentoComprovanteID','CompetenciaFiscal','MesDataFonte'],
 adjustments:['Tipo','ExtraidoEmUTC','ParceiroID','ParceiroPublico','ComissaoID','Evento','DiferencaCentavos','EventoEmUTC','CompetenciaFiscal','MesDataFonte','Observacao']
};
const safeInteger=v=>(typeof v==='number'&&Number.isSafeInteger(v)&&v>=0)?String(v):(typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&Number.isSafeInteger(Number(v)))?v:'';
const signedInteger=v=>/^-?(0|[1-9][0-9]*)$/.test(String(v))&&Number.isSafeInteger(Number(v))?String(v):'';
const csvField=value=>{
 const str=String(value??'').replace(/[\r\n\t\0-\x1f]+/g,' ').trim();
 const protectedText=/^[=+\-@]/.test(str)?"'"+str:str;
 return '"'+protectedText.replaceAll('"','""')+'"';
};
const line=fields=>fields.map(csvField).join(';');
function requireOwner({dataset,role}){
 if(role!=='owner'||!dataset?.can_manage||!Array.isArray(dataset.partners)||!Array.isArray(dataset.commissions)||!Array.isArray(dataset.payouts))throw Error('ACCOUNTANT_REPORT_UNAUTHORIZED');
}
export function createAccountantCsv(kind,{dataset,role,partnerId='',month='',now=new Date()}){
 if(!Object.hasOwn(HEADERS,kind))throw Error('ACCOUNTANT_REPORT_TYPE_INVALID');
 requireOwner({dataset,role});
 if(month&&!/^(20[0-9]{2})-(0[1-9]|1[0-2])$/.test(month))throw Error('ACCOUNTANT_REPORT_MONTH_INVALID');
 const instant=now instanceof Date&&Number.isFinite(now.getTime())?now.toISOString():null;
 if(!instant)throw Error('ACCOUNTANT_REPORT_DATE_INVALID');
 const known=new Map(dataset.partners.map(p=>[p.id,p.public_name]));
 if(partnerId&&!known.has(partnerId))throw Error('ACCOUNTANT_REPORT_PARTNER_INVALID');
 const name=id=>known.get(id)||'Parceiro não identificado';
 const sourceMonth=value=>{
 if(!value||!Number.isFinite(Date.parse(value)))return '';
 const parts=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',timeZone:'America/Sao_Paulo'}).formatToParts(new Date(value));
 return parts.find(p=>p.type==='year').value+'-'+parts.find(p=>p.type==='month').value;
 };
 const included=(row,date)=>known.has(row.partner_id)&&(!partnerId||row.partner_id===partnerId)&&(!month||sourceMonth(date)===month);
 let rows;
 if(kind==='pre'){
 rows=dataset.commissions.filter(c=>included(c,c.source_date)).map(c=>[
 'CONFERENCIA_PRE',instant,c.partner_id,name(c.partner_id),c.id,c.state,
 safeInteger(c.earned_cents),safeInteger(c.reserved_cents),safeInteger(c.paid_cents),c.release_at||'',
 c.percent??'',c.plan||'','PENDENTE_DEFINICAO_CONTADORA','','',
 'Apenas para conferência; não autoriza PIX nem substitui bloqueios P3',c.source_date||'',c.source_reference||'',
 c.history_complete===true?safeInteger(c.gross_cents):'',c.history_complete===true?safeInteger(c.refunded_cents):'',
 c.history_complete===true?'COMPROVADO':'PENDENTE',c.fiscal_ready===true?'LIBERADO_PELAS_GUARDAS':'PENDENTE','',sourceMonth(c.source_date)
 ]);
 }else if(kind==='post'){
 rows=dataset.payouts.filter(p=>p.state==='paid'&&included(p,p.paid_at)).map(p=>[
 'CONCILIACAO_POS',instant,p.partner_id,name(p.partner_id),p.id,'paid',
 safeInteger(p.total_cents),p.created_at||'',p.paid_at||'',
 p.fiscal_state==='approved'?safeInteger(p.withheld_cents):'',p.fiscal_state==='approved'?safeInteger(p.net_cents):'',
 'Conferir comprovante privado e retenções com contadora; não emitir documento fiscal automaticamente',p.proof_document_id||'','',sourceMonth(p.paid_at)
 ]);
 }else{
 if(!Array.isArray(dataset.adjustments))throw Error('ACCOUNTANT_REPORT_HISTORY_UNAVAILABLE');
 rows=dataset.adjustments.filter(a=>included(a,a.created_at)).map(a=>[
 'HISTORICO_AJUSTES',instant,a.partner_id,name(a.partner_id),a.commission_id,a.kind,signedInteger(a.amount_cents),a.created_at||'','',sourceMonth(a.created_at),
 'Evento histórico; não autoriza pagamento. Competência fiscal pendente de contadora'
 ]);
 }
 return {csv:'\uFEFF'+[line(HEADERS[kind]),...rows.map(line)].join('\r\n')+'\r\n',count:rows.length,
 filename:'pepday-'+({pre:'pre-conferencia',post:'pos-conciliacao',adjustments:'historico-ajustes'}[kind])+'-TEST-'+instant.slice(0,10)+(month?'-fonte-'+month:'')+'.csv'};
}
