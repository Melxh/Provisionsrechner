import { requireClient } from '../supabase';
import type { DbAttachmentRef, DbHistoricalRow, DbOrderRow, DbPayoutRow } from './dashboardModel';

async function check<T>(
  p: PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  const { data, error } = await p;

  if (error) {
    throw new Error(error.message);
  }

  if (data === null) {
    return [];
  }

  if (!Array.isArray(data)) {
    throw new Error('Unerwartete Antwort von Supabase.');
  }

  return data as T[];
}

/** Lädt nur, was die Kennzahlen brauchen. Zugriff wird per RLS auf den angemeldeten Benutzer beschränkt. */
export async function loadDashboardData() {
  const c = requireClient();
  const [orders, payouts, historical, attachments] = await Promise.all([
    check<DbOrderRow>(c.from('orders').select(
      'id, customer_name, project_type, contract_date, tier, payment_model, custom_threshold_bps, customer_paid_bps, status_override, status_override_reason, commission_total_cents, archived_at, thresholds:calculation->rules->payoutThresholds',
    ).order('contract_date', { ascending: false }).limit(5000)),
    check<DbPayoutRow>(c.from('payouts').select('id, order_id, paid_on, amount_cents').limit(10000)),
    check<DbHistoricalRow>(c.from('historical_payouts').select('id, customer_name, paid_on, amount_cents, project_type').limit(5000)),
    check<DbAttachmentRef>(c.from('attachments').select('id, order_id, payout_id, historical_payout_id').limit(20000)),
  ]);
  return { orders, payouts, historical, attachments };
}
