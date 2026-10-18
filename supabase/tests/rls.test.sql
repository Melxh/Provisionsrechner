-- pgTAP-Tests für Zugriffsschutz (Tests 19–21). Ausführen mit: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'a@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', 'b@example.test');

-- Benutzer A legt Daten an
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
insert into public.orders (id, customer_name, project_type, contract_date, tier, calculation, commission_total_cents)
values ('11111111-1111-1111-1111-111111111111', 'Testkunde A', 'pv', '2026-10-01', 'pro', '{}', 100000);
reset role;
insert into storage.objects (bucket_id, name, owner_id)
values ('documents', '00000000-0000-0000-0000-00000000000a/order/x.pdf', '00000000-0000-0000-0000-00000000000a');

-- 19: nicht angemeldet (anon) -> kein Zugriff
set local role anon;
select throws_ok('select * from public.orders', '42501', null, 'anon darf orders nicht lesen');
select throws_ok('select * from public.historical_payouts', '42501', null, 'anon darf historische Auszahlungen nicht lesen');
select is((select count(*)::int from storage.objects where bucket_id = 'documents'), 0, 'anon sieht keine Dateien');
reset role;

-- 20: Benutzer B sieht/ändert nichts von A
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.orders), 0, 'B sieht keine Aufträge von A');
select is((with u as (update public.orders set customer_name = 'gehackt' returning 1) select count(*)::int from u), 0, 'B kann Aufträge von A nicht ändern');
select is((with d as (delete from public.orders returning 1) select count(*)::int from d), 0, 'B kann Aufträge von A nicht löschen');
select throws_ok(
  $$insert into public.orders (user_id, customer_name, project_type, contract_date, tier, calculation, commission_total_cents)
    values ('00000000-0000-0000-0000-00000000000a', 'fremd', 'pv', '2026-10-01', 'pro', '{}', 1)$$,
  '42501', null, 'B kann keine Daten im Namen von A anlegen');
select throws_ok(
  $$insert into public.audit_log (user_id, entity_table, entity_id, action, changes)
    values ('00000000-0000-0000-0000-00000000000b', 'orders', gen_random_uuid(), 'insert', '{}')$$,
  '42501', null, 'Änderungsprotokoll ist nicht direkt beschreibbar');

-- 21: Dateien sind privat
select is((select count(*)::int from storage.objects where bucket_id = 'documents'), 0, 'B sieht keine Dateien von A');
reset role;
select is((select public from storage.buckets where id = 'documents'), false, 'Bucket "documents" ist nicht öffentlich');

-- A sieht den eigenen Auftrag
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.orders), 1, 'A sieht den eigenen Auftrag');
reset role;

select * from finish();
rollback;
