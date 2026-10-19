import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../commission/rules.ts';
import type { DbOrderRow } from './dashboardModel.ts';
import { EMPTY_ORDER_FILTERS, buildOrdersList } from './ordersModel.ts';
import { describeAudit, formatAuditValue } from './auditFormat.ts';

const order = (over: Partial<DbOrderRow>): DbOrderRow => ({
  id: 'o1', customer_name: 'Muster GmbH', project_type: 'pv', contract_date: '2026-10-05', tier: 'pro',
  payment_model: 'regular', custom_threshold_bps: null, customer_paid_bps: 0, status_override: null,
  status_override_reason: null, commission_total_cents: 100_000, archived_at: null, order_number: 'A-100', ...over,
});

const data = {
  orders: [
    order({ id: 'a', customer_name: 'Alpha', customer_paid_bps: 9_500 }),
    order({ id: 'b', customer_name: 'Beta', tier: 'starter', project_type: 'heat_pump', contract_date: '2026-09-01', order_number: 'W-7' }),
    order({ id: 'c', customer_name: 'Gamma', archived_at: '2026-10-10T00:00:00Z', contract_date: '2026-08-01' }),
  ],
  payouts: [{ id: 'p1', order_id: 'a', paid_on: '2026-10-12', amount_cents: 40_000 }],
  attachments: [
    { id: 'x1', order_id: 'a', payout_id: null, historical_payout_id: null },
    { id: 'x2', order_id: null, payout_id: 'p1', historical_payout_id: null },
  ],
};

describe('Auftragsliste', () => {
  it('zeigt standardmäßig nur aktive Aufträge, neueste zuerst, mit Teilzahlung und Dokumenten', () => {
    const { rows, totals } = buildOrdersList(data, DEFAULT_RULES, EMPTY_ORDER_FILTERS);
    expect(rows.map((r) => r.customer)).toEqual(['Alpha', 'Beta']);
    expect(rows[0]).toMatchObject({ status: 'open', paidCents: 40_000, remainingCents: 60_000, partiallyPaid: true, docCount: 2 });
    expect(rows[1]).toMatchObject({ status: 'expected', remainingCents: 100_000, docCount: 0 });
    expect(totals).toEqual({ totalCents: 200_000, paidCents: 40_000, remainingCents: 160_000 });
  });

  it('Archiv-Filter', () => {
    expect(buildOrdersList(data, DEFAULT_RULES, { ...EMPTY_ORDER_FILTERS, archived: 'archived' }).rows.map((r) => r.customer)).toEqual(['Gamma']);
    expect(buildOrdersList(data, DEFAULT_RULES, { ...EMPTY_ORDER_FILTERS, archived: 'all' }).rows).toHaveLength(3);
  });

  it('Filter: Suche (Name und Auftragsnummer), Zeitraum, Projektart, Stufe, Status', () => {
    const f = (o: Partial<typeof EMPTY_ORDER_FILTERS>) => buildOrdersList(data, DEFAULT_RULES, { ...EMPTY_ORDER_FILTERS, ...o }).rows.map((r) => r.customer);
    expect(f({ search: 'alp' })).toEqual(['Alpha']);
    expect(f({ search: 'w-7' })).toEqual(['Beta']);
    expect(f({ from: '2026-10-01' })).toEqual(['Alpha']);
    expect(f({ to: '2026-09-30' })).toEqual(['Beta']);
    expect(f({ projectType: 'heat_pump' })).toEqual(['Beta']);
    expect(f({ tier: 'starter' })).toEqual(['Beta']);
    expect(f({ status: 'open' })).toEqual(['Alpha']);
  });

  it('manuelle Statuskorrektur wirkt in der Liste', () => {
    const d = { ...data, orders: [order({ id: 'z', status_override: 'paid', status_override_reason: 'Bar erledigt' })] };
    const { rows } = buildOrdersList(d, DEFAULT_RULES, EMPTY_ORDER_FILTERS);
    expect(rows[0]).toMatchObject({ status: 'paid', remainingCents: 0 });
  });
});

describe('Änderungsprotokoll', () => {
  it('formatiert Werte deutsch', () => {
    expect(formatAuditValue('commission_total_cents', 123_450).replace(/\s/g, ' ')).toBe('1.234,50 €');
    expect(formatAuditValue('customer_paid_bps', 9_500).replace(/\s/g, ' ')).toBe('95 %');
    expect(formatAuditValue('contract_date', '2026-10-05')).toBe('05.10.2026');
    expect(formatAuditValue('tier', 'pro')).toBe('Pro');
    expect(formatAuditValue('note', null)).toBe('–');
  });

  it('beschreibt Statusänderung, Archivierung, Auszahlung und Dokumente verständlich', () => {
    const upd = describeAudit({ id: 1, entity_table: 'orders', entity_id: 'x', action: 'update', created_at: '', changes: { customer_paid_bps: { old: 5_000, new: 9_500 }, commission_total_cents: { old: 100, new: 200 } } });
    expect(upd.title).toBe('Auftrag geändert');
    expect(upd.details[0]).toContain('Zahlungsfortschritt des Kunden');
    expect(upd.details[0]).toContain('→');
    expect(describeAudit({ id: 2, entity_table: 'orders', entity_id: 'x', action: 'update', created_at: '', changes: { archived_at: { old: null, new: '2026-10-19T10:00:00Z' } } }).title).toBe('Auftrag archiviert');
    expect(describeAudit({ id: 3, entity_table: 'orders', entity_id: 'x', action: 'update', created_at: '', changes: { archived_at: { old: '2026-10-19', new: null } } }).title).toBe('Auftrag wiederhergestellt');
    const pay = describeAudit({ id: 4, entity_table: 'payouts', entity_id: 'p', action: 'insert', created_at: '', changes: { amount_cents: { old: null, new: 40_000 }, paid_on: { old: null, new: '2026-10-12' } } });
    expect(pay.title.replace(/\s/g, ' ')).toBe('Auszahlung erfasst: 400,00 € am 12.10.2026');
    const del = describeAudit({ id: 5, entity_table: 'attachments', entity_id: 'a', action: 'delete', created_at: '', changes: { file_name: { old: 'Angebot.pdf', new: null } } });
    expect(del.title).toBe('Dokument entfernt: Angebot.pdf');
  });
});
