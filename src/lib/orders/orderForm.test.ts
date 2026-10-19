import { describe, expect, it } from 'vitest';
import { calculateCommission, buildSnapshot } from '../commission/calculate.ts';
import { DEFAULT_RULES } from '../commission/rules.ts';
import { buildOrderPayload, formFromOrder, newAddonRow, newAdjustmentRow, newOrderForm, parseOrderForm, todayIso } from './orderForm.ts';
import type { OrderFormState } from './orderForm.ts';

const base = (over: Partial<OrderFormState> = {}): OrderFormState => ({
  ...newOrderForm('pro', '2026-10-18'), customerName: 'Muster GmbH', netPrice: '20.000', ...over,
});

describe('Formular → Berechnungseingabe', () => {
  it('Datum ist lokal voreingestellt', () => {
    expect(todayIso(new Date(2026, 9, 18, 23, 59))).toBe('2026-10-18');
    expect(newOrderForm('med', '2026-10-18').contractDate).toBe('2026-10-18');
    expect(newOrderForm('med', '2026-10-18').expectedPayoutDate).toBe(''); // nicht mit Vertragsdatum vermischt
  });

  it('parst deutsche Eingaben exakt (20.000 € + 2.000,50 € Überverkauf)', () => {
    const p = parseOrderForm(base({ overprice: '2.000,50' }));
    expect(p.errors).toEqual({});
    expect(p.input?.netPriceCents).toBe(2_000_000);
    expect(p.input?.overpriceCents).toBe(200_050);
    expect(p.meta?.customerName).toBe('Muster GmbH');
  });

  it('Live-Berechnung ist auch bei fehlendem Namen möglich (nur Stammdaten fehlen)', () => {
    const p = parseOrderForm(base({ customerName: '' }));
    expect(p.input).not.toBeNull();
    expect(p.meta).toBeNull();
    expect(p.errors.customerName).toBeTruthy();
  });

  it('meldet ungültige Beträge und Daten feldgenau', () => {
    const p = parseOrderForm(base({ netPrice: 'abc', overprice: '-5', contractDate: '2026-02-30', confirmationDate: 'x' }));
    expect(Object.keys(p.errors).sort()).toEqual(['confirmationDate', 'contractDate', 'netPrice', 'overprice']);
    expect(p.input).toBeNull();
    expect(p.meta).toBeNull();
  });

  it('Eigenlead braucht ausdrückliche Bestätigung', () => {
    const p = parseOrderForm(base({ ownLead: true }));
    expect(p.errors.ownLeadConfirmed).toBeTruthy();
    expect(parseOrderForm(base({ ownLead: true, ownLeadConfirmed: true })).input?.ownLead).toBe(true);
  });

  it('PV + Wärmepumpe: Eigenlead-Art wird nur übernommen, wenn gewählt', () => {
    const f = base({ projectType: 'pv_heat_pump', ownLead: true, ownLeadConfirmed: true });
    const none = parseOrderForm(f).input!;
    expect(none.ownLeadKind).toBeUndefined();
    expect(calculateCommission(none, DEFAULT_RULES).ok).toBe(false); // Engine verlangt Auswahl
    const both = parseOrderForm({ ...f, ownLeadKind: 'both' }).input!;
    expect(calculateCommission(both, DEFAULT_RULES).ok).toBe(true);
  });

  it('Bei Wärmepumpe/sonstigem Auftrag werden versteckte PV-Felder ignoriert', () => {
    const p = parseOrderForm(base({ projectType: 'heat_pump', netPrice: '999', overprice: '5' }));
    expect(p.input?.netPriceCents).toBe(0);
    expect(p.input?.overpriceCents).toBe(0);
    const other = parseOrderForm(base({ projectType: 'other', ownLead: true, ownLeadConfirmed: false }));
    expect(other.input?.ownLead).toBe(false);
  });

  it('Zusatzprodukte und Anpassungen', () => {
    const a1 = { ...newAddonRow('ev_charger_a'), netValue: '1.000' };
    const a2 = { ...newAddonRow('custom'), label: 'Sonderprodukt', netValue: '500', rate: '5' };
    const a3 = { ...newAddonRow('maintenance_package'), quantity: '2' };
    const adj = { ...newAdjustmentRow(), label: 'Korrektur', amount: '-100' };
    const p = parseOrderForm(base({ addons: [a1, a2, a3], adjustments: [adj] }));
    expect(p.errors).toEqual({});
    const r = calculateCommission(p.input!, DEFAULT_RULES);
    expect(r.ok && r.result.totalCents).toBe(180_000 + 18_000 + 2_500 + 75_000 - 10_000);
  });

  it('Pflichtangaben bei Zusatzprodukten und Anpassungen', () => {
    const a = { ...newAddonRow('custom') };
    const adj = newAdjustmentRow();
    const p = parseOrderForm(base({ addons: [a], adjustments: [adj] }));
    expect(p.errors[`addons.${a.id}.label`]).toBeTruthy();
    expect(p.errors[`addons.${a.id}.netValue`]).toBeTruthy();
    expect(p.errors[`addons.${a.id}.rate`]).toBeTruthy();
    expect(p.errors[`adjustments.${adj.id}.label`]).toBeTruthy();
    expect(p.errors[`adjustments.${adj.id}.amount`]).toBeTruthy();
  });

  it('Zahlungsmodell: individuelle Schwelle ist Pflicht', () => {
    expect(parseOrderForm(base({ paymentModel: 'custom' })).errors.customThreshold).toBeTruthy();
    const p = parseOrderForm(base({ paymentModel: 'custom', customThreshold: '80', customerPaid: '82,5' }));
    expect(p.meta?.customThresholdBps).toBe(8000);
    expect(p.meta?.customerPaidBps).toBe(8250);
  });
});

describe('Speicher-Payload', () => {
  it('enthält Snapshot, Positionen und exakt die berechnete Provision', () => {
    const a1 = { ...newAddonRow('ev_charger_a'), netValue: '1.000' };
    const a3 = { ...newAddonRow('maintenance_package') };
    const p = parseOrderForm(base({ overprice: '2.000', addons: [a1, a3], siteManager: true }));
    const outcome = calculateCommission(p.input!, DEFAULT_RULES);
    if (!outcome.ok) throw new Error('unerwartet');
    const snap = buildSnapshot(p.input!, DEFAULT_RULES, outcome, new Date('2026-10-18T10:00:00Z'), 3);
    const payload = buildOrderPayload(p.meta!, p.input!, outcome.result, snap, 'rs-1');

    expect(payload.order.tier).toBe('pro');
    expect(payload.order.rule_set_id).toBe('rs-1');
    expect((payload.order.calculation as typeof snap).result.totalCents).toBe(outcome.result.totalCents);
    expect(payload.addons).toHaveLength(2);
    expect(payload.addons[0]).toMatchObject({ product_key: 'ev_charger_a', kind: 'percent', net_value_cents: 100_000, rate_bps: 1800, commission_cents: 18_000 });
    expect(payload.addons[1]).toMatchObject({ product_key: 'maintenance_package', kind: 'fixed', net_value_cents: null, commission_cents: 37_500 });
    // 1.800 + 1.180 + 180 + 375 − 295
    expect(outcome.result.totalCents).toBe(180_000 + 118_000 + 18_000 + 37_500 - 29_500);
  });
});

describe('Bearbeiten: gespeicherter Auftrag → Formular → identische Eingaben', () => {
  it('Hin- und Rückumwandlung verändert nichts', () => {
    const a1 = { ...newAddonRow('ev_charger_a'), netValue: '1.000' };
    const a2 = { ...newAddonRow('custom'), label: 'Sonderprodukt', netValue: '500', rate: '5,5' };
    const a3 = { ...newAddonRow('maintenance_package'), quantity: '2' };
    const adj = { ...newAdjustmentRow(), label: 'Korrektur', amount: '-100' };
    const original = parseOrderForm(base({
      overprice: '2.000,50', ownLead: true, ownLeadConfirmed: true, pvSecurePv: true, siteManager: true,
      addons: [a1, a2, a3], adjustments: [adj], paymentModel: 'custom', customThreshold: '80', customerPaid: '82,5',
      orderNumber: 'A-7', note: 'Notiz',
    }));
    expect(original.errors).toEqual({});
    const stored = {
      customer_name: original.meta!.customerName, project_type: original.meta!.projectType, contract_date: original.meta!.contractDate,
      tier: original.meta!.tier, order_number: original.meta!.orderNumber, confirmation_date: original.meta!.confirmationDate,
      expected_payout_date: original.meta!.expectedPayoutDate, note: original.meta!.note, payment_model: original.meta!.paymentModel,
      custom_threshold_bps: original.meta!.customThresholdBps, customer_paid_bps: original.meta!.customerPaidBps,
      status_override: null, status_override_reason: null,
    };
    const again = parseOrderForm(formFromOrder(stored, original.input!));
    expect(again.errors).toEqual({});
    expect(again.input).toEqual(original.input);
    expect(again.meta).toEqual(original.meta);
  });

  it('manuelle Statuskorrektur braucht eine Begründung', () => {
    expect(parseOrderForm(base({ statusOverride: 'open' })).errors.statusOverrideReason).toBeTruthy();
    const ok = parseOrderForm(base({ statusOverride: 'open', statusOverrideReason: ' Kulanz ' }));
    expect(ok.meta?.statusOverride).toBe('open');
    expect(ok.meta?.statusOverrideReason).toBe('Kulanz');
    expect(parseOrderForm(base()).meta?.statusOverrideReason).toBeNull();
  });
});
