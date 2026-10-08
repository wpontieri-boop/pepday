// Promote the six approved SQL stages and two public Edges by environment substitution only.
export const approvedStages=[
 '20261006213126_partners_p1_test','20261007013353_partners_p1_ux_session','20261007022142_partners_financial_patch',
 '20261008202729_partners_p2_test','20261008210119_partners_p2_privacy','20261008221143_partners_p2_locked_read'
];
export const promoteEnvironment=source=>source.replaceAll('fsbqpyyprtymwrmzsacp','oslefjmwfnddxlotalxu').replaceAll('PARTNERS_TEST_ONLY','PARTNERS_PRODUCTION_ONLY');
export function productionMigration(sources){
 return `-- P1+P2 PROD promotion authorized by owner on 08/10/2026. No TEST data, no P3.
-- Sources preserved below; only environment/issuer guards change. Gates default OFF.
begin;
do $$begin
 if to_regclass('public.partners') is not null then raise exception 'PARTNERS_ALREADY_EXISTS_RECONCILE';end if;
 if md5(pg_get_functiondef('public.claim_card_acquisition(timestamptz)'::regprocedure))<>'4b66fcb9c9c68b33883ab10ad95dc03a'
 or md5(pg_get_functiondef('public.get_entitlement()'::regprocedure))<>'329cdee20d77a221ec365af6a4fb0de6'
 or md5(pg_get_functiondef('public.export_my_data()'::regprocedure))<>'185c06d43cb30c0015b731aafaaf4bf6' then raise exception 'COMMERCIAL_BASELINE_CHANGED_RECONCILE';end if;
end $$;
`+approvedStages.map((name,i)=>`\n-- Approved stage: ${name}\n`+promoteEnvironment(sources[i]).replace(/^(?:begin;|commit;)\r?$/gm,'').replace(/^-- .*TEST.*$/gm,'-- Approved TEST stage promoted to PROD; no commercial changes.')).join('\n')+'\ncommit;\n';
}
export const productionEdge=source=>promoteEnvironment(source).replaceAll('homologacao.pepday.com.br','pepday.com.br');
