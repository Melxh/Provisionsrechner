import type { Cents, CommissionStatus, ProjectType, RuleSet, Tier } from '../commission/types.ts';
import { PROJECT_TYPE_LABELS, STATUS_LABELS, TIER_LABELS } from '../commission/labels.ts';
import { computeOrderState } from '../commission/status.ts';
import type { DbAttachmentRef, DbOrderRow, DbPayoutRow } from './dashboardModel.ts';

export interface OrdersFilters {
  search: string;
  /** ISO-Datum, inklusiv, bezogen auf das Vertragsdatum */
  from: string;
  to: string;
  projectType: ProjectType | '';
  tier: Tier | '';
  status: CommissionStatus | '';
  archived: 'active' | 'archived' | 'all';
}

export const EMPTY_ORDER_FILTERS: OrdersFilters = { search: '', from: '', to: '', projectType: '', tier: '', status: '', archived: 'active' };

export interface OrderListEntry {
  id: string;
  date: string;
  customer: string;
  orderNumber: string;
  projectLabel: string;
  tierLabel: string;
  status: CommissionStatus;
  statusLabel: string;
  totalCents: Cents;
  paidCents: Cents;
  remainingCents: Cents;
  customerPaidBps: number;
  partiallyPaid: boolean;
  docCount: number;
  archived: boolean;
}

export function buildOrdersList(
  data: { orders: DbOrderRow[]; payouts: DbPayoutRow[]; attachments: DbAttachmentRef[] },
  rules: Pick<RuleSet, 'payoutThresholds'>,
  filters: OrdersFilters,
): { rows: OrderListEntry[]; totals: { totalCents: Cents; paidCents: Cents; remainingCents: Cents } } {
  const payoutsByOrder = new Map<string, DbPayoutRow[]>();
  for (const p of data.payouts) {
    const l = payoutsByOrder.get(p.order_id) ?? [];
    l.push(p);
    payoutsByOrder.set(p.order_id, l);
  }
  const orderOfPayout = new Map(data.payouts.map((p) => [p.id, p.order_id]));
  const docs = new Map<string, number>();
  for (const a of data.attachments) {
    const oid = a.order_id ?? (a.payout_id ? orderOfPayout.get(a.payout_id) : undefined);
    if (oid) docs.set(oid, (docs.get(oid) ?? 0) + 1);
  }

  const q = filters.search.trim().toLocaleLowerCase('de-DE');
  const rows: OrderListEntry[] = [];
  for (const o of data.orders) {
    const archived = o.archived_at !== null;
    if (filters.archived === 'active' && archived) continue;
    if (filters.archived === 'archived' && !archived) continue;
    if (filters.from && o.contract_date < filters.from) continue;
    if (filters.to && o.contract_date > filters.to) continue;
    if (filters.projectType && o.project_type !== filters.projectType) continue;
    if (filters.tier && o.tier !== filters.tier) continue;
    if (q && !`${o.customer_name} ${o.order_number ?? ''}`.toLocaleLowerCase('de-DE').includes(q)) continue;

    const state = computeOrderState({
      commissionTotalCents: o.commission_total_cents,
      paymentModel: o.payment_model,
      customThresholdBps: o.custom_threshold_bps,
      customerPaidBps: o.customer_paid_bps,
      payoutThresholds: o.thresholds ?? null,
      statusOverride: o.status_override ? { status: o.status_override, reason: o.status_override_reason ?? '' } : null,
      payouts: (payoutsByOrder.get(o.id) ?? []).map((p) => ({ amountCents: p.amount_cents, paidOn: p.paid_on })),
    }, rules);
    if (filters.status && state.status !== filters.status) continue;

    rows.push({
      id: o.id, date: o.contract_date, customer: o.customer_name, orderNumber: o.order_number ?? '',
      projectLabel: PROJECT_TYPE_LABELS[o.project_type], tierLabel: TIER_LABELS[o.tier],
      status: state.status, statusLabel: STATUS_LABELS[state.status],
      totalCents: state.totalCents, paidCents: state.paidCents, remainingCents: state.remainingCents,
      customerPaidBps: o.customer_paid_bps, partiallyPaid: state.partiallyPaid,
      docCount: docs.get(o.id) ?? 0, archived,
    });
  }
  rows.sort((a, b) => (a.date === b.date ? a.customer.localeCompare(b.customer, 'de') : a.date < b.date ? 1 : -1));

  const totals = rows.reduce(
    (t, r) => ({ totalCents: t.totalCents + r.totalCents, paidCents: t.paidCents + r.paidCents, remainingCents: t.remainingCents + r.remainingCents }),
    { totalCents: 0, paidCents: 0, remainingCents: 0 },
  );
  return { rows, totals };
}
