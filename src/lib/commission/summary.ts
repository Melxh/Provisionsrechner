import type { Cents, RuleSet } from './types.ts';
import { sumCents } from './money.ts';
import { computeOrderState } from './status.ts';
import type { OrderForStatus } from './status.ts';

export interface SummaryOrder extends OrderForStatus {
  id: string;
  contractDate: string;
  archived: boolean;
}

export interface SummaryHistoricalPayout {
  id: string;
  paidOn: string;
  amountCents: Cents;
}

export interface Period {
  /** ISO-Datum, inklusiv */
  from?: string;
  to?: string;
}

export interface DashboardSummary {
  expectedCents: Cents;
  openCents: Cents;
  /** Ausgezahlt gesamt = Auszahlungen zu Aufträgen + historische Auszahlungen */
  paidCents: Cents;
  orderPaidCents: Cents;
  historicalPaidCents: Cents;
  /** Erwartet + Offen + Ausgezahlt – jede Auszahlung genau einmal. */
  totalVolumeCents: Cents;
  orderCount: number;
  historicalCount: number;
}

const inPeriod = (date: string, p?: Period) =>
  (!p?.from || date >= p.from) && (!p?.to || date <= p.to);

/**
 * Kennzahlen:
 * - Erwartet/Offen: Restbeträge (Gesamt − ausgezahlt) nicht archivierter Aufträge, gefiltert nach Vertragsdatum.
 * - Ausgezahlt: tatsächliche Auszahlungen (auch archivierter Aufträge), gefiltert nach Auszahlungsdatum.
 * - Historische Auszahlungen fließen nur in "Ausgezahlt", nie in Erwartet/Offen.
 */
export function summarize(
  orders: SummaryOrder[],
  historical: SummaryHistoricalPayout[],
  rules: Pick<RuleSet, 'payoutThresholds'>,
  period?: Period,
): DashboardSummary {
  let expected = 0;
  let open = 0;
  const orderPaid: Cents[] = [];
  let orderCount = 0;

  for (const o of orders) {
    const state = computeOrderState(o, rules);
    orderPaid.push(...o.payouts.filter((p) => inPeriod(p.paidOn, period)).map((p) => p.amountCents));
    if (o.archived || !inPeriod(o.contractDate, period)) continue;
    orderCount += 1;
    if (state.status === 'expected') expected += state.remainingCents;
    else if (state.status === 'open') open += state.remainingCents;
  }

  const hist = historical.filter((h) => inPeriod(h.paidOn, period));
  const orderPaidCents = sumCents(orderPaid);
  const historicalPaidCents = sumCents(hist.map((h) => h.amountCents));
  const paidCents = orderPaidCents + historicalPaidCents;

  return {
    expectedCents: expected,
    openCents: open,
    paidCents,
    orderPaidCents,
    historicalPaidCents,
    totalVolumeCents: expected + open + paidCents,
    orderCount,
    historicalCount: hist.length,
  };
}
