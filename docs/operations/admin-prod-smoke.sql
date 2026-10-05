-- Smoke transacional; simula claims no banco, não comprova login humano.
-- Não cria usuários, não envia mensagens e desfaz cupons/memberships/logs.
begin;
select set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'role','authenticated','aal','aal1')::text,true)
from public.admin_memberships where access_level='owner' and active;
set local role authenticated;
do $$ begin
  begin perform public.get_admin_promo_codes(); raise exception 'FAIL: AAL1 aceito';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'role','authenticated','aal','aal2')::text,true)
from public.admin_memberships where access_level='owner' and active;
set local role authenticated;
do $$ begin
  perform public.get_admin_team();
  perform public.get_admin_acquisition_metrics(30);
  perform public.get_admin_pwa_metrics(30);
  perform public.get_admin_card_campaign_metrics(30);
  perform public.get_admin_audit_logs(50);
  begin perform public.admin_disable_team_member(auth.uid()); raise exception 'FAIL: OWNER removido';
  exception when insufficient_privilege then null; end;
  perform public.admin_generate_promo_code(30,null,null);
end $$;
reset role;
do $$ begin
  if not exists(select 1 from public.admin_audit_logs where actor_user_id=auth.uid() and action='promo_code_generated') then
    raise exception 'FAIL: auditoria ausente';
  end if;
end $$;
update public.admin_memberships set access_level='viewer' where user_id=auth.uid();
set local role authenticated;
do $$ begin
  perform public.get_admin_promo_codes();
  begin perform public.admin_generate_promo_code(30,null,null); raise exception 'FAIL: VIEWER escreveu';
  exception when insufficient_privilege then null; end;
  begin perform public.get_admin_team(); raise exception 'FAIL: VIEWER gerencia equipe';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.admin_memberships set access_level='admin' where user_id=auth.uid();
set local role authenticated;
do $$ begin
  perform public.admin_generate_promo_code(30,null,null);
  begin perform public.get_admin_team(); raise exception 'FAIL: ADMIN gerencia equipe';
  exception when insufficient_privilege then null; end;
  begin perform public.get_admin_audit_logs(50); raise exception 'FAIL: ADMIN le auditoria OWNER';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.admin_memberships set active=false where user_id=auth.uid();
set local role authenticated;
do $$ begin
  begin perform public.get_admin_promo_codes(); raise exception 'FAIL: inativo entrou';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'PASS: AAL1 negado; OWNER metrics/team/audit; OWNER protegido; VIEWER leitura; ADMIN escrita sem equipe; inativo negado; auditoria gerada; rollback completo' as result;
