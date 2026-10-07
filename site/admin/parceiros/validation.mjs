export const normalizeDocument=value=>String(value??'').toUpperCase().replace(/[. /-]/g,'');
export function validDocument(value){
  const d=normalizeDocument(value);
  if(/^(\d)\1+$/.test(d))return false;
  if(/^\d{11}$/.test(d)){
    for(let j=9;j<11;j++){let total=0;for(let i=0;i<j;i++)total+=Number(d[i])*(j+1-i);let digit=total*10%11;if(digit===10)digit=0;if(digit!==Number(d[j]))return false}return true;
  }
  if(/^[A-Z0-9]{12}\d{2}$/.test(d)){
    for(let j=12;j<14;j++){let total=0,w=2;for(let i=j-1;i>=0;i--){total+=(d.charCodeAt(i)-48)*w;w=w===9?2:w+1}const digit=total%11<2?0:11-total%11;if(digit!==Number(d[j]))return false}return true;
  }return false;
}
export function normalizePix(type,value){return ['cpf','cnpj'].includes(type)?normalizeDocument(value):String(value??'').trim()}
export function validPix(type,value){
  const v=normalizePix(type,value);if(v.length<3||v.length>254)return false;
  switch(type){case 'cpf':return /^\d{11}$/.test(v)&&validDocument(v);case 'cnpj':return /^[A-Z0-9]{12}\d{2}$/.test(v)&&validDocument(v);case 'email':return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);case 'phone':return /^\+[0-9]{10,15}$/.test(v);case 'random':return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);default:return false}
}
export function financialErrors(p){
  const errors={};
  for(const [key,label] of [['legal_name','nome / razão social'],['payee_name','titular do pagamento']])if(String(p[key]||'').trim().length<2||String(p[key]).length>160)errors[key]=`Informe ${label} (2 a 160 caracteres).`;
  if(!validDocument(p.document))errors.document='Informe CPF ou CNPJ válido, com dígitos verificadores.';
  if(!['cpf','cnpj','email','phone','random'].includes(p.pix_type))errors.pix_type='Selecione o tipo de chave PIX.';
  if(!validPix(p.pix_type,p.pix_key))errors.pix_key={cpf:'Informe um CPF válido para esta chave PIX.',cnpj:'Informe um CNPJ válido para esta chave PIX.',email:'Informe um e-mail válido para esta chave PIX.',phone:'Use + e código do país, com 10 a 15 dígitos.',random:'Informe a chave aleatória completa (formato UUID).'}[p.pix_type]||'Selecione o tipo e informe a chave PIX.';
  if(!/^\d{1,3}(\.\d{1,2})?$/.test(String(p.commission_percent))||Number(p.commission_percent)>100)errors.commission_percent='Informe de 0 a 100, com até 2 casas decimais.';
  if(!['configuracao_inicial','ajuste_contratual','correcao_pagamento'].includes(p.reason))errors.reason='Selecione o motivo da configuração.';
  return errors;
}
