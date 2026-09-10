-- SOMENTE teste incremental A4. Rodar após 202609100002_complete_legacy_import.sql.
-- Fixtures aleatórios, sem contas reais. Não repete a suite block_a.sql.
begin;
do $$ declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); begin
  insert into auth.users(id,email) values(a,a||'@example.invalid'),(b,b||'@example.invalid');
  perform set_config('pepday.test_a',a::text,true);
  perform set_config('pepday.test_b',b::text,true);
  perform set_config('request.jwt.claim.sub',a::text,true);
end $$;
set local role authenticated;
do $$
declare u uuid:=auth.uid(); i uuid; other uuid; result jsonb; again jsonb; snapshot jsonb;
  vs jsonb:='[{"id":"11111111-1111-4111-8111-111111111111","name":"Fixture","initialMg":10,"remainingMg":8,"waterMl":2,"date":"2026-09-10","cost":0,"history":[{"type":"undo","mg":1}]}]';
  rs jsonb:='[{"id":"22222222-2222-4222-8222-222222222222","vialId":"11111111-1111-4111-8111-111111111111","name":"Fixture","doseValue":1000,"doseUnit":"mcg","syringeCapacity":30,"frequency":"5on2off","weekdays":[],"start":"2026-09-10","time":"08:00","refillAt":3,"done":["2026-09-09"],"doseHistory":[]}]';
  changed jsonb;
begin
  snapshot:=jsonb_build_object('sourceVersion','2.9','raw',jsonb_build_object(
    'pepday_v2_vials',vs::text,'pepday_v1_routines',rs::text,'pepday_tutorial_v29_seen','1'));
  i:=public.stage_local_import(repeat('a',64),snapshot,u);
  begin
    perform public.complete_local_import(i,u,repeat('a',64),'import');
    raise exception 'FAIL required onboarding';
  exception when raise_exception then
    if SQLERRM<>'Conclua o cadastro antes de importar' then raise; end if;
  end;
  perform public.complete_onboarding('Fixture','BR','America/Sao_Paulo',true,'fixture','fixture',false);
  result:=public.complete_local_import(i,u,repeat('a',64),'import');
  if result->>'status'<>'completed' or jsonb_array_length(result->'records')<>2 then raise exception 'FAIL completion'; end if;
  if (select count(*) from public.vials)<>1 or (select remaining_mg from public.vials)<>8
    or (select concentration from public.vials)<>5 then raise exception 'FAIL vial conversion'; end if;
  if (select count(*) from public.vial_movements)<>1 or (select kind from public.vial_movements)<>'import'
    or (select delta_mg from public.vial_movements)<>8 then raise exception 'FAIL opening balance'; end if;
  if (select frequency from public.routines)<>'5on2off' or (select dose_unit from public.routines)<>'mcg'
    or (select count(*) from public.routine_versions)<>1 then raise exception 'FAIL routine conversion'; end if;
  if exists(select 1 from public.applications) then raise exception 'FAIL invented applications'; end if;
  if (select source_record->'history' from public.legacy_import_records where kind='vial')<>vs->0->'history'
    or (select source_record->'done' from public.legacy_import_records where kind='routine')<>rs->0->'done' then
    raise exception 'FAIL lost history'; end if;
  again:=public.complete_local_import(i,u,repeat('a',64),'import');
  if again<>result then raise exception 'FAIL replay'; end if;
  -- Outro snapshot, mesmos registros: reutiliza IDs, saldo e movimento existentes.
  other:=public.stage_local_import(repeat('b',64),jsonb_set(snapshot,'{raw,pepday_tutorial_v29_seen}','"2"'),u);
  begin
    perform public.complete_local_import(other,u,repeat('b',64),'import');
    raise exception 'FAIL merge choice';
  exception when raise_exception then
    if SQLERRM<>'Já há dados na conta. Escolha mesclar com segurança' then raise; end if;
  end;
  again:=public.complete_local_import(other,u,repeat('b',64),'merge');
  if again->'verification'->>'reused'<>'2' or (select count(*) from public.vial_movements)<>1 then raise exception 'FAIL merge duplicates'; end if;
  changed:=jsonb_set(vs,'{0,remainingMg}','7');
  other:=public.stage_local_import(repeat('c',64),jsonb_set(snapshot,'{raw,pepday_v2_vials}',to_jsonb(changed::text)),u);
  begin
    perform public.complete_local_import(other,u,repeat('c',64),'merge');
    raise exception 'FAIL balance overwrite';
  exception when raise_exception then
    if SQLERRM<>'Conflito no legado; nenhum saldo foi sobrescrito' then raise; end if;
  end;
  if (select remaining_mg from public.vials)<>8 then raise exception 'FAIL changed balance'; end if;
  -- Falha depois de inserir novo frasco: toda a chamada deve reverter.
  changed:=jsonb_set(vs,'{0,id}','"33333333-3333-4333-8333-333333333333"');
  other:=public.stage_local_import(repeat('d',64),jsonb_set(snapshot,'{raw,pepday_v2_vials}',to_jsonb(changed::text)),u);
  begin
    perform public.complete_local_import(other,u,repeat('d',64),'merge');
    raise exception 'FAIL orphan allowed';
  exception when raise_exception then
    if SQLERRM<>'Rotina sem frasco no snapshot' then raise; end if;
  end;
  if (select count(*) from public.vials)<>1 or (select count(*) from public.legacy_import_records)<>2 then raise exception 'FAIL partial transaction'; end if;
  if (select status from public.local_data_imports where id=other)<>'staged' then raise exception 'FAIL premature completion'; end if;
  begin
    perform public.complete_local_import(i,current_setting('pepday.test_b')::uuid,repeat('a',64),'merge');
    raise exception 'FAIL account mismatch';
  exception when raise_exception then if SQLERRM<>'Conta inválida' then raise; end if; end;
  perform set_config('pepday.test_import',i::text,true);
  perform set_config('pepday.test_snapshot',snapshot::text,true);
  perform set_config('pepday.test_target',(select id::text from public.vials),true);
end $$;

select set_config('request.jwt.claim.sub',current_setting('pepday.test_b'),true);
do $$ declare u uuid:=auth.uid(); i uuid; begin
  if exists(select 1 from public.legacy_import_records) then raise exception 'FAIL legacy RLS'; end if;
  begin
    perform public.get_local_import_receipt(current_setting('pepday.test_import')::uuid,u);
    raise exception 'FAIL cross-account receipt';
  exception when raise_exception then if SQLERRM<>'Importação não encontrada' then raise; end if; end;
  begin
    update public.legacy_import_records set source_record='{}';
    raise exception 'FAIL editable legacy';
  exception when insufficient_privilege then null; end;
  perform public.complete_onboarding('Fixture','BR','America/Sao_Paulo',true,'fixture','fixture',false);
  i:=public.stage_local_import(repeat('a',64),current_setting('pepday.test_snapshot')::jsonb,u);
  perform public.complete_local_import(i,u,repeat('a',64),'import');
  if (select count(*) from public.vials)<>1 or (select id::text from public.vials)=current_setting('pepday.test_target') then
    raise exception 'FAIL IDs across accounts'; end if;
end $$;
set local role anon;
do $$ begin
  begin
    perform public.complete_local_import(gen_random_uuid(),gen_random_uuid(),repeat('a',64),'merge');
    raise exception 'FAIL anonymous completion';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS — conversão, saldo, legado, repetição, mesclagem, rollback e isolamento' as resultado;
rollback;
