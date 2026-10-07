-- Synthetic partners only, shared local/TEST suite; existing human QA is never edited.
do $$declare p uuid; archived uuid; draft uuid; t uuid; payload jsonb; patch jsonb;
 before_profile jsonb; data jsonb; err text; original jsonb:=auth.jwt(); n integer; role_name text;
begin
 p:=public.admin_save_partner(null,'{"public_name":"Patch QA Z Active","partner_type":"loja","email":"contact@example.invalid","phone":"+550000000000"}');
 draft:=public.admin_save_partner(null,'{"public_name":"Patch QA B Draft","partner_type":"loja"}');
 archived:=public.admin_save_partner(null,'{"public_name":"Patch QA A Archived","partner_type":"loja"}');
 perform public.admin_set_partner_status(archived,'archived','encerramento');
 payload:='{"legal_name":"QA Legal","document":"12345678909","payee_name":"QA Titular","pix_type":"random","pix_key":"20000000-0000-4000-8000-000000000001","commission_percent":"15","reason":"configuracao_inicial"}';
 -- Initial configuration still works with the valid one-hour-old login, without tickets.
 perform set_config('request.jwt.claims',(original||jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now()-interval '1 hour')::bigint),jsonb_build_object('method','totp','timestamp',extract(epoch from now()-interval '1 hour')::bigint))))::text,true);
 perform public.admin_configure_partner(p,payload,null);
 perform public.admin_set_partner_status(p,'active','cadastro_concluido');
 select to_jsonb(v) into before_profile from partner_private_profiles v where partner_id=p;
 patch:='{"commission_percent":"16","reason":"ajuste_contratual"}';
 begin perform public.admin_configure_partner(p,patch,null);raise exception 'ASSERT_ACTIVE_PATCH_AUTH';exception when others then if sqlerrm<>'PARTNER_STEPUP_REQUIRED' then raise;end if;end;
 begin perform public.admin_prepare_partner_stepup(p,patch);raise exception 'ASSERT_STALE_PROOF';exception when others then if sqlerrm<>'PARTNER_RECENT_PASSWORD_TOTP_REQUIRED' then raise;end if;end;
 perform set_config('request.jwt.claims',original::text,true);
 t:=public.admin_prepare_partner_stepup(p,patch);
 begin perform public.admin_configure_partner(p,patch||'{"commission_percent":"17"}',t);raise exception 'ASSERT_PATCH_TAMPERING';exception when others then if sqlerrm<>'PARTNER_STEPUP_INVALID' then raise;end if;end;
 perform public.admin_configure_partner(p,patch,t);
 if (select to_jsonb(v) from partner_private_profiles v where partner_id=p)<>before_profile then raise exception 'ASSERT_PROFILE_NOT_PRESERVED';end if;
 if (select commission_percent from partner_commission_rules where partner_id=p order by version desc limit 1)<>16 then raise exception 'ASSERT_PERCENT';end if;
 if not exists(select 1 from partner_commission_rules where partner_id=p and version=1 and commission_percent=15) then raise exception 'ASSERT_HISTORY';end if;
 begin perform public.admin_configure_partner(p,patch,t);raise exception 'ASSERT_PATCH_REPLAY';exception when others then if sqlerrm<>'PARTNER_STEPUP_INVALID' then raise;end if;end;
 -- Explicit null, blank, masked and malformed replacements must never erase retained data.
 for data in select unnest(array['{"document":null}'::jsonb,'{"document":""}','{"document":"••••8909"}','{"pix_key":""}','{"payee_name":null}','{"commission_percent":null}','{"reason":null}','{"unknown":"value"}']) loop
  begin perform public.admin_configure_partner(p,patch||data,null);raise exception 'ASSERT_INVALID_REPLACEMENT';exception when others then if sqlerrm not in ('PARTNER_INVALID_FINANCIAL_DATA','PARTNER_INVALID_PIX') then raise;end if;end;
 end loop;
 -- Each explicit replacement is independent; other values and rule history stay intact.
 for patch in select unnest(array['{"payee_name":"Novo Titular QA","reason":"correcao_pagamento"}'::jsonb,'{"document":"11222333000181","reason":"correcao_pagamento"}','{"pix_type":"email","pix_key":"payment@example.invalid","reason":"correcao_pagamento"}','{"legal_name":"Nova Razao QA","reason":"ajuste_contratual"}']) loop
  t:=public.admin_prepare_partner_stepup(p,patch);perform public.admin_configure_partner(p,patch,t);
 end loop;
 if (select count(*) from partner_commission_rules where partner_id=p)<>2 then raise exception 'ASSERT_UNCHANGED_COMMISSION_RULE';end if;
 if not exists(select 1 from partner_private_profiles where partner_id=p and document='11222333000181' and payee_name='Novo Titular QA' and pix_key='payment@example.invalid' and legal_name='Nova Razao QA') then raise exception 'ASSERT_PARTIAL_FIELDS';end if;
 data:=public.admin_list_partners('Patch QA');
 if jsonb_array_length(data)<>2 or data->0->>'id'<>p::text then raise exception 'ASSERT_DEFAULT_ORDER_FILTER';end if;
 if data::text like '%11222333000181%' or data::text like '%payment@example.invalid%' or data::text like '%Novo Titular QA%' then raise exception 'ASSERT_LIST_MASKING';end if;
 if data->0->'financial'->>'legal_name'<>'Nova Razao QA' or data->0->'financial'->>'pix_key_masked' not like '••••%' then raise exception 'ASSERT_SAFE_FORM_STATE';end if;
 if jsonb_array_length(public.admin_list_partners('Patch QA',true))<>3 or jsonb_array_length(public.admin_list_partners('Patch QA A Archived'))<>0 or jsonb_array_length(public.admin_list_partners('Patch QA A Archived',true))<>1 then raise exception 'ASSERT_ARCHIVE_SEARCH';end if;
 for role_name in select unnest(array['admin','viewer']) loop
  update admin_memberships set access_level=role_name where user_id=auth.uid();
  data:=public.admin_list_partners('Patch QA',true);
  if data->0->>'financial' is not null then raise exception 'ASSERT_ROLE_FINANCE_PRIVACY';end if;
  if role_name='viewer' and (data->0->>'document_masked' is not null or data->0->>'contact' is not null) then raise exception 'ASSERT_VIEWER_PRIVACY';end if;
  begin perform public.admin_configure_partner(p,'{"commission_percent":"20","reason":"ajuste_contratual"}',null);raise exception 'ASSERT_ROLE_PATCH';exception when others then if sqlerrm='ASSERT_ROLE_PATCH' then raise;end if;end;
 end loop;
 update admin_memberships set access_level='owner' where user_id=auth.uid();
 perform public.admin_set_partner_status(p,'suspended','pausa_comercial');
 begin perform public.admin_configure_partner(p,'{"commission_percent":"20","reason":"ajuste_contratual"}',null);raise exception 'ASSERT_SUSPENDED_PATCH';exception when others then if sqlerrm<>'PARTNER_STEPUP_REQUIRED' then raise;end if;end;
 if not exists(select 1 from partners where id=archived and status='archived') or not exists(select 1 from admin_audit_logs where metadata->>'partner_id'=archived::text) then raise exception 'ASSERT_ARCHIVE_PRESERVATION';end if;
 if exists(select 1 from admin_audit_logs where metadata->>'partner_id'=p::text and (metadata::text like '%11222333000181%' or metadata::text like '%payment@example.invalid%')) then raise exception 'ASSERT_PATCH_AUDIT_PRIVACY';end if;
 if has_function_privilege('anon','public.admin_list_partners(text,boolean)','EXECUTE') or has_table_privilege('authenticated','public.partner_private_profiles','SELECT') then raise exception 'ASSERT_PATCH_GRANTS';end if;
end $$;
rollback;
