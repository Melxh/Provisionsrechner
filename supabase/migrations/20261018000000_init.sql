-- Provisionsmanager – Grundschema
-- Prinzipien:
--  * Jede Tabelle mit personenbezogenen Daten hat RLS (ENABLE + FORCE) und user_id = auth.uid().
--  * Kind-Tabellen sind über (parent_id, user_id) verknüpft: ein Datensatz kann nie einem
--    fremden Elternobjekt zugeordnet werden.
--  * Geldbeträge in ganzen Cent (bigint), Prozentsätze in Basispunkten (integer, 100 = 1 %).
--  * Der Rolle "anon" werden alle Rechte entzogen.
--  * Öffentliche Registrierung bitte im Supabase-Dashboard abschalten (siehe README).

-- ---------------------------------------------------------------------------
-- Typen
-- ---------------------------------------------------------------------------
create type public.commission_tier   as enum ('starter', 'med', 'pro', 'expert');
create type public.project_type      as enum ('pv', 'heat_pump', 'pv_heat_pump', 'other');
create type public.payment_model     as enum ('regular', 'prepayment', 'custom');
create type public.commission_status as enum ('expected', 'open', 'paid');
create type public.attachment_kind   as enum ('offer', 'order_confirmation', 'other', 'payout_proof', 'historical_proof');

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Regelversionen (unveränderlich: nur neue Versionen anlegen)
-- ---------------------------------------------------------------------------
create table public.rule_sets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version    integer not null check (version > 0),
  rules      jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, version),
  unique (id, user_id)
);

-- ---------------------------------------------------------------------------
-- Aufträge
-- ---------------------------------------------------------------------------
create table public.orders (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null default auth.uid() references auth.users (id) on delete cascade,
  customer_name           text not null check (length(btrim(customer_name)) between 1 and 200),
  project_type            public.project_type not null,
  contract_date           date not null,
  order_number            text check (order_number is null or length(order_number) <= 100),
  confirmation_date       date,
  note                    text check (note is null or length(note) <= 5000),
  tier                    public.commission_tier not null,            -- Stufe zum Vertragsabschluss
  payment_model           public.payment_model not null default 'regular',
  custom_threshold_bps    integer check (custom_threshold_bps between 0 and 10000),
  customer_paid_bps       integer not null default 0 check (customer_paid_bps between 0 and 10000),
  expected_payout_date    date,                                       -- ≠ Vertragsdatum
  status_override         public.commission_status,
  status_override_reason  text,
  rule_set_id             uuid,
  calculation             jsonb not null,                             -- Snapshot: Eingaben, Regeln, Ergebnis
  calculation_history     jsonb not null default '[]'::jsonb,         -- frühere Snapshots (nur per Trigger gefüllt)
  commission_total_cents  bigint not null,
  archived_at             timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (id, user_id),
  foreign key (rule_set_id, user_id) references public.rule_sets (id, user_id),
  check (payment_model <> 'custom' or custom_threshold_bps is not null),
  check (status_override is null or length(btrim(coalesce(status_override_reason, ''))) > 0)
);
create index orders_user_contract_idx on public.orders (user_id, contract_date desc);
create index orders_user_customer_idx on public.orders (user_id, lower(customer_name));

-- Beim Neuberechnen wird der bisherige Snapshot automatisch (serverseitig) archiviert.
create or replace function public.orders_keep_calculation_history()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.calculation is distinct from old.calculation then
    new.calculation_history := old.calculation_history
      || jsonb_build_array(jsonb_build_object(
           'replaced_at', now(),
           'commission_total_cents', old.commission_total_cents,
           'calculation', old.calculation));
  else
    new.calculation_history := old.calculation_history;  -- Historie nicht von außen änderbar
  end if;
  return new;
end $$;

create trigger orders_calculation_history
  before update on public.orders
  for each row execute function public.orders_keep_calculation_history();

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- Zusatzproduktpositionen (abfragbare Kopie; maßgeblich bleibt orders.calculation)
create table public.order_addons (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  order_id         uuid not null,
  product_key      text not null,
  label            text not null check (length(btrim(label)) between 1 and 200),
  kind             text not null check (kind in ('percent', 'fixed', 'custom')),
  net_value_cents  bigint check (net_value_cents is null or net_value_cents >= 0),
  rate_bps         integer check (rate_bps is null or rate_bps between 0 and 10000),
  quantity         integer not null default 1 check (quantity between 1 and 1000),
  commission_cents bigint not null,
  foreign key (order_id, user_id) references public.orders (id, user_id) on delete cascade
);
create index order_addons_order_idx on public.order_addons (order_id);

-- Ausdrücklich erfasste sonstige Anpassungen
create table public.order_adjustments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  order_id     uuid not null,
  label        text not null check (length(btrim(label)) between 1 and 200),
  amount_cents bigint not null,
  foreign key (order_id, user_id) references public.orders (id, user_id) on delete cascade
);
create index order_adjustments_order_idx on public.order_adjustments (order_id);

-- ---------------------------------------------------------------------------
-- Auszahlungen (auch Teilzahlungen) zu Aufträgen
-- ---------------------------------------------------------------------------
create table public.payouts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  order_id     uuid not null,
  paid_on      date not null,
  amount_cents bigint not null check (amount_cents > 0),
  note         text check (note is null or length(note) <= 5000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, user_id),
  foreign key (order_id, user_id) references public.orders (id, user_id) on delete restrict
);
create index payouts_order_idx on public.payouts (order_id);
create index payouts_user_paid_idx on public.payouts (user_id, paid_on desc);
create trigger payouts_set_updated_at before update on public.payouts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Historische Auszahlungen (eigenständig, ohne Regel-/Produktbezug)
-- ---------------------------------------------------------------------------
create table public.historical_payouts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  customer_name text not null check (length(btrim(customer_name)) between 1 and 200),
  paid_on       date not null,
  amount_cents  bigint not null check (amount_cents > 0),
  project_type  public.project_type,
  former_tier   text check (former_tier is null or length(former_tier) <= 100),   -- Freitext: frühere Modelle
  former_model  text check (former_model is null or length(former_model) <= 200),
  note          text check (note is null or length(note) <= 5000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, user_id)
);
create index historical_payouts_user_paid_idx on public.historical_payouts (user_id, paid_on desc);
create trigger historical_payouts_set_updated_at before update on public.historical_payouts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Dateianhänge (Dateien selbst liegen im privaten Bucket "documents")
-- ---------------------------------------------------------------------------
create table public.attachments (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind                  public.attachment_kind not null,
  order_id              uuid,
  payout_id             uuid,
  historical_payout_id  uuid,
  file_name             text not null check (length(btrim(file_name)) between 1 and 255),
  storage_path          text not null unique,
  mime_type             text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes            bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  created_at            timestamptz not null default now(),
  check (num_nonnulls(order_id, payout_id, historical_payout_id) = 1),
  check (storage_path like user_id::text || '/%'),
  foreign key (order_id, user_id) references public.orders (id, user_id) on delete cascade,
  foreign key (payout_id, user_id) references public.payouts (id, user_id) on delete cascade,
  foreign key (historical_payout_id, user_id) references public.historical_payouts (id, user_id) on delete cascade
);
create index attachments_order_idx on public.attachments (order_id);
create index attachments_payout_idx on public.attachments (payout_id);
create index attachments_historical_idx on public.attachments (historical_payout_id);

-- ---------------------------------------------------------------------------
-- Änderungsprotokoll (nur lesbar für den Benutzer; geschrieben ausschließlich per Trigger)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  entity_table text not null,
  entity_id    uuid not null,
  action       text not null check (action in ('insert', 'update', 'delete')),
  changes      jsonb not null,
  created_at   timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (user_id, entity_table, entity_id, created_at desc);

create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_row jsonb := case when tg_op = 'DELETE' then v_old else v_new end;
  v_changes jsonb;
begin
  -- Große bzw. technische Felder nicht ins Protokoll: Snapshots sind in orders selbst versioniert.
  select coalesce(jsonb_object_agg(k, jsonb_build_object('old', v_old -> k, 'new', v_new -> k)), '{}'::jsonb)
    into v_changes
    from (select key as k from jsonb_object_keys(v_old || v_new) as key) keys
   where k not in ('updated_at', 'calculation', 'calculation_history', 'created_at')
     and (v_old -> k) is distinct from (v_new -> k);

  if tg_op = 'UPDATE' and v_changes = '{}'::jsonb then
    return new;
  end if;

  insert into public.audit_log (user_id, entity_table, entity_id, action, changes)
  values ((v_row ->> 'user_id')::uuid, tg_table_name, (v_row ->> 'id')::uuid, lower(tg_op), v_changes);

  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger orders_audit             after insert or update or delete on public.orders             for each row execute function public.audit_row_change();
create trigger payouts_audit            after insert or update or delete on public.payouts            for each row execute function public.audit_row_change();
create trigger historical_payouts_audit after insert or update or delete on public.historical_payouts for each row execute function public.audit_row_change();
create trigger attachments_audit        after insert or delete           on public.attachments        for each row execute function public.audit_row_change();
create trigger rule_sets_audit          after insert                     on public.rule_sets          for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['rule_sets','orders','order_addons','order_adjustments','payouts','historical_payouts','attachments','audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    -- audit_log bewusst ohne FORCE: der Audit-Trigger (security definer, Tabelleneigentümer) muss schreiben können.
    if t <> 'audit_log' then
      execute format('alter table public.%I force row level security', t);
    end if;
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from public', t);
  end loop;
end $$;

-- Vollzugriff auf eigene Daten
do $$
declare t text;
begin
  foreach t in array array['orders','order_addons','order_adjustments','payouts','historical_payouts','attachments']
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t || '_delete_own', t);
  end loop;
end $$;

-- Regelversionen: nur lesen und neue Versionen anlegen (keine Änderung, kein Löschen)
grant select, insert on public.rule_sets to authenticated;
create policy rule_sets_select_own on public.rule_sets for select to authenticated using (user_id = (select auth.uid()));
create policy rule_sets_insert_own on public.rule_sets for insert to authenticated with check (user_id = (select auth.uid()));

-- Änderungsprotokoll: nur lesen
grant select on public.audit_log to authenticated;
create policy audit_log_select_own on public.audit_log for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Privater Datei-Bucket + Storage-Policies (Pfad: <user_id>/<...>)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760,
      allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png'];

create policy documents_select_own on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy documents_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy documents_update_own on storage.objects for update to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy documents_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
