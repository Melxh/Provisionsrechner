-- Legt einen Auftrag samt Zusatzprodukt- und Anpassungspositionen in EINER Transaktion an.
-- security invoker: Row Level Security gilt unverändert für den aufrufenden Benutzer.
-- Die Gesamtprovision wird aus dem Berechnungs-Snapshot übernommen (kein separater, abweichender Wert möglich).
create or replace function public.create_order(
  p_order       jsonb,
  p_addons      jsonb default '[]'::jsonb,
  p_adjustments jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.orders (
    customer_name, project_type, contract_date, order_number, confirmation_date, note, tier,
    payment_model, custom_threshold_bps, customer_paid_bps, expected_payout_date,
    rule_set_id, calculation, commission_total_cents
  ) values (
    p_order ->> 'customer_name',
    (p_order ->> 'project_type')::public.project_type,
    (p_order ->> 'contract_date')::date,
    nullif(p_order ->> 'order_number', ''),
    nullif(p_order ->> 'confirmation_date', '')::date,
    nullif(p_order ->> 'note', ''),
    (p_order ->> 'tier')::public.commission_tier,
    coalesce(nullif(p_order ->> 'payment_model', '')::public.payment_model, 'regular'),
    nullif(p_order ->> 'custom_threshold_bps', '')::integer,
    coalesce(nullif(p_order ->> 'customer_paid_bps', '')::integer, 0),
    nullif(p_order ->> 'expected_payout_date', '')::date,
    nullif(p_order ->> 'rule_set_id', '')::uuid,
    p_order -> 'calculation',
    (p_order -> 'calculation' -> 'result' ->> 'totalCents')::bigint
  )
  returning id into v_id;

  insert into public.order_addons (order_id, product_key, label, kind, net_value_cents, rate_bps, quantity, commission_cents)
  select v_id, a.product_key, a.label, a.kind, a.net_value_cents, a.rate_bps, coalesce(a.quantity, 1), a.commission_cents
    from jsonb_to_recordset(coalesce(p_addons, '[]'::jsonb)) as a(
      product_key text, label text, kind text, net_value_cents bigint, rate_bps integer, quantity integer, commission_cents bigint);

  insert into public.order_adjustments (order_id, label, amount_cents)
  select v_id, j.label, j.amount_cents
    from jsonb_to_recordset(coalesce(p_adjustments, '[]'::jsonb)) as j(label text, amount_cents bigint);

  return v_id;
end $$;

revoke all on function public.create_order(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.create_order(jsonb, jsonb, jsonb) to authenticated;
