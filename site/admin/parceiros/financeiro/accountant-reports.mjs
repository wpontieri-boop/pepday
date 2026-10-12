// Conferência contábil TEST — exportação local, informativa e sem liberação fiscal/pagamento.
// Este módulo NÃO calcula retenções, não gera obrigação fiscal e não retorna dados do cliente.
const HEADERS={
 pre:['Tipo','ExtraidoEmUTC','ParceiroID','ParceiroPublico','ComissaoID','SituacaoP3','ValorComissaoCentavos','ReservadoCentavos','PagoCentavos','LiberacaoPrevista','PercentualContratual','Plano','SituacaoContabil','RetencoesCentavos','LiquidoAutorizadoCentavos','Observacao'],
 post:['Tipo','ExtraidoEmUTC','ParceiroID','ParceiroPublico','LoteID','SituacaoP3','ValorRepasseCentavos','CriadoEmUTC','PagoEmUTC','RetencoesInformadasCentavos','LiquidoConciliadoCentavos','Observacao']
};
const safeInteger=v=>(typeof v==='number'&&Number.isSafeInteger(v)&&v>=0)?String(v):(typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&Number.isSafeInteger(Number(v)))?v:'';
const csvField=value=>{
 const str=String(value??'').replace(/[\r\n\t\0-\x1f]+/g,' ').trim();
 // Neutralize formula execution in Excel/Calc, including values preceded by whitespace.
 const protectedText=/^[=+\-@]/.test(str)?"'"+str:str;
 return '"'+protectedText.replaceAll('"','""')+'"';
};
const line=fields=>fields.map(csvField).join(';');
function requireOwner({dataset,role}){
 if(role!=='owner'||!dataset?.can_manage||!Array.isArray(dataset.partners)||!Array.isArray(dataset.commissions)||!Array.isArray(dataset.payouts))
  throw new Error('ACCOUNTANT_REPORT_UNAUTHORIZED');
}
export function createAccountantCsv(kind,{dataset,role,partnerId='',now=new Date()}){
 if(!Object.hasOwn(HEADERS,kind))throw new Error('ACCOUNTANT_REPORT_TYPE_INVALID');
 requireOwner({dataset,role});
 const instant=now instanceof Date&&Number.isFinite(now.getTime())?now.toISOString():null;
 if(!instant)throw new Error('ACCOUNTANT_REPORT_DATE_INVALID');
 const known=new Map(dataset.partners.map(p=>[p.id,p.public_name]));
 if(partnerId&&!known.has(partnerId))throw new Error('ACCOUNTANT_REPORT_PARTNER_INVALID');
 const name=id=>known.get(id)||'Parceiro não identificado';
 let rows;
 if(kind==='pre'){
  rows=dataset.commissions.filter(c=>known.has(c.partner_id)&&(!partnerId||c.partner_id===partnerId)).map(c=>[
   'CONFERENCIA_PRE',instant,c.partner_id,name(c.partner_id),c.id,c.state,
   safeInteger(c.earned_cents),safeInteger(c.reserved_cents),safeInteger(c.paid_cents),c.release_at||'',
   c.percent??'',c.plan||'','PENDENTE_DEFINICAO_CONTADORA','','',
   'Apenas para conferência; não autoriza PIX nem substitui bloqueios P3'
  ]);
 }else{
  rows=dataset.payouts.filter(p=>p.state==='paid'&&known.has(p.partner_id)&&(!partnerId||p.partner_id===partnerId)).map(p=>[
   'CONCILIACAO_POS',instant,p.partner_id,name(p.partner_id),p.id,'paid',
   safeInteger(p.total_cents),p.created_at||'',p.paid_at||'','','',
   'Conferir comprovante privado e retenções com contadora; não emitir documento fiscal automaticamente'
  ]);
 }
 const csv='\uFEFF'+[line(HEADERS[kind]),...rows.map(line)].join('\r\n')+'\r\n';
 return {csv,count:rows.length,filename:'pepday-'+(kind==='pre'?'pre-conferencia':'pos-conciliacao')+'-TEST-'+instant.slice(0,10)+'.csv'};
}
