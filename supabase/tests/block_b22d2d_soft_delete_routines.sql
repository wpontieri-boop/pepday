-- Executar apos D2-D somente em PostgreSQL descartavel. Fixtures revertidas.
begin;

insert into auth.users(id,email) values
  ('d2d00000-0000-4000-8000-000000000001','d2d-trial@example.invalid'),
  ('d2d00000-0000-4000-8000-000000000002','d2d-free@example.invalid'),
  ('d2d00000-0000-4000-8000-000000000003','d2d-other@example.invalid');
update public.trials set trial_used=true,started_at=now()-interval '1 day',ends_at=now()+interval '6 days'
  where user_id in ('d2d00000-0000-4000-8000-000000000001','d2d00000-0000-4000-8000-000000000003');
update public.subscriptions set status='trial'
  where user_id in ('d2d00000-0000-4000-8000-000000000001','d2d00000-0000-4000-8000-000000000003');

insert into public.vials(id,user_id,name,initial_mg,remaining_mg,water_ml,prepared_on,active,deleted_at)
values
 ('d2d10000-0000-4000-8000-000000000001','d2d00000-0000-4000-8000-000000000001','Historico',10,8,2,date '2026-09-25',true,null),
 ('d2d10000-0000-4000-8000-000000000002','d2d00000-0000-4000-8000-000000000001','Indisponivel',10,7,2,date '2026-09-25',false,now()),
 ('d2d10000-0000-4000-8000-000000000003','d2d00000-0000-4000-8000-000000000003','Outra conta',10,9,2,date '2026-09-25',true,null);

insert into public.routines(id,user_id,vial_id,name,dose_value,dose_unit,syringe_capacity,
 frequency,weekdays,start_date,time_of_day,refill_at,status,version,deleted_at)
values
 ('d2d20000-0000-4000-8000-000000000001','d2d00000-0000-4000-8000-000000000001',
  'd2d10000-0000-4000-8000-000000000001','Normal',1,'mg',100,'daily','{}',date '2026-09-25',time '08:30',3,'active',1,null),
 ('d2d20000-0000-4000-8000-000000000002','d2d00000-0000-4000-8000-000000000001',
  'd2d10000-0000-4000-8000-000000000002','Inativa',1,'mg',100,'daily','{}',date '2026-09-25',null,3,'inactive',1,null),
 ('d2d20000-0000-4000-8000-000000000003','d2d00000-0000-4000-8000-000000000001',
  'd2d10000-0000-4000-8000-000000000001','Ja excluida',1,'mg',100,'daily','{}',date '2026-09-25',null,3,'inactive',1,now()),
 ('d2d20000-0000-4000-8000-000000000004','d2d00000-0000-4000-8000-000000000001',
  'd2d10000-0000-4000-8000-000000000001','Rollback',1,'mg',100,'weekdays',array[1,3,5],date '2026-09-25',null,3,'active',1,null),
 ('d2d20000-0000-4000-8000-000000000099','d2d00000-0000-4000-8000-000000000003',
  'd2d10000-0000-4000-8000-000000000003','Outra conta',1,'mg',100,'daily','{}',date '2026-09-25',null,3,'active',1,null);

insert into public.routine_versions(id,user_id,routine_id,version,snapshot)
select case
  when r.user_id='d2d00000-0000-4000-8000-000000000003' then 'd2d30000-0000-4000-8000-000000000099'::uuid
  when r.id='d2d20000-0000-4000-8000-000000000001' then 'd2d30000-0000-4000-8000-000000000001'::uuid
  when r.id='d2d20000-0000-4000-8000-000000000002' then 'd2d30000-0000-4000-8000-000000000002'::uuid
  when r.id='d2d20000-0000-4000-8000-000000000003' then 'd2d30000-0000-4000-8000-000000000003'::uuid
  else 'd2d30000-0000-4000-8000-000000000004'::uuid end,
 r.user_id,r.id,r.version,public.pepday_routine_snapshot(r)
from public.routines r where r.id in
 ('d2d20000-0000-4000-8000-000000000001','d2d20000-0000-4000-8000-000000000002',
  'd2d20000-0000-4000-8000-000000000003','d2d20000-0000-4000-8000-000000000004',
  'd2d20000-0000-4000-8000-000000000099');

update public.routines set updated_at='2020-01-01 00:00:00+00'
where user_id='d2d00000-0000-4000-8000-000000000001';

insert into public.applications(id,user_id,operation_id,routine_id,routine_version_id,vial_id,
 scheduled_date,applied_at,dose_value,dose_unit,dose_mg,volume_ml,ui,concentration,
 balance_before,balance_after)
values('d2d50000-0000-4000-8000-000000000001','d2d00000-0000-4000-8000-000000000001',
 'd2d50000-0000-4000-8000-000000000002','d2d20000-0000-4000-8000-000000000001',
 'd2d30000-0000-4000-8000-000000000001','d2d10000-0000-4000-8000-000000000001',
 date '2026-09-24',now(),1,'mg',1,0.2,20,5,9,8);
insert into public.vial_movements(id,user_id,operation_id,vial_id,application_id,kind,
 delta_mg,balance_before,balance_after)
values('d2d60000-0000-4000-8000-000000000001','d2d00000-0000-4000-8000-000000000001',
 'd2d60000-0000-4000-8000-000000000002','d2d10000-0000-4000-8000-000000000001',
 'd2d50000-0000-4000-8000-000000000001','application',-1,9,8);

set constraints routines_current_version_guard immediate;
set constraints routines_current_version_guard deferred;
set local role authenticated;
select set_config('request.jwt.claim.sub','d2d00000-0000-4000-8000-000000000001',true);

-- A/C/K/L: delete normal, versao canonica, replay e historico inteiro imutavel.
do $$
declare result jsonb; replay_result jsonb; base jsonb; old_version_text text;
 app_text text; movement_text text; vial_text text; deleted_stamp timestamptz;
 updated_stamp timestamptz; versions bigint;
begin
 select snapshot,snapshot::text into base,old_version_text from public.routine_versions
  where id='d2d30000-0000-4000-8000-000000000001';
 select to_jsonb(a)::text into app_text from public.applications a
  where id='d2d50000-0000-4000-8000-000000000001';
 select to_jsonb(m)::text into movement_text from public.vial_movements m
  where id='d2d60000-0000-4000-8000-000000000001';
 select to_jsonb(v)::text into vial_text from public.vials v
  where id='d2d10000-0000-4000-8000-000000000001';

 result:=public.soft_delete_routine_versioned(
  'd2d40000-0000-4000-8000-000000000001',auth.uid(),
  'd2d20000-0000-4000-8000-000000000001','d2d30000-0000-4000-8000-000000000010',1,base);
 select deleted_at,updated_at into deleted_stamp,updated_stamp from public.routines
  where id='d2d20000-0000-4000-8000-000000000001';
 select count(*) into versions from public.routine_versions
  where routine_id='d2d20000-0000-4000-8000-000000000001';

 if result->>'outcome'<>'success' or (result->>'replay')::boolean
  or (result->>'version')::bigint<>2
  or result->>'routine_version_id'<>'d2d30000-0000-4000-8000-000000000010'
  or (select status from public.routines where id='d2d20000-0000-4000-8000-000000000001')<>'inactive'
  or deleted_stamp is null or updated_stamp='2020-01-01 00:00:00+00'
  or deleted_stamp is distinct from updated_stamp
  or versions<>2
  or result->'snapshot' is distinct from
     (select snapshot from public.routine_versions where id='d2d30000-0000-4000-8000-000000000010')
  or (select snapshot::text from public.routine_versions where id='d2d30000-0000-4000-8000-000000000001')<>old_version_text
  or (select routine_version_id from public.applications where id='d2d50000-0000-4000-8000-000000000001')
     <>'d2d30000-0000-4000-8000-000000000001'
  or (select to_jsonb(a)::text from public.applications a where id='d2d50000-0000-4000-8000-000000000001')<>app_text
  or (select to_jsonb(m)::text from public.vial_movements m where id='d2d60000-0000-4000-8000-000000000001')<>movement_text
  or (select to_jsonb(v)::text from public.vials v where id='d2d10000-0000-4000-8000-000000000001')<>vial_text then
  raise exception 'FAIL delete normal/historico: %',result;
 end if;

 replay_result:=public.soft_delete_routine_versioned(
  'd2d40000-0000-4000-8000-000000000001',auth.uid(),
  'd2d20000-0000-4000-8000-000000000001','d2d30000-0000-4000-8000-000000000010',1,base);
 if not (replay_result->>'replay')::boolean
  or replay_result-'replay' is distinct from result-'replay'
  or (select deleted_at from public.routines where id='d2d20000-0000-4000-8000-000000000001')<>deleted_stamp
  or (select updated_at from public.routines where id='d2d20000-0000-4000-8000-000000000001')<>updated_stamp
  or (select count(*) from public.routine_versions where routine_id='d2d20000-0000-4000-8000-000000000001')<>versions then
  raise exception 'FAIL replay exato: %',replay_result;
 end if;
end $$;

-- D: operation_id reutilizada com intencao diferente nao produz novo efeito.
do $$ declare blocked boolean:=false; versions bigint; begin
 select count(*) into versions from public.routine_versions;
 begin perform public.soft_delete_routine_versioned(
  'd2d40000-0000-4000-8000-000000000001',auth.uid(),
  'd2d20000-0000-4000-8000-000000000002','d2d30000-0000-4000-8000-000000000011',1,'{}');
 exception when others then blocked:=sqlerrm like 'UUID de operacao reutilizado%'; end;
 if not blocked or (select count(*) from public.routine_versions)<>versions
  or (select deleted_at from public.routines where id='d2d20000-0000-4000-8000-000000000002') is not null then
  raise exception 'FAIL operation_id divergente';
 end if;
end $$;
reset role;
do $$ begin
 if (select count(*) from public.domain_mutation_operations
      where user_id='d2d00000-0000-4000-8000-000000000001'
        and operation_id='d2d40000-0000-4000-8000-000000000001')<>1 then
  raise exception 'FAIL replay/reuso duplicou ledger';
 end if;
 if (select snapshot from public.routine_versions
      where id='d2d30000-0000-4000-8000-000000000010')
    is distinct from
    (select public.pepday_routine_snapshot(r) from public.routines r
      where id='d2d20000-0000-4000-8000-000000000001') then
  raise exception 'FAIL snapshot novo nao canonico';
 end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d2d00000-0000-4000-8000-000000000001',true);

-- B: rotina inactive, com Frasco ja excluido, ainda recebe soft-delete versionado.
do $$ declare result jsonb; base jsonb; begin
 select snapshot into base from public.routine_versions
  where id='d2d30000-0000-4000-8000-000000000002';
 result:=public.soft_delete_routine_versioned(
  'd2d40000-0000-4000-8000-000000000002',auth.uid(),
  'd2d20000-0000-4000-8000-000000000002','d2d30000-0000-4000-8000-000000000020',1,base);
 if result->>'outcome'<>'success' or (result->>'version')::bigint<>2
  or (select status from public.routines where id='d2d20000-0000-4000-8000-000000000002')<>'inactive'
  or (select deleted_at from public.routines where id='d2d20000-0000-4000-8000-000000000002') is null
  or not exists(select 1 from public.routine_versions
       where id='d2d30000-0000-4000-8000-000000000020' and version=2)
  or (select deleted_at from public.vials where id='d2d10000-0000-4000-8000-000000000002') is null then
  raise exception 'FAIL inactive/Frasco indisponivel: %',result;
 end if;
end $$;

-- E/F/G/H: conflitos estaveis, isolamento e zero update/versao parcial.
do $$
declare result jsonb; before_row text; versions bigint;
begin
 select to_jsonb(r)::text into before_row from public.routines r
  where id='d2d20000-0000-4000-8000-000000000004';
 select count(*) into versions from public.routine_versions;
 result:=public.soft_delete_routine_versioned(
  'd2d40000-0000-4000-8000-000000000030',auth.uid(),
  'd2d20000-0000-4000-8000-000000000004','d2d30000-0000-4000-8000-000000000030',2,'{}');
 if result->>'code'<>'STALE_VERSION' or (result->>'remote_version')::bigint<>1
  or result#>>'{local,status}'<>'inactive' or result#>>'{local,deleted_at,$intent}'<>'server_statement_timestamp'
  or (select to_jsonb(r)::text from public.routines r where id='d2d20000-0000-4000-8000-000000000004')<>before_row then
  raise exception 'FAIL stale: %',result;
 end if;

 result:=public.soft_delete_routine_versioned(
  'd2d40000-0000-4000-8000-000000000031',auth.uid(),
  'd2d20000-0000-4000-8000-000000000003','d2d30000-0000-4000-8000-000000000031',1,'{}');
 if result->>'code'<>'ENTITY_DELETED' then raise exception 'FAIL ja deletada: %',result; end if;

 result:=public.soft_delete_routine_versioned(
  'd2d40000-0000-4000-8000-000000000032',auth.uid(),
  'd2d20000-0000-4000-8000-000000000099','d2d30000-0000-4000-8000-000000000032',1,'{}');
 if result->>'code'<>'ROUTINE_NOT_AVAILABLE' or result->'remote'<>'null'::jsonb
  or result->'remote_version'<>'null'::jsonb then raise exception 'FAIL ausente: %',result; end if;

 result:=public.soft_delete_routine_versioned(
  'd2d40000-0000-4000-8000-000000000033',auth.uid(),
  'd2d20000-0000-4000-8000-000000000099','d2d30000-0000-4000-8000-000000000033',1,'{}');
 if result->>'code'<>'ROUTINE_NOT_AVAILABLE' or result->'remote'<>'null'::jsonb
  then raise exception 'FAIL isolamento cross-user: %',result; end if;

 result:=public.soft_delete_routine_versioned(
  'd2d40000-0000-4000-8000-000000000034',auth.uid(),
  'd2d20000-0000-4000-8000-000000000004','d2d30000-0000-4000-8000-000000000001',1,'{}');
 if result->>'code'<>'ROUTINE_VERSION_ID_UNAVAILABLE'
  or (select to_jsonb(r)::text from public.routines r where id='d2d20000-0000-4000-8000-000000000004')<>before_row
  or (select count(*) from public.routine_versions)<>versions then
  raise exception 'FAIL version id/rollback: %',result;
 end if;
end $$;

-- I/J: auth/expected_user e entitlement; replay de sucesso antecede entitlement.
do $$ declare blocked boolean:=false; replay_result jsonb; base jsonb; begin
 select snapshot into base from public.routine_versions
  where id='d2d30000-0000-4000-8000-000000000001';
 begin perform public.soft_delete_routine_versioned(
  'd2d40000-0000-4000-8000-000000000040','d2d00000-0000-4000-8000-000000000003',
  'd2d20000-0000-4000-8000-000000000004','d2d30000-0000-4000-8000-000000000040',1,'{}');
 exception when others then blocked:=sqlerrm like 'Conta alterada%'; end;
 if not blocked then raise exception 'FAIL expected_user'; end if;

 blocked:=false; perform set_config('request.jwt.claim.sub','',true);
 begin perform public.soft_delete_routine_versioned(
  'd2d40000-0000-4000-8000-000000000041','d2d00000-0000-4000-8000-000000000001',
  'd2d20000-0000-4000-8000-000000000004','d2d30000-0000-4000-8000-000000000041',1,'{}');
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL auth nulo'; end if;

 perform set_config('request.jwt.claim.sub','d2d00000-0000-4000-8000-000000000002',true);
 blocked:=false;
 begin perform public.soft_delete_routine_versioned(
  'd2d40000-0000-4000-8000-000000000042',auth.uid(),
  'd2d20000-0000-4000-8000-000000000099','d2d30000-0000-4000-8000-000000000042',1,'{}');
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL entitlement'; end if;

 perform set_config('request.jwt.claim.sub','d2d00000-0000-4000-8000-000000000001',true);
 reset role;
 update public.trials set started_at=now()-interval '8 days',ends_at=now()-interval '1 day'
  where user_id='d2d00000-0000-4000-8000-000000000001';
 set local role authenticated;
 replay_result:=public.soft_delete_routine_versioned(
  'd2d40000-0000-4000-8000-000000000001',auth.uid(),
  'd2d20000-0000-4000-8000-000000000001','d2d30000-0000-4000-8000-000000000010',1,base);
 if not (replay_result->>'replay')::boolean or replay_result->>'outcome'<>'success' then
  raise exception 'FAIL replay sem entitlement: %',replay_result;
 end if;
 reset role;
 update public.trials set started_at=now()-interval '1 day',ends_at=now()+interval '6 days'
  where user_id='d2d00000-0000-4000-8000-000000000001';
 set local role authenticated;
 perform set_config('request.jwt.claim.sub','d2d00000-0000-4000-8000-000000000001',true);
end $$;

-- M: falha entre UPDATE e INSERT da versao reverte Rotina, timestamps e ledger.
reset role;
create function pg_temp.fail_d2d_version() returns trigger language plpgsql as $$
begin if new.id='d2d30000-0000-4000-8000-000000000080' then raise exception 'falha injetada D2-D'; end if; return new; end $$;
create trigger fail_d2d_version before insert on public.routine_versions
for each row execute function pg_temp.fail_d2d_version();
set local role authenticated;
select set_config('request.jwt.claim.sub','d2d00000-0000-4000-8000-000000000001',true);
do $$ declare blocked boolean:=false; before_row text; versions bigint; begin
 select to_jsonb(r)::text into before_row from public.routines r
  where id='d2d20000-0000-4000-8000-000000000004';
 select count(*) into versions from public.routine_versions;
 begin perform public.soft_delete_routine_versioned(
  'd2d40000-0000-4000-8000-000000000080',auth.uid(),
  'd2d20000-0000-4000-8000-000000000004','d2d30000-0000-4000-8000-000000000080',1,'{}');
 exception when others then blocked:=sqlerrm='falha injetada D2-D'; end;
 if not blocked
  or (select to_jsonb(r)::text from public.routines r where id='d2d20000-0000-4000-8000-000000000004')<>before_row
  or (select count(*) from public.routine_versions)<>versions then
  raise exception 'FAIL rollback atomico';
 end if;
end $$;
reset role;
do $$ begin
 if exists(select 1 from public.domain_mutation_operations
   where operation_id='d2d40000-0000-4000-8000-000000000080') then
  raise exception 'FAIL rollback do ledger';
 end if;
end $$;
drop trigger fail_d2d_version on public.routine_versions;

-- N: grants minimos e nenhum CRUD direto.
do $$ begin
 if not has_function_privilege('authenticated',
  'public.soft_delete_routine_versioned(uuid,uuid,uuid,uuid,bigint,jsonb)','EXECUTE')
  or has_function_privilege('anon',
  'public.soft_delete_routine_versioned(uuid,uuid,uuid,uuid,bigint,jsonb)','EXECUTE')
  or has_function_privilege('public',
  'public.soft_delete_routine_versioned(uuid,uuid,uuid,uuid,bigint,jsonb)','EXECUTE') then
  raise exception 'FAIL grants D2-D';
 end if;
 if has_table_privilege('authenticated','public.routines','INSERT,UPDATE,DELETE')
  or has_table_privilege('authenticated','public.routine_versions','INSERT,UPDATE,DELETE')
  or has_table_privilege('authenticated','public.domain_mutation_operations','INSERT,UPDATE,DELETE') then
  raise exception 'FAIL CRUD direto D2-D';
 end if;
end $$;

rollback;
