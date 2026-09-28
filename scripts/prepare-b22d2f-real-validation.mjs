// Pacote SQL descartável: somente pepday-v3-test. Sem migrations ou segredos.
import { createHash, randomUUID } from 'node:crypto';
export const PROJECT_REF = 'fsbqpyyprtymwrmzsacp';
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${q(JSON.stringify(value))}::jsonb`;
const check = (condition, message) => `if (${condition}) is not true then raise exception ${q(message)}; end if;`;

export function buildPackage({ holdSeconds = 12 } = {}) {
  if (!Number.isInteger(holdSeconds) || holdSeconds < 0 || holdSeconds > 20) throw new Error('holdSeconds inválido');
  const marker = randomUUID(), user = randomUUID(), vial = randomUUID(), importId = randomUUID();
  const sourceHash=createHash('sha256').update(marker).digest('hex');
  const email = `pepday-d2f-${marker}@example.invalid`;
  const cases = [
    ['create_replay','create','create',null,true],
    ['create_conflict','create','create','ENTITY_ALREADY_EXISTS',false],
    ['update_update','update','update','STALE_VERSION',false],
    ['update_delete','update','delete','STALE_VERSION',false],
    ['delete_update','delete','update','ENTITY_DELETED',false],
    ['delete_replay','delete','delete',null,true],
  ].map(([name,a,b,code,replay]) => ({name,a,b,code,replay,routine:randomUUID(),base:randomUUID(),
    va:randomUUID(),vb:randomUUID(),oa:randomUUID(),ob:randomUUID()}));
  for (const c of cases) if (c.replay) { c.vb=c.va; c.ob=c.oa; }
  const ids = {marker,user,vial,importId,email,cases};
  const guard = `id=${q(importId)} and user_id=${q(user)} and source_hash=${q(sourceHash)}
    and source_snapshot->>'fixture'='pepday-b22d2f' and source_snapshot->>'run_marker'=${q(marker)}`;
  const auth = `set local role authenticated; select set_config('request.jwt.claim.sub',${q(user)},true);`;
  const routineIds = cases.map(c=>q(c.routine)).join(',');
  const versionIds = [...new Set(cases.flatMap(c=>[c.base,c.va,c.vb]))].map(q).join(',');
  const operationIds = [...new Set(cases.flatMap(c=>[c.oa,c.ob]))].map(q).join(',');
  const base = c => `(select snapshot from public.routine_versions where id=${q(c.base)})`;
  const rpc = (c, side) => {
    const kind=c[side], op=c[`o${side}`], ver=c[`v${side}`];
    if (kind==='create') return `public.create_routine_versioned(${q(op)},${q(user)},${q(c.routine)},${q(ver)},${q(vial)},'D2-F routine',1,'mg',100,'daily','{}',date '2026-09-25',null,3)`;
    if (kind==='update') return `public.update_routine_versioned(${q(op)},${q(user)},${q(c.routine)},${q(ver)},1,${base(c)},'{"name":"D2-F updated"}'::jsonb)`;
    return `public.soft_delete_routine_versioned(${q(op)},${q(user)},${q(c.routine)},${q(ver)},1,${base(c)})`;
  };
  const setup = `begin;
    set local statement_timeout='20s';
    do $$ begin
    ${check("to_regprocedure('public.create_routine_versioned(uuid,uuid,uuid,uuid,uuid,text,numeric,text,integer,text,integer[],date,time without time zone,integer)') is not null",'D2-B ausente')}
    ${check("to_regprocedure('public.update_routine_versioned(uuid,uuid,uuid,uuid,bigint,jsonb,jsonb)') is not null",'D2-C ausente')}
    ${check("to_regprocedure('public.soft_delete_routine_versioned(uuid,uuid,uuid,uuid,bigint,jsonb)') is not null",'D2-D ausente')}
    ${check(`not exists(select 1 from auth.users where id=${q(user)} or email=${q(email)})`,'Colisão Auth')}
    end $$;
    insert into auth.users(id,email,raw_user_meta_data) values(${q(user)},${q(email)},jsonb_build_object('pepday_d2f_marker',${q(marker)}));
    ${auth}
    select public.complete_onboarding('Fixture D2-F','BR','America/Sao_Paulo',true,'d2f','d2f',false);
    select public.start_trial(); reset role;
    insert into public.vials(id,user_id,name,initial_mg,remaining_mg,water_ml,prepared_on)
      values(${q(vial)},${q(user)},'D2-F immutable stock',10,10,2,date '2026-09-25');
    ${cases.filter(c=>c.a!=='create').map(c=>`insert into public.routines(id,user_id,vial_id,name,dose_value,dose_unit,syringe_capacity,frequency,weekdays,start_date,version)
      values(${q(c.routine)},${q(user)},${q(vial)},'D2-F base',1,'mg',100,'daily','{}',date '2026-09-25',1);
      insert into public.routine_versions(id,user_id,routine_id,version,snapshot)
      select ${q(c.base)},user_id,id,1,public.pepday_routine_snapshot(r) from public.routines r where id=${q(c.routine)};`).join('\n')}
    insert into public.local_data_imports(id,user_id,source_hash,source_version,status,source_snapshot,verification,completed_at)
    values(${q(importId)},${q(user)},${q(sourceHash)},'b22d2f-v1','completed',
      jsonb_build_object('fixture','pepday-b22d2f','run_marker',${q(marker)},'ids',${json(ids)},'evidence','{}'::jsonb,
        'vial',(select to_jsonb(v) from public.vials v where id=${q(vial)}),
        'old_versions',(select jsonb_agg(to_jsonb(v) order by id) from public.routine_versions v where user_id=${q(user)})),
      '{}'::jsonb,now());
    commit; select 'PASS setup D2-F' result;`;
  const scenarios = cases.map(c=> {
    const nameA=`d2f-${marker.slice(0,8)}-${c.name}-a`, nameB=`d2f-${marker.slice(0,8)}-${c.name}-b`;
    const session = side => `begin; set local statement_timeout='35s'; set local lock_timeout='25s';
      select set_config('application_name',${q(side==='a'?nameA:nameB)},true);
      ${auth}
      select set_config('pepday.d2f.started',clock_timestamp()::text,true);
      select set_config('pepday.d2f.result',${rpc(c,side)}::text,true);
      select set_config('pepday.d2f.finished',clock_timestamp()::text,true);
      reset role;
      ${side==='a'?`select pg_sleep(${holdSeconds});`:''}
      update public.local_data_imports set source_snapshot=jsonb_set(source_snapshot,'{evidence,${c.name}_${side}}',
        jsonb_build_object('result',current_setting('pepday.d2f.result')::jsonb,
          'started',current_setting('pepday.d2f.started'),'finished',current_setting('pepday.d2f.finished'),
          'release',clock_timestamp(),'pid',pg_backend_pid())) where ${guard};
      commit; select ${q(c.name+' '+side)} result;`;
    const observe = `select a.pid blocker,b.pid waiter,b.wait_event_type,b.wait_event
      from pg_stat_activity a join pg_stat_activity b on a.pid=any(pg_blocking_pids(b.pid))
      where a.application_name=${q(nameA)} and b.application_name=${q(nameB)}
      and a.wait_event='PgSleep' and b.wait_event_type='Lock';`;
    const recordObservation = rows => {
      if (!Array.isArray(rows) || !rows.some(r=>Number.isInteger(r.blocker)&&Number.isInteger(r.waiter)&&r.blocker!==r.waiter&&r.wait_event_type==='Lock')) throw new Error(`Lock real não comprovado: ${c.name}`);
      return `update public.local_data_imports set source_snapshot=jsonb_set(source_snapshot,'{evidence,${c.name}_lock}',${json(rows)}) where ${guard};`;
    };
    const observeAndRecord = `begin; set local statement_timeout='35s';
      do $$ declare evidence jsonb; deadline timestamptz:=clock_timestamp()+interval '20 seconds'; begin
      loop
        perform pg_stat_clear_snapshot();
        select jsonb_agg(to_jsonb(locks)) into evidence from (${observe.replace(/;$/, '')}) locks;
        exit when evidence is not null;
        if clock_timestamp()>deadline then raise exception 'Lock real não observado: ${c.name}'; end if;
        perform pg_sleep(0.1);
      end loop;
      update public.local_data_imports set source_snapshot=jsonb_set(source_snapshot,'{evidence,${c.name}_lock}',evidence) where ${guard};
      end $$; commit; select source_snapshot#>'{evidence,${c.name}_lock}' locks from public.local_data_imports where ${guard};`;
    return {...c,observeAndRecord,sqlA:session('a'),sqlB:session('b'),observe,recordObservation};
  });
  const verify = `begin; set local statement_timeout='20s';
    do $$ declare s jsonb; a jsonb; b jsonb; replay_result jsonb; begin
    select source_snapshot into strict s from public.local_data_imports where ${guard};
    ${cases.map(c=>`
      a:=s#>'{evidence,${c.name}_a,result}'; b:=s#>'{evidence,${c.name}_b,result}';
      ${check(`a is not null and b is not null and a->>'outcome'='success' and a->>'replay'='false'`,'Resultado A ausente/incorreto '+c.name)}
      ${check(`jsonb_array_length(s#>'{evidence,${c.name}_lock}')>0`,'Lock não comprovado '+c.name)}
      ${check(c.replay?`b=a||'{"replay":true}'::jsonb`:`b->>'outcome'='conflict' and b->>'code'=${q(c.code)} and b->>'replay'='false'`,'Resultado B incorreto '+c.name)}
      ${check(`(s#>>'{evidence,${c.name}_b,started}')::timestamptz < (s#>>'{evidence,${c.name}_a,release}')::timestamptz and (s#>>'{evidence,${c.name}_b,finished}')::timestamptz >= (s#>>'{evidence,${c.name}_a,release}')::timestamptz`,'Sem sobreposição '+c.name)}
      ${check(`(select count(*) from public.routine_versions where routine_id=${q(c.routine)})=${c.a==='create'?1:2}`,'Cardinalidade versões '+c.name)}
      ${check(`(select version from public.routines where id=${q(c.routine)})=${c.a==='create'?1:2}`,'Versão corrente '+c.name)}
      ${check(`(select deleted_at is ${c.a==='delete'?'not ':''}null from public.routines where id=${q(c.routine)})`,'Soft-delete '+c.name)}
      ${check(`(select count(*) from public.domain_mutation_operations where user_id=${q(user)} and entity_id=${q(c.routine)})=${c.replay?1:2}`,'Cardinalidade ledger '+c.name)}
      ${check(`(select result from public.domain_mutation_operations where user_id=${q(user)} and operation_id=${q(c.oa)})=a`,'Ledger A '+c.name)}
      ${check(`(select result from public.domain_mutation_operations where user_id=${q(user)} and operation_id=${q(c.ob)})=(b||'{"replay":false}'::jsonb)`,'Ledger B '+c.name)}
    `).join('\n')}
    ${check(`(select count(*) from public.routines where user_id=${q(user)})=6`,'Cardinalidade total rotinas')}
    ${check(`not exists(select 1 from public.routines r left join public.routine_versions rv on rv.routine_id=r.id and rv.version=r.version where r.user_id=${q(user)} and (rv.id is null or rv.snapshot is distinct from public.pepday_routine_snapshot(r)))`,'Snapshot corrente não canônico')}
    ${check(`(select to_jsonb(v) from public.vials v where id=${q(vial)})=s->'vial'`,'Frasco/saldo alterado')}
    ${check(`(select jsonb_agg(to_jsonb(v) order by id) from public.routine_versions v where id in (${cases.filter(c=>c.a!=='create').map(c=>q(c.base)).join(',')}))=s->'old_versions'`,'Versões antigas alteradas')}
    ${check(`not exists(select 1 from public.applications where user_id=${q(user)}) and not exists(select 1 from public.vial_movements where user_id=${q(user)})`,'Histórico fabricado')}
    end $$;
    select set_config('pepday.d2f.expected',(select jsonb_object_agg(operation_id::text,result)::text from public.domain_mutation_operations where user_id=${q(user)}),true);
    ${auth}
    do $$ declare r jsonb; expected jsonb; begin
    ${cases.map(c=>`r:=${rpc(c,'b')}; expected:=(current_setting('pepday.d2f.expected')::jsonb->${q(c.ob)})||'{"replay":true}'::jsonb;
      ${check('r=expected','Replay instável '+c.name)}`).join('\n')}
    end $$; reset role;
    commit; select 'PASS D2-F: 6 cenários, locks reais, versões, ledger, replay e saldo' result;`;
  const tables=['subscriptions','trials','settings','vials','routines','routine_versions','applications','vial_movements','local_data_imports','legacy_import_records','audit_logs','domain_mutation_operations'];
  const remaining = `select (select count(*) from auth.identities where user_id=${q(user)})+(select count(*) from auth.sessions where user_id=${q(user)})+(select count(*) from auth.refresh_tokens where user_id=${q(user)})+(select count(*) from auth.users where id=${q(user)})+(select count(*) from public.profiles where id=${q(user)})+${tables.map(t=>`(select count(*) from public.${t} where user_id=${q(user)})`).join('+')} total_fixtures`;
  const cleanup = `begin; set local statement_timeout='20s'; do $$ declare s jsonb; n integer; begin
    select source_snapshot into strict s from public.local_data_imports where ${guard} for update;
    ${check(`s->'ids'=${json(ids)}`,'Cleanup recusado: IDs diferentes')}
    ${check(`exists(select 1 from auth.users where id=${q(user)} and email=${q(email)} and raw_user_meta_data->>'pepday_d2f_marker'=${q(marker)})`,'Cleanup recusado: procedência Auth')}
    ${check(`not exists(select 1 from public.vials where user_id=${q(user)} and id<>${q(vial)}) and not exists(select 1 from public.routines where user_id=${q(user)} and id not in (${routineIds})) and not exists(select 1 from public.routine_versions where user_id=${q(user)} and id not in (${versionIds})) and not exists(select 1 from public.domain_mutation_operations where user_id=${q(user)} and operation_id not in (${operationIds})) and not exists(select 1 from public.applications where user_id=${q(user)}) and not exists(select 1 from public.vial_movements where user_id=${q(user)})`,'Cleanup recusado: dados inesperados')}
    ${check(`not exists(select 1 from auth.sessions where user_id=${q(user)}) and not exists(select 1 from auth.identities where user_id=${q(user)}) and not exists(select 1 from auth.refresh_tokens where user_id=${q(user)})`,'Cleanup recusado: sessão Auth inesperada')}
    delete from auth.users where id=${q(user)} and email=${q(email)} and raw_user_meta_data->>'pepday_d2f_marker'=${q(marker)};
    get diagnostics n=row_count; ${check('n=1','Cleanup não removeu exatamente uma fixture')}
    end $$; commit; ${remaining};`;
  return {ids,setup,scenarios,verify,cleanup,remaining};
}
