-- Auftragsverwaltung: Bearbeiten (atomar) und Änderungsprotokoll pro Auftrag.

-- 1) Änderungsprotokoll: Zuordnung zum Auftrag, damit der Verlauf eines Auftrags (auch gelöschter Auszahlungen) abrufbar ist.
alter table public.audit_log add column if not exists parent_order_id uuid;
create index if not exists audit_log_parent_idx on public.audit_log (user_id, parent_order_id, created_at desc);

create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_row jsonb := case when tg_op = 'DELETE' then v_old else v_new end;
  v_changes jsonb;
  v_parent uuid;
begin
  select coalesce(jsonb_object_agg(k, jsonb_build_object('old', v_old -> k, 'new', v_new -> k)), '{}'::jsonb)
    into v_changes
    from (select key as k from jsonb_object_keys(v_old || v_new) as key) keys
   where k not in ('updated_at', 'calculation', 'calculation_history', 'created_at')
     and (v_old -> k) is distinct from (v_new -> k);

  if tg_op = 'UPDATE' and v_changes = '{}'::jsonb then
    return new;
  end if;

  v_parent := case when tg_table_name::text = 'orders' then (v_row ->> 'id')::uuid
                   else nullif(v_row ->> 'order_id', '')::uuid end;

  insert into public.audit_log (user_id, entity_table, entity_id, action, changes, parent_order_id)
  values ((v_row ->> 'user_id')::uuid, tg_table_name, (v_row ->> 'id')::uuid, lower(tg_op), v_changes, v_parent);

  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- 2) Auftrag bearbeiten: Auftrag, Zusatzprodukte und Anpassungen in EINER Transaktion ersetzen.
--    Ändert sich der Berechnungs-Snapshot, archiviert der Trigger orders_calculation_history den alten Stand.
create or replace function public.update_order(
  p_order_id    uuid,
  p_order       jsonb,
  p_addons      jsonb default '[]'::jsonb,
  p_adjustments jsonb default '[]'::jsonb
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.orders set
    customer_name          = p_order ->> 'customer_name',
    project_type           = (p_order ->> 'project_type')::public.project_type,
    contract_date          = (p_order ->> 'contract_date')::date,
    order_number           = nullif(p_order ->> 'order_number', ''),
    confirmation_date      = nullif(p_order ->> 'confirmation_date', '')::date,
    note                   = nullif(p_order ->> 'note', ''),
    tier                   = (p_order ->> 'tier')::public.commission_tier,
    payment_model          = coalesce(nullif(p_order ->> 'payment_model', '')::public.payment_model, 'regular'),
    custom_threshold_bps   = nullif(p_order ->> 'custom_threshold_bps', '')::integer,
    customer_paid_bps      = coalesce(nullif(p_order ->> 'customer_paid_bps', '')::integer, 0),
    expected_payout_date   = nullif(p_order ->> 'expected_payout_date', '')::date,
    status_override        = nullif(p_order ->> 'status_override', '')::public.commission_status,
    status_override_reason = nullif(p_order ->> 'status_override_reason', ''),
    rule_set_id            = nullif(p_order ->> 'rule_set_id', '')::uuid,
    calculation            = p_order -> 'calculation',
    commission_total_cents = (p_order -> 'calculation' -> 'result' ->> 'totalCents')::bigint
  where id = p_order_id;

  if not found then
    raise exception 'Auftrag nicht gefunden' using errcode = 'P0002';
  end if;

  delete from public.order_addons where order_id = p_order_id;
  insert into public.order_addons (order_id, product_key, label, kind, net_value_cents, rate_bps, quantity, commission_cents)
  select p_order_id, a.product_key, a.label, a.kind, a.net_value_cents, a.rate_bps, coalesce(a.quantity, 1), a.commission_cents
    from jsonb_to_recordset(coalesce(p_addons, '[]'::jsonb)) as a(
      product_key text, label text, kind text, net_value_cents bigint, rate_bps integer, quantity integer, commission_cents bigint);

  delete from public.order_adjustments where order_id = p_order_id;
  insert into public.order_adjustments (order_id, label, amount_cents)
  select p_order_id, j.label, j.amount_cents
    from jsonb_to_recordset(coalesce(p_adjustments, '[]'::jsonb)) as j(label text, amount_cents bigint);
end $$;

revoke all on function public.update_order(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.update_order(uuid, jsonb, jsonb, jsonb) to authenticated;
