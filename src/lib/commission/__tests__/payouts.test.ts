import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../rules.ts';
import { computeOrderState } from '../status.ts';
import type { OrderForStatus } from '../status.ts';
import { summarize } from '../summary.ts';
import type { SummaryOrder } from '../summary.ts';
import { buildJsonBackup, centsToDecimal, csvText, ordersToCsv, payoutsToCsv } from '../csv.ts';
import type { ExportOrder } from '../csv.ts';
import { EUR } from './helpers.ts';

const order = (over: Partial<OrderForStatus> = {}): OrderForStatus => ({
  commissionTotalCents: EUR(1000),
  paymentModel: 'regular',
  customerPaidBps: 0,
  payouts: [],
  ...over,
});

const sOrder = (id: string, over: Partial<SummaryOrder> = {}): SummaryOrder => ({
  id,
  contractDate: '2026-10-01',
  archived: false,
  ...order(),
  ...over,
});

describe('Erwartet vs. offen (Test 13)', () => {
  it('regulär: Schwelle 95 %', () => {
    expect(computeOrderState(order({ customerPaidBps: 9_400 }), DEFAULT_RULES).status).toBe('expected');
    expect(computeOrderState(order({ customerPaidBps: 9_500 }), DEFAULT_RULES).status).toBe('open');
  });
  it('Vorkasse: Schwelle 100 %', () => {
    const o = order({ paymentModel: 'prepayment' });
    expect(computeOrderState({ ...o, customerPaidBps: 9_900 }, DEFAULT_RULES).status).toBe('expected');
    expect(computeOrderState({ ...o, customerPaidBps: 10_000 }, DEFAULT_RULES).status).toBe('open');
  });
  it('individuelle Schwelle', () => {
    const o = order({ paymentModel: 'custom', customThresholdBps: 5_000 });
    expect(computeOrderState({ ...o, customerPaidBps: 4_999 }, DEFAULT_RULES).status).toBe('expected');
    expect(computeOrderState({ ...o, customerPaidBps: 5_000 }, DEFAULT_RULES).status).toBe('open');
    expect(() => computeOrderState(order({ paymentModel: 'custom' }), DEFAULT_RULES)).toThrow();
  });
  it('Schwellen sind in den Regeln änderbar', () => {
    const rules = { payoutThresholds: { regularBps: 9_000, prepaymentBps: 10_000 } };
    expect(computeOrderState(order({ customerPaidBps: 9_000 }), rules).status).toBe('open');
  });
  it('lehnt ungültigen Zahlungsfortschritt ab', () => {
    expect(() => computeOrderState(order({ customerPaidBps: 10_001 }), DEFAULT_RULES)).toThrow();
    expect(() => computeOrderState(order({ customerPaidBps: -1 }), DEFAULT_RULES)).toThrow();
  });
  it('Dashboard trennt erwartet und offen', () => {
    const s = summarize(
      [sOrder('a', { customerPaidBps: 9_500 }), sOrder('b', { customerPaidBps: 1_000, commissionTotalCents: EUR(500) })],
      [],
      DEFAULT_RULES,
    );
    expect(s.openCents).toBe(EUR(1000));
    expect(s.expectedCents).toBe(EUR(500));
  });
});

describe('Auszahlungen (Tests 14–15)', () => {
  it('ausgezahlte Provision verschwindet aus der offenen Summe', () => {
    const paid = sOrder('a', { customerPaidBps: 10_000, payouts: [{ amountCents: EUR(1000), paidOn: '2026-10-10' }] });
    const state = computeOrderState(paid, DEFAULT_RULES);
    expect(state.status).toBe('paid');
    expect(state.remainingCents).toBe(0);
    const s = summarize([paid], [], DEFAULT_RULES);
    expect(s.openCents).toBe(0);
    expect(s.expectedCents).toBe(0);
    expect(s.paidCents).toBe(EUR(1000));
  });

  it('Teilzahlung: Gesamt, ausgezahlt und Rest getrennt, nichts doppelt', () => {
    const o = sOrder('a', { customerPaidBps: 10_000, payouts: [{ amountCents: EUR(400), paidOn: '2026-10-10' }] });
    const state = computeOrderState(o, DEFAULT_RULES);
    expect(state).toMatchObject({ totalCents: EUR(1000), paidCents: EUR(400), remainingCents: EUR(600), partiallyPaid: true, status: 'open' });
    const s = summarize([o], [], DEFAULT_RULES);
    expect(s.openCents).toBe(EUR(600));
    expect(s.paidCents).toBe(EUR(400));
    expect(s.totalVolumeCents).toBe(EUR(1000)); // nicht 1.400 €
  });

  it('mehrere Teilzahlungen bis zum vollen Betrag', () => {
    const o = order({
      customerPaidBps: 10_000,
      payouts: [{ amountCents: EUR(400), paidOn: '2026-10-10' }, { amountCents: EUR(600), paidOn: '2026-11-10' }],
    });
    expect(computeOrderState(o, DEFAULT_RULES)).toMatchObject({ status: 'paid', remainingCents: 0, partiallyPaid: false });
  });

  it('Überzahlung wird getrennt ausgewiesen, Rest nie negativ', () => {
    const o = order({ customerPaidBps: 10_000, payouts: [{ amountCents: EUR(1200), paidOn: '2026-10-10' }] });
    expect(computeOrderState(o, DEFAULT_RULES)).toMatchObject({ remainingCents: 0, overpaidCents: EUR(200), status: 'paid' });
  });

  it('noch nicht berechtigter Restbetrag bleibt "erwartet"', () => {
    const o = order({ customerPaidBps: 5_000, payouts: [{ amountCents: EUR(100), paidOn: '2026-10-10' }] });
    expect(computeOrderState(o, DEFAULT_RULES)).toMatchObject({ status: 'expected', remainingCents: EUR(900) });
  });

  it('manuelle Korrektur nur mit Begründung', () => {
    const withReason = order({ statusOverride: { status: 'open', reason: 'Kulanz vereinbart' } });
    const noReason = order({ statusOverride: { status: 'open', reason: '  ' } });
    expect(computeOrderState(withReason, DEFAULT_RULES)).toMatchObject({ status: 'open', overrideApplied: true });
    expect(computeOrderState(noReason, DEFAULT_RULES)).toMatchObject({ status: 'expected', overrideApplied: false });
  });

  it('archivierte Aufträge zählen nicht in Erwartet/Offen/Anzahl, echte Auszahlungen aber weiter', () => {
    const arch = sOrder('a', { archived: true, customerPaidBps: 10_000, payouts: [{ amountCents: EUR(300), paidOn: '2026-10-10' }] });
    const s = summarize([arch], [], DEFAULT_RULES);
    expect(s).toMatchObject({ orderCount: 0, openCents: 0, expectedCents: 0, paidCents: EUR(300) });
  });

  it('Zeitraumfilter: Vertragsdatum für Erwartet/Offen, Auszahlungsdatum für Ausgezahlt', () => {
    const a = sOrder('a', { contractDate: '2026-09-15', customerPaidBps: 9_500 });
    const b = sOrder('b', { contractDate: '2026-10-15', customerPaidBps: 9_500, payouts: [{ amountCents: EUR(100), paidOn: '2026-10-20' }] });
    const s = summarize([a, b], [], DEFAULT_RULES, { from: '2026-10-01', to: '2026-10-31' });
    expect(s.orderCount).toBe(1);
    expect(s.openCents).toBe(EUR(900));
    expect(s.paidCents).toBe(EUR(100));
  });
});

describe('Historische Auszahlungen (Tests 16–17)', () => {
  const hist = [
    { id: 'h1', paidOn: '2025-03-12', amountCents: 123_456 },
    { id: 'h2', paidOn: '2025-04-01', amountCents: 99 },
  ];

  it('zählt exakt den manuell eingegebenen Betrag zu "Ausgezahlt", nie zu Erwartet/Offen', () => {
    const s = summarize([], hist, DEFAULT_RULES);
    expect(s.historicalPaidCents).toBe(123_555);
    expect(s.paidCents).toBe(123_555);
    expect(s.expectedCents).toBe(0);
    expect(s.openCents).toBe(0);
    expect(s.historicalCount).toBe(2);
    expect(s.orderCount).toBe(0);
  });

  it('wird durch Regeländerungen nicht beeinflusst', () => {
    const changed = { payoutThresholds: { regularBps: 1, prepaymentBps: 1 } };
    expect(summarize([], hist, changed).historicalPaidCents).toBe(summarize([], hist, DEFAULT_RULES).historicalPaidCents);
  });

  it('kombiniert mit Aufträgen ohne Doppelzählung', () => {
    const o = sOrder('a', { customerPaidBps: 10_000, payouts: [{ amountCents: EUR(1000), paidOn: '2026-10-10' }] });
    const s = summarize([o], hist, DEFAULT_RULES);
    expect(s.paidCents).toBe(EUR(1000) + 123_555);
    expect(s.totalVolumeCents).toBe(s.paidCents);
  });

  it('Zeitraumfilter gilt auch für historische Auszahlungen', () => {
    expect(summarize([], hist, DEFAULT_RULES, { from: '2025-04-01' }).historicalPaidCents).toBe(99);
  });
});

describe('Exporte (Test 22)', () => {
  const orders: ExportOrder[] = [
    { id: 'o1', customerName: 'Muster; "Test"', projectType: 'pv', contractDate: '2026-10-05', tier: 'pro', orderNumber: 'A-1', archived: false,
      ...order({ commissionTotalCents: EUR(1000), customerPaidBps: 9_500, payouts: [{ amountCents: EUR(400), paidOn: '2026-10-10' }] }) },
    { id: 'o2', customerName: '=HYPERLINK("http://evil")', projectType: 'heat_pump', contractDate: '2026-08-01', tier: 'med', archived: true,
      ...order({ commissionTotalCents: EUR(250.5) }) },
  ];

  it('formatiert Beträge exakt', () => {
    expect(centsToDecimal(123_450)).toBe('1234,50');
    expect(centsToDecimal(5)).toBe('0,05');
    expect(centsToDecimal(-29_500)).toBe('-295,00');
  });

  it('Auftrags-CSV: Kopfzeile, Werte, Filter nach Zeitraum', () => {
    const csv = ordersToCsv(orders, DEFAULT_RULES);
    const rows = csv.replace('\uFEFF', '').trim().split('\r\n');
    expect(rows).toHaveLength(3);
    expect(rows[0].startsWith('ID;Kunde;Projektart')).toBe(true);
    expect(rows[1]).toContain('"Muster; ""Test"""');
    expect(rows[1]).toContain('05.10.2026');
    expect(rows[1]).toContain('1000,00;400,00;600,00;Offen;95,00;Nein');
    const filtered = ordersToCsv(orders, DEFAULT_RULES, { from: '2026-10-01', to: '2026-10-31' });
    expect(filtered.trim().split('\r\n')).toHaveLength(2);
  });

  it('schützt vor CSV-Formel-Injection', () => {
    expect(csvText('=1+1')).toBe("'=1+1");
    expect(csvText('+49 123')).toBe("'+49 123");
    expect(ordersToCsv(orders, DEFAULT_RULES)).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });

  it('Auszahlungs-CSV enthält Auszahlungen und historische getrennt gekennzeichnet', () => {
    const csv = payoutsToCsv(
      [{ id: 'p1', orderId: 'o1', customerName: 'Muster', paidOn: '2026-10-10', amountCents: EUR(400) }],
      [{ id: 'h1', customerName: 'Alt GmbH', paidOn: '2025-03-12', amountCents: 123_456, projectType: 'pv', formerTier: 'Gold', formerModel: 'Modell 2024' }],
    );
    const rows = csv.replace('\uFEFF', '').trim().split('\r\n');
    expect(rows).toHaveLength(3);
    expect(rows[1].startsWith('Auszahlung;p1;o1;Muster;10.10.2026;400,00')).toBe(true);
    expect(rows[2].startsWith('Historische Auszahlung;h1;;Alt GmbH;12.03.2025;1234,56;Photovoltaik;Gold;Modell 2024')).toBe(true);
    const onlyHist = payoutsToCsv([], [{ id: 'h1', customerName: 'A', paidOn: '2025-03-12', amountCents: 1 }], undefined, ['historical']);
    expect(onlyHist.trim().split('\r\n')).toHaveLength(2);
    const ranged = payoutsToCsv(
      [{ id: 'p1', orderId: 'o1', customerName: 'M', paidOn: '2026-10-10', amountCents: 1 }],
      [{ id: 'h1', customerName: 'A', paidOn: '2025-03-12', amountCents: 1 }],
      { from: '2026-01-01' },
    );
    expect(ranged.trim().split('\r\n')).toHaveLength(2);
  });

  it('JSON-Backup: verlustfrei, Beträge als Cent', () => {
    const json = buildJsonBackup({ orders: [{ id: 'o1', commissionTotalCents: 123_456 }], historical_payouts: [] }, new Date('2026-10-18T00:00:00Z'));
    const parsed = JSON.parse(json);
    expect(parsed.format).toBe('provisionsmanager-backup');
    expect(parsed.amountsUnit).toBe('cents');
    expect(parsed.exportedAt).toBe('2026-10-18T00:00:00.000Z');
    expect(parsed.data.orders[0].commissionTotalCents).toBe(123_456);
  });
});
