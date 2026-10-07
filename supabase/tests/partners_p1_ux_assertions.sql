-- Synthetic fixture only; always append to local or real TEST bootstrap and roll back.
do $$declare p uuid; payload jsonb; original jsonb:=auth.jwt(); t uuid; data jsonb; err text;begin
 p:=public.admin_save_partner(null,'{"public_name":"UX QA","partner_type":"loja","email":"qa@example.invalid","phone":"+550000000000","contact_name":"Contato QA"}');
 payload:='{"legal_name":"QA Sintetico","document":"12345678909","payee_name":"Outro Titular QA","pix_type":"email","pix_key":"qa@example.invalid","commission_percent":"0","reason":"configuracao_inicial"}';
 -- Missing/invalid mandatory data are rejected by the server as well as the UI.
 for err in select unnest(array['legal_name','document','payee_name','pix_type','pix_key','commission_percent','reason']) loop
  begin perform public.admin_configure_partner(p,payload-err,null);raise exception 'ASSERT_REQUIRED_FIELD';exception when others then if sqlerrm='ASSERT_REQUIRED_FIELD' then raise;end if;end;
 end loop;
 begin perform public.admin_configure_partner(p,payload||'{"document":"12345678900"}',null);raise exception 'ASSERT_CHECKSUM';exception when others then if sqlerrm<>'PARTNER_INVALID_FINANCIAL_DATA' then raise;end if;end;
 begin perform public.admin_configure_partner(p,payload||'{"pix_key":"bad-email"}',null);raise exception 'ASSERT_PIX';exception when others then if sqlerrm<>'PARTNER_INVALID_PIX' then raise;end if;end;
 -- Existing valid login older than five minutes still permits initial finance and activation.
 perform set_config('request.jwt.claims',(original||jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now()-interval '1 hour')::bigint),jsonb_build_object('method','totp','timestamp',extract(epoch from now()-interval '1 hour')::bigint))))::text,true);
 perform public.admin_configure_partner(p,payload,null);
 perform public.admin_configure_partner(p,payload||'{"commission_percent":"10"}',null);
 if (select count(*) from partner_stepup_tickets where partner_id=p)<>0 then raise exception 'ASSERT_INITIAL_NO_CHALLENGE';end if;
 perform public.admin_set_partner_status(p,'active','cadastro_concluido');
 begin perform public.admin_configure_partner(p,payload,null);raise exception 'ASSERT_ACTIVE_STEPUP';exception when others then if sqlerrm<>'PARTNER_STEPUP_REQUIRED' then raise;end if;end;
 perform public.admin_set_partner_status(p,'suspended','pausa_comercial');
 begin perform public.admin_configure_partner(p,payload,null);raise exception 'ASSERT_SUSPENDED_STEPUP';exception when others then if sqlerrm<>'PARTNER_STEPUP_REQUIRED' then raise;end if;end;
 perform set_config('request.jwt.claims',original::text,true);
 t:=public.admin_prepare_partner_stepup(p,payload);perform public.admin_configure_partner(p,payload,t);
 begin perform public.admin_configure_partner(p,payload,t);raise exception 'ASSERT_REPLAY';exception when others then if sqlerrm<>'PARTNER_STEPUP_INVALID' then raise;end if;end;
 update admin_memberships set access_level='admin' where user_id=auth.uid();
 begin perform public.admin_configure_partner(p,payload,null);raise exception 'ASSERT_ADMIN_DIRECT';exception when others then if sqlerrm='ASSERT_ADMIN_DIRECT' then raise;end if;end;
 data:=public.admin_list_partners('UX QA');if data->0->'contact'->>'name'<>'Contato QA' then raise exception 'ASSERT_CONTACT';end if;
 update admin_memberships set access_level='viewer' where user_id=auth.uid();
 data:=public.admin_list_partners('UX QA');if data->0->>'contact' is not null then raise exception 'ASSERT_VIEWER_CONTACT';end if;
 begin perform public.admin_configure_partner(p,payload,null);raise exception 'ASSERT_VIEWER_DIRECT';exception when others then if sqlerrm='ASSERT_VIEWER_DIRECT' then raise;end if;end;
 update admin_memberships set access_level='owner' where user_id=auth.uid();
 -- Fresh AMR must not extend old session; revoked/expired sessions deny all P1 access.
 update auth.sessions set created_at=now()-interval '8 hours' where id=(original->>'session_id')::uuid;
 begin perform public.admin_list_partners();raise exception 'ASSERT_SESSION_BOUND';exception when others then if sqlerrm<>'PARTNER_LOGIN_EXPIRED' then raise;end if;end;
 update auth.sessions set created_at=now(),not_after=now()-interval '1 second' where id=(original->>'session_id')::uuid;
 begin perform public.admin_list_partners();raise exception 'ASSERT_NOT_AFTER';exception when others then if sqlerrm<>'PARTNER_LOGIN_EXPIRED' then raise;end if;end;
 update auth.sessions set not_after=null where id=(original->>'session_id')::uuid;
 perform set_config('request.jwt.claims',(original||'{"amr":[],"user_metadata":{"role":"owner","aal":"aal2","password":true,"totp":true}}')::text,true);
 begin perform public.admin_list_partners();raise exception 'ASSERT_METADATA_BYPASS';exception when others then if sqlerrm<>'PARTNER_LOGIN_EXPIRED' then raise;end if;end;
 if has_function_privilege('authenticated','public.partner_assert_operational_login()','EXECUTE') then raise exception 'ASSERT_HELPER_GRANTS';end if;
end $$;
rollback;
