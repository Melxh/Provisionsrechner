import type { Cents, CommissionStatus, PaymentModel, ProjectType, RuleSet, Tier } from '../commission/types.ts';
import { PROJECT_TYPE_LABELS, STATUS_LABELS, TIER_LABELS } from '../commission/labels.ts';
import { computeOrderState } from '../commission/status.ts';
import { summarize } from '../commission/summary.ts';
import type { DashboardSummary, Period, SummaryOrder } from '../commission/summary.ts';

export interface DbOrderRow {
  id: string;
  customer_name: string;
  project_type: ProjectType;
  contract_date: string;
  tier: Tier;
  payment_model: PaymentModel;
  custom_threshold_bps: number | null;
  customer_paid_bps: number;
  status_override: CommissionStatus | null;
  status_override_reason: string | null;
  commission_total_cents: number;
  archived_at: string | null;
}
export interface DbPayoutRow { id: string; order_id: string; paid_on: string; amount_cents: number }
export interface DbHistoricalRow {
  id: string;
  customer_name: string;
  paid_on: string;
  amount_cents: number;
  project_type: ProjectType | null;
}

export type RowStatus = CommissionStatus | 'historical';

export interface DashboardRow {
  key: string;
  kind: 'order' | 'historical';
  id: string;
  date: string;
  customer: string;
  projectType: ProjectType | null;
  projectLabel: string;
  status: RowStatus;
  statusLabel: string;
  tier: Tier | null;
  tierLabel: string;
  amountCents: Cents;
}

export interface DashboardFilters {
  search: string;
  projectType: ProjectType | '';
  tier: Tier | '';
  status: RowStatus | '';
}

export const EMPTY_FILTERS: DashboardFilters = { search: '', projectType: '', tier: '', status: '' };

export function periodFor(year: number | null, month: number | null): Period {
  if (year === null) return {};
  const y = String(year);
  if (month === null) return { from: `${y}-01-01`, to: `${y}-12-31` };
  const mm = String(month).padStart(2, '0');
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

const inPeriod = (d: string, p: Period) => (!p.from || d >= p.from) && (!p.to || d <= p.to);

export function buildDashboard(
  data: { orders: DbOrderRow[]; payouts: DbPayoutRow[]; historical: DbHistoricalRow[] },
  rules: Pick<RuleSet, 'payoutThresholds'>,
  period: Period,
  filters: DashboardFilters,
): { summary: DashboardSummary; rows: DashboardRow[] } {
  const payoutsByOrder = new Map<string, DbPayoutRow[]>();
  for (const p of data.payouts) {
    const list = payoutsByOrder.get(p.order_id) ?? [];
    list.push(p);
    payoutsByOrder.set(p.order_id, list);
  }

  const summaryOrders: SummaryOrder[] = data.orders.map((o) => ({
    id: o.id,
    contractDate: o.contract_date,
    archived: o.archived_at !== null,
    commissionTotalCents: o.commission_total_cents,
    paymentModel: o.payment_model,
    customThresholdBps: o.custom_threshold_bps,
    customerPaidBps: o.customer_paid_bps,
    statusOverride: o.status_override ? { status: o.status_override, reason: o.status_override_reason ?? '' } : null,
    payouts: (payoutsByOrder.get(o.id) ?? []).map((p) => ({ amountCents: p.amount_cents, paidOn: p.paid_on })),
  }));

  const summary = summarize(
    summaryOrders,
    data.historical.map((h) => ({ id: h.id, paidOn: h.paid_on, amountCents: h.amount_cents })),
    rules,
    period,
  );

  const rows: DashboardRow[] = [];
  const stateById = new Map(summaryOrders.map((o) => [o.id, computeOrderState(o, rules)]));
  for (const o of data.orders) {
    if (o.archived_at !== null || !inPeriod(o.contract_date, period)) continue;
    const status = stateById.get(o.id)!.status;
    rows.push({
      key: `o-${o.id}`, kind: 'order', id: o.id, date: o.contract_date, customer: o.customer_name,
      projectType: o.project_type, projectLabel: PROJECT_TYPE_LABELS[o.project_type],
      status, statusLabel: STATUS_LABELS[status], tier: o.tier, tierLabel: TIER_LABELS[o.tier],
      amountCents: o.commission_total_cents,
    });
  }
  for (const h of data.historical) {
    if (!inPeriod(h.paid_on, period)) continue;
    rows.push({
      key: `h-${h.id}`, kind: 'historical', id: h.id, date: h.paid_on, customer: h.customer_name,
      projectType: h.project_type, projectLabel: h.project_type ? PROJECT_TYPE_LABELS[h.project_type] : '–',
      status: 'historical', statusLabel: 'Historisch ausgezahlt', tier: null, tierLabel: '–',
      amountCents: h.amount_cents,
    });
  }

  const q = filters.search.trim().toLocaleLowerCase('de-DE');
  const filtered = rows
    .filter((r) => !q || r.customer.toLocaleLowerCase('de-DE').includes(q))
    .filter((r) => !filters.projectType || r.projectType === filters.projectType)
    .filter((r) => !filters.tier || r.tier === filters.tier)
    .filter((r) => !filters.status || r.status === filters.status)
    .sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date < b.date ? 1 : -1));

  return { summary, rows: filtered };
}
