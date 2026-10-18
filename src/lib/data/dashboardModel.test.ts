import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../commission/rules.ts';
import { EMPTY_FILTERS, buildDashboard, periodFor } from './dashboardModel.ts';
import type { DbOrderRow } from './dashboardModel.ts';

const order = (over: Partial<DbOrderRow>): DbOrderRow => ({
  id: 'o1', customer_name: 'Muster GmbH', project_type: 'pv', contract_date: '2026-10-05', tier: 'pro',
  payment_model: 'regular', custom_threshold_bps: null, customer_paid_bps: 0, status_override: null,
  status_override_reason: null, commission_total_cents: 100_000, archived_at: null, ...over,
});

describe('Zeitraum', () => {
  it('Jahr, Monat, Schaltjahr', () => {
    expect(periodFor(null, null)).toEqual({});
    expect(periodFor(2026, null)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(periodFor(2026, 2)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodFor(2028, 2)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

describe('Dashboard-Modell', () => {
  const data = {
    orders: [
      order({ id: 'a', customer_name: 'Alpha', customer_paid_bps: 9_500 }),
      order({ id: 'b', customer_name: 'Beta', tier: 'starter', contract_date: '2026-09-01', commission_total_cents: 50_000 }),
      order({ id: 'c', customer_name: 'Gamma', archived_at: '2026-10-10T00:00:00Z' }),
    ],
    payouts: [{ id: 'p1', order_id: 'a', paid_on: '2026-10-12', amount_cents: 40_000 }],
    historical: [{ id: 'h1', customer_name: 'Alt AG', paid_on: '2025-05-05', amount_cents: 77_700, project_type: null }],
  };

  it('Kennzahlen: Teilzahlung, erwartet, historisch ohne Doppelzählung', () => {
    const { summary } = buildDashboard(data, DEFAULT_RULES, {}, EMPTY_FILTERS);
    expect(summary.openCents).toBe(60_000);
    expect(summary.expectedCents).toBe(50_000);
    expect(summary.paidCents).toBe(40_000 + 77_700);
    expect(summary.historicalPaidCents).toBe(77_700);
    expect(summary.totalVolumeCents).toBe(60_000 + 50_000 + 117_700);
    expect(summary.orderCount).toBe(2); // archivierter Auftrag zählt nicht
  });

  it('Tabelle: sortiert, ohne archivierte, historische gekennzeichnet', () => {
    const { rows } = buildDashboard(data, DEFAULT_RULES, {}, EMPTY_FILTERS);
    expect(rows.map((r) => r.customer)).toEqual(['Alpha', 'Beta', 'Alt AG']);
    expect(rows[2].statusLabel).toBe('Historisch ausgezahlt');
    expect(rows[0].statusLabel).toBe('Offen');
    expect(rows[1].statusLabel).toBe('Erwartet');
  });

  it('Filter: Name, Stufe, Status, Zeitraum', () => {
    expect(buildDashboard(data, DEFAULT_RULES, {}, { ...EMPTY_FILTERS, search: 'alp' }).rows).toHaveLength(1);
    expect(buildDashboard(data, DEFAULT_RULES, {}, { ...EMPTY_FILTERS, tier: 'starter' }).rows[0].customer).toBe('Beta');
    expect(buildDashboard(data, DEFAULT_RULES, {}, { ...EMPTY_FILTERS, status: 'historical' }).rows).toHaveLength(1);
    expect(buildDashboard(data, DEFAULT_RULES, periodFor(2025, null), EMPTY_FILTERS).rows.map((r) => r.customer)).toEqual(['Alt AG']);
  });
});
