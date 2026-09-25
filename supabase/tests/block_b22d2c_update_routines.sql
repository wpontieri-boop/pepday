-- Executar apos D2-C somente em PostgreSQL descartavel. Fixtures revertidas.
begin;

insert into auth.users(id,email) values
  ('d2c00000-0000-4000-8000-000000000001','d2c-trial@example.invalid'),
  ('d2c00000-0000-4000-8000-000000000002','d2c-free@example.invalid'),
  ('d2c00000-0000-4000-8000-000000000003','d2c-other@example.invalid');
update public.trials set trial_used=true,started_at=now()-interval '1 day',ends_at=now()+interval '6 days'
  where user_id in ('d2c00000-0000-4000-8000-000000000001','d2c00000-0000-4000-8000-000000000003');
update public.subscriptions set status='trial'
  where user_id in ('d2c00000-0000-4000-8000-000000000001','d2c00000-0000-4000-8000-000000000003');

insert into public.vials(id,user_id,name,initial_mg,remaining_mg,water_ml,prepared_on,active,deleted_at)
values
 ('d2c10000-0000-4000-8000-000000000001','d2c00000-0000-4000-8000-000000000001','Antigo',10,9,2,date '2026-09-25',true,null),
 ('d2c10000-0000-4000-8000-000000000002','d2c00000-0000-4000-8000-000000000001','Novo',20,17,4,date '2026-09-25',true,null),
 ('d2c10000-0000-4000-8000-000000000003','d2c00000-0000-4000-8000-000000000001','Inativo',10,8,2,date '2026-09-25',false,null),
 ('d2c10000-0000-4000-8000-000000000004','d2c00000-0000-4000-8000-000000000001','Excluido',10,7,2,date '2026-09-25',false,now()),
 ('d2c10000-0000-4000-8000-000000000005','d2c00000-0000-4000-8000-000000000003','Outra conta',10,6,2,date '2026-09-25',true,null);

insert into public.routines(id,user_id,vial_id,name,dose_value,dose_unit,syringe_capacity,
 frequency,weekdays,start_date,time_of_day,refill_at,status,version,deleted_at)
values
 ('d2c20000-0000-4000-8000-000000000001','d2c00000-0000-4000-8000-000000000001',
  'd2c10000-0000-4000-8000-000000000001','Original',1,'mg',100,'daily','{}',date '2026-09-25',time '08:30',3,'active',1,null),
 ('d2c20000-0000-4000-8000-000000000002','d2c00000-0000-4000-8000-000000000001',
  'd2c10000-0000-4000-8000-000000000001','Excluida',1,'mg',100,'daily','{}',date '2026-09-25',null,3,'inactive',1,now()),
 ('d2c20000-0000-4000-8000-000000000003','d2c00000-0000-4000-8000-000000000001',
  'd2c10000-0000-4000-8000-000000000001','Rollback',1,'mg',100,'weekdays',array[5,1,5,3],date '2026-09-25',null,3,'active',1,null);
insert into public.routine_versions(id,user_id,routine_id,version,snapshot)
select case r.id
  when 'd2c20000-0000-4000-8000-000000000001' then 'd2c30000-0000-4000-8000-000000000001'::uuid
  when 'd2c20000-0000-4000-8000-000000000002' then 'd2c30000-0000-4000-8000-000000000002'::uuid
  else 'd2c30000-0000-4000-8000-000000000003'::uuid end,
  r.user_id,r.id,r.version,public.pepday_routine_snapshot(r)
from public.routines r where r.id in
 ('d2c20000-0000-4000-8000-000000000001','d2c20000-0000-4000-8000-000000000002',
  'd2c20000-0000-4000-8000-000000000003');
update public.routines set updated_at='2020-01-01 00:00:00+00'
where id in ('d2c20000-0000-4000-8000-000000000001',
  'd2c20000-0000-4000-8000-000000000002','d2c20000-0000-4000-8000-000000000003');

-- Application historica permanece presa a versao/snapshot 1.
insert into public.applications(id,user_id,operation_id,routine_id,routine_version_id,vial_id,
 scheduled_date,applied_at,dose_value,dose_unit,dose_mg,volume_ml,ui,concentration,
 balance_before,balance_after)
values('d2c50000-0000-4000-8000-000000000001','d2c00000-0000-4000-8000-000000000001',
 'd2c50000-0000-4000-8000-000000000002','d2c20000-0000-4000-8000-000000000001',
 'd2c30000-0000-4000-8000-000000000001','d2c10000-0000-4000-8000-000000000001',
 date '2026-09-24',now(),1,'mg',1,0.2,20,5,9,8);

set constraints routines_current_version_guard immediate;
set constraints routines_current_version_guard deferred;
set local role authenticated;
select set_config('request.jwt.claim.sub','d2c00000-0000-4000-8000-000000000001',true);

-- A: update simples N -> N+1, uma versao nova e versao antiga byte-identical.
do $$
declare result jsonb; old_snapshot jsonb; old_bytes text; stamp timestamptz;
begin
 select snapshot,snapshot::text into old_snapshot,old_bytes from public.routine_versions
  where id='d2c30000-0000-4000-8000-000000000001';
 select updated_at into stamp from public.routines where id='d2c20000-0000-4000-8000-000000000001';
 result:=public.update_routine_versioned(
  'd2c40000-0000-4000-8000-000000000001',auth.uid(),
  'd2c20000-0000-4000-8000-000000000001','d2c30000-0000-4000-8000-000000000010',1,
  old_snapshot,'{"name":"  Editada  "}'::jsonb);
 if result->>'outcome'<>'success' or (result->>'replay')::boolean
  or (result->>'no_op')::boolean or (result->>'version')::bigint<>2
  or result->>'routine_version_id'<>'d2c30000-0000-4000-8000-000000000010'
  or result#>>'{snapshot,name}'<>'Editada'
  or (select count(*) from public.routine_versions where routine_id='d2c20000-0000-4000-8000-000000000001')<>2
  or (select snapshot::text from public.routine_versions where id='d2c30000-0000-4000-8000-000000000001')<>old_bytes
  or (select updated_at from public.routines where id='d2c20000-0000-4000-8000-000000000001')=stamp then
  raise exception 'FAIL update simples: %',result;
 end if;
end $$;

-- B/C/M: troca de Frasco, patch multiplo, weekdays canonicos e historico intacto.
do $$
declare result jsonb; base jsonb; b1 numeric; b2 numeric; moves bigint; apps bigint;
begin
 select rv.snapshot into base from public.routines r join public.routine_versions rv
  on rv.user_id=r.user_id and rv.routine_id=r.id and rv.version=r.version
  where r.id='d2c20000-0000-4000-8000-000000000001';
 select remaining_mg into b1 from public.vials where id='d2c10000-0000-4000-8000-000000000001';
 select remaining_mg into b2 from public.vials where id='d2c10000-0000-4000-8000-000000000002';
 select count(*) into moves from public.vial_movements;
 select count(*) into apps from public.applications;
 result:=public.update_routine_versioned(
  'd2c40000-0000-4000-8000-000000000002',auth.uid(),
  'd2c20000-0000-4000-8000-000000000001','d2c30000-0000-4000-8000-000000000011',2,base,
  '{"vial_id":"d2c10000-0000-4000-8000-000000000002","dose_value":2.5,
    "dose_unit":"mg","syringe_capacity":50,"frequency":"weekdays",
    "weekdays":[5,1,5,3],"start_date":"2026-09-26","time_of_day":"09:45","refill_at":4}'::jsonb);
 if result->>'outcome'<>'success' or (result->>'no_op')::boolean
  or (result->>'version')::bigint<>3 or result#>>'{snapshot,vial_id}'<>'d2c10000-0000-4000-8000-000000000002'
  or result#>'{snapshot,weekdays}'<>'[1,3,5]'::jsonb
  or (select remaining_mg from public.vials where id='d2c10000-0000-4000-8000-000000000001')<>b1
  or (select remaining_mg from public.vials where id='d2c10000-0000-4000-8000-000000000002')<>b2
  or (select count(*) from public.vial_movements)<>moves or (select count(*) from public.applications)<>apps
  or (select routine_version_id from public.applications where id='d2c50000-0000-4000-8000-000000000001')
    <>'d2c30000-0000-4000-8000-000000000001'
  or (select snapshot->>'name' from public.routine_versions where id='d2c30000-0000-4000-8000-000000000001')<>'Original' then
  raise exception 'FAIL troca/multicampos/historico: %',result;
 end if;
end $$;

-- D/L: 5x2, campo proibido, tipo invalido e payload excessivo sao rejeitados.
do $$
declare blocked boolean; payload jsonb; n integer:=0;
begin
 foreach payload in array array[
  '{"frequency":"5x2"}'::jsonb,
  '{"status":"inactive"}'::jsonb,
  '{"dose_value":"2"}'::jsonb,
  jsonb_build_object('name',repeat('x',17000))
 ] loop
  n:=n+1; blocked:=false;
  begin perform public.update_routine_versioned(
   ('d2c40000-0000-4000-8000-'||lpad((20+n)::text,12,'0'))::uuid,auth.uid(),
   'd2c20000-0000-4000-8000-000000000001',
   ('d2c30000-0000-4000-8000-'||lpad((20+n)::text,12,'0'))::uuid,3,'{}',payload);
  exception when others then blocked:=true; end;
  if not blocked then raise exception 'FAIL payload invalido aceito: %',payload; end if;
 end loop;
end $$;

-- E/J: no-op vazio/semantico nao toca Rotina nem cria versao e possui replay exato.
do $$
declare first_result jsonb; replay_result jsonb; base jsonb; stamp timestamptz; versions bigint;
  blocked boolean;
begin
 select rv.snapshot,r.updated_at into base,stamp from public.routines r
  join public.routine_versions rv on rv.user_id=r.user_id and rv.routine_id=r.id
    and rv.version=r.version
  where r.id='d2c20000-0000-4000-8000-000000000001';
 select count(*) into versions from public.routine_versions where routine_id='d2c20000-0000-4000-8000-000000000001';
 first_result:=public.update_routine_versioned(
  'd2c40000-0000-4000-8000-000000000030',auth.uid(),
  'd2c20000-0000-4000-8000-000000000001','d2c30000-0000-4000-8000-000000000030',3,base,'{}');
 replay_result:=public.update_routine_versioned(
  'd2c40000-0000-4000-8000-000000000030',auth.uid(),
  'd2c20000-0000-4000-8000-000000000001','d2c30000-0000-4000-8000-000000000030',3,base,'{}');
 if first_result->>'outcome'<>'success' or not (first_result->>'no_op')::boolean
  or (first_result->>'replay')::boolean or not (replay_result->>'replay')::boolean
  or replay_result-'replay' is distinct from first_result-'replay'
  or (select version from public.routines where id='d2c20000-0000-4000-8000-000000000001')<>3
  or (select updated_at from public.routines where id='d2c20000-0000-4000-8000-000000000001')<>stamp
  or (select count(*) from public.routine_versions where routine_id='d2c20000-0000-4000-8000-000000000001')<>versions
  or exists(select 1 from public.routine_versions where id='d2c30000-0000-4000-8000-000000000030') then
  raise exception 'FAIL no-op vazio/replay: %, %',first_result,replay_result;
 end if;

 first_result:=public.update_routine_versioned(
  'd2c40000-0000-4000-8000-000000000031',auth.uid(),
  'd2c20000-0000-4000-8000-000000000001','d2c30000-0000-4000-8000-000000000031',3,base,
  '{"name":"Editada","dose_value":2.50,"weekdays":[5,3,1,5],"time_of_day":"09:45:00"}');
 if not (first_result->>'no_op')::boolean
  or (select updated_at from public.routines where id='d2c20000-0000-4000-8000-000000000001')<>stamp
  or (select count(*) from public.routine_versions where routine_id='d2c20000-0000-4000-8000-000000000001')<>versions then
  raise exception 'FAIL no-op semantico: %',first_result;
 end if;

 blocked:=false;
 begin perform public.update_routine_versioned(
  'd2c40000-0000-4000-8000-000000000031',auth.uid(),
  'd2c20000-0000-4000-8000-000000000001','d2c30000-0000-4000-8000-000000000031',3,base,
  '{"name":"Outra intencao"}');
 exception when others then blocked:=sqlerrm like 'UUID de operacao reutilizado%'; end;
 if not blocked then raise exception 'FAIL operation_id divergente'; end if;

 -- Snapshot legado ja e canonico; patch canonico equivalente continua no-op e nao regrava a row.
 first_result:=public.update_routine_versioned(
  'd2c40000-0000-4000-8000-000000000032',auth.uid(),
  'd2c20000-0000-4000-8000-000000000003','d2c30000-0000-4000-8000-000000000032',1,
  (select snapshot from public.routine_versions where id='d2c30000-0000-4000-8000-000000000003'),
  '{"weekdays":[1,3,5]}'::jsonb);
 if not (first_result->>'no_op')::boolean
  or (select version from public.routines where id='d2c20000-0000-4000-8000-000000000003')<>1
  or (select weekdays from public.routines where id='d2c20000-0000-4000-8000-000000000003')<>array[5,1,5,3]
  or exists(select 1 from public.routine_versions where id='d2c30000-0000-4000-8000-000000000032') then
  raise exception 'FAIL no-op canonico sobre legado: %',first_result;
 end if;
end $$;

-- F/G/H/I: conflitos estaveis, isolamento e zero mutacao adicional.
do $$
declare result jsonb; replay_result jsonb; vial uuid; n integer:=0; versions bigint;
begin
 select count(*) into versions from public.routine_versions;
 result:=public.update_routine_versioned('d2c40000-0000-4000-8000-000000000040',auth.uid(),
  'd2c20000-0000-4000-8000-000000000001','d2c30000-0000-4000-8000-000000000040',2,'{}','{"name":"stale"}');
 if result->>'code'<>'STALE_VERSION' or (result->>'remote_version')::bigint<>3 then raise exception 'FAIL stale: %',result; end if;
 replay_result:=public.update_routine_versioned('d2c40000-0000-4000-8000-000000000040',auth.uid(),
  'd2c20000-0000-4000-8000-000000000001','d2c30000-0000-4000-8000-000000000040',2,'{}','{"name":"stale"}');
 if not (replay_result->>'replay')::boolean
  or replay_result-'replay' is distinct from result-'replay' then
  raise exception 'FAIL replay de conflito: %',replay_result;
 end if;

 result:=public.update_routine_versioned('d2c40000-0000-4000-8000-000000000041',auth.uid(),
  'd2c20000-0000-4000-8000-000000000002','d2c30000-0000-4000-8000-000000000041',1,'{}','{"name":"deleted"}');
 if result->>'code'<>'ENTITY_DELETED' then raise exception 'FAIL deleted: %',result; end if;

 result:=public.update_routine_versioned('d2c40000-0000-4000-8000-000000000042',auth.uid(),
  'd2c20000-0000-4000-8000-000000000001','d2c30000-0000-4000-8000-000000000001',3,'{}','{"name":"occupied"}');
 if result->>'code'<>'ROUTINE_VERSION_ID_UNAVAILABLE' then raise exception 'FAIL version id: %',result; end if;

 foreach vial in array array[
  'd2c10000-0000-4000-8000-000000000003'::uuid,
  'd2c10000-0000-4000-8000-000000000004'::uuid,
  'd2c10000-0000-4000-8000-000000000005'::uuid,
  'd2c10000-0000-4000-8000-000000000099'::uuid] loop
  n:=n+1;
  result:=public.update_routine_versioned(
   ('d2c40000-0000-4000-8000-'||lpad((50+n)::text,12,'0'))::uuid,auth.uid(),
   'd2c20000-0000-4000-8000-000000000001',
   ('d2c30000-0000-4000-8000-'||lpad((50+n)::text,12,'0'))::uuid,3,'{}',
   jsonb_build_object('vial_id',vial));
  if result->>'code'<>'VIAL_NOT_AVAILABLE' then raise exception 'FAIL vial indisponivel: %',result; end if;
 end loop;
 if (select count(*) from public.routine_versions)<>versions then raise exception 'FAIL conflito criou versao'; end if;

 result:=public.update_routine_versioned('d2c40000-0000-4000-8000-000000000060',auth.uid(),
  'd2c20000-0000-4000-8000-000000000099','d2c30000-0000-4000-8000-000000000060',1,'{}','{}');
 if result->>'code'<>'ROUTINE_NOT_AVAILABLE' or result->'remote'<>'null'::jsonb then
  raise exception 'FAIL isolamento de Rotina: %',result;
 end if;
end $$;

-- K: expected_user e entitlement bloqueiam operacoes novas; replay precede entitlement.
do $$
declare blocked boolean:=false; replay_result jsonb; base jsonb;
begin
 select rv.snapshot into base from public.routines r join public.routine_versions rv
  on rv.user_id=r.user_id and rv.routine_id=r.id and rv.version=r.version
  where r.id='d2c20000-0000-4000-8000-000000000001';
 begin perform public.update_routine_versioned('d2c40000-0000-4000-8000-000000000070',
  'd2c00000-0000-4000-8000-000000000003','d2c20000-0000-4000-8000-000000000001',
  'd2c30000-0000-4000-8000-000000000070',3,base,'{}');
 exception when others then blocked:=sqlerrm like 'Conta alterada%'; end;
 if not blocked then raise exception 'FAIL expected_user'; end if;

 blocked:=false;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.update_routine_versioned('d2c40000-0000-4000-8000-000000000072',
  'd2c00000-0000-4000-8000-000000000001','d2c20000-0000-4000-8000-000000000001',
  'd2c30000-0000-4000-8000-000000000072',3,base,'{}');
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL auth.uid nulo'; end if;

 perform set_config('request.jwt.claim.sub','d2c00000-0000-4000-8000-000000000002',true); blocked:=false;
 begin perform public.update_routine_versioned('d2c40000-0000-4000-8000-000000000071',auth.uid(),
  'd2c20000-0000-4000-8000-000000000099','d2c30000-0000-4000-8000-000000000071',1,'{}','{}');
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'FAIL entitlement'; end if;

 perform set_config('request.jwt.claim.sub','d2c00000-0000-4000-8000-000000000001',true);
 reset role;
 update public.trials set started_at=now()-interval '8 days',ends_at=now()-interval '1 day'
  where user_id='d2c00000-0000-4000-8000-000000000001';
 set local role authenticated;
 replay_result:=public.update_routine_versioned('d2c40000-0000-4000-8000-000000000030',auth.uid(),
  'd2c20000-0000-4000-8000-000000000001','d2c30000-0000-4000-8000-000000000030',3,base,'{}');
 if not (replay_result->>'replay')::boolean or not (replay_result->>'no_op')::boolean then
  raise exception 'FAIL replay sem entitlement: %',replay_result;
 end if;
 reset role;
 update public.trials set started_at=now()-interval '1 day',ends_at=now()+interval '6 days'
  where user_id='d2c00000-0000-4000-8000-000000000001';
 set local role authenticated;
 perform set_config('request.jwt.claim.sub','d2c00000-0000-4000-8000-000000000001',true);
end $$;

-- N: falha entre UPDATE e INSERT da versao reverte Rotina e ledger.
reset role;
create function pg_temp.fail_d2c_version() returns trigger language plpgsql as $$
begin if new.id='d2c30000-0000-4000-8000-000000000080' then raise exception 'falha injetada D2-C'; end if; return new; end $$;
create trigger fail_d2c_version before insert on public.routine_versions
for each row execute function pg_temp.fail_d2c_version();
set local role authenticated;
select set_config('request.jwt.claim.sub','d2c00000-0000-4000-8000-000000000001',true);
do $$ declare blocked boolean:=false; stamp timestamptz; begin
 select updated_at into stamp from public.routines where id='d2c20000-0000-4000-8000-000000000003';
 begin perform public.update_routine_versioned('d2c40000-0000-4000-8000-000000000080',auth.uid(),
  'd2c20000-0000-4000-8000-000000000003','d2c30000-0000-4000-8000-000000000080',1,'{}','{"name":"Nao persiste"}');
 exception when others then blocked:=sqlerrm='falha injetada D2-C'; end;
 if not blocked or (select version from public.routines where id='d2c20000-0000-4000-8000-000000000003')<>1
  or (select name from public.routines where id='d2c20000-0000-4000-8000-000000000003')<>'Rollback'
  or (select updated_at from public.routines where id='d2c20000-0000-4000-8000-000000000003')<>stamp then
  raise exception 'FAIL rollback atomico';
 end if;
end $$;
reset role;
do $$ begin
 if exists(select 1 from public.domain_mutation_operations
   where operation_id='d2c40000-0000-4000-8000-000000000080') then
  raise exception 'FAIL rollback do ledger';
 end if;
end $$;
drop trigger fail_d2c_version on public.routine_versions;

-- O: grants minimos e nenhum CRUD direto.
do $$ begin
 if not has_function_privilege('authenticated',
  'public.update_routine_versioned(uuid,uuid,uuid,uuid,bigint,jsonb,jsonb)','EXECUTE')
  or has_function_privilege('anon','public.update_routine_versioned(uuid,uuid,uuid,uuid,bigint,jsonb,jsonb)','EXECUTE')
  or has_function_privilege('public','public.update_routine_versioned(uuid,uuid,uuid,uuid,bigint,jsonb,jsonb)','EXECUTE') then
  raise exception 'FAIL grants D2-C';
 end if;
 if has_table_privilege('authenticated','public.routines','INSERT,UPDATE,DELETE')
  or has_table_privilege('authenticated','public.routine_versions','INSERT,UPDATE,DELETE')
  or has_table_privilege('authenticated','public.domain_mutation_operations','INSERT,UPDATE,DELETE') then
  raise exception 'FAIL CRUD direto D2-C';
 end if;
end $$;

rollback;
