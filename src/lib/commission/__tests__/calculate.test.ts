import { describe, expect, it } from 'vitest';
import { buildSnapshot, calculateCommission } from '../calculate.ts';
import { DEFAULT_RULES } from '../rules.ts';
import { formatEuro, formatPercent, parseEuroToCents, parsePercentToBps, percentOf, roundDiv } from '../money.ts';
import { EUR, calc, line, makeInput } from './helpers.ts';

describe('Grundprovision (Tests 1–4)', () => {
  it.each([
    ['starter', 7, 140_000],
    ['med', 8, 160_000],
    ['pro', 9, 180_000],
    ['expert', 10, 200_000],
  ] as const)('%s: %s %% auf 20.000 € netto', (tier, pct, cents) => {
    const r = calc({ tier });
    expect(line(r, 'base')?.rateBps).toBe(pct * 100);
    expect(line(r, 'base')?.amountCents).toBe(cents);
    expect(r.totalCents).toBe(cents);
  });
});

describe('Überverkauf (Tests 5–6)', () => {
  it.each([
    ['starter', 114_000],
    ['med', 116_000],
    ['pro', 118_000],
    ['expert', 120_000],
  ] as const)('Anteil für %s auf 2.000 € Überverkauf', (tier, share) => {
    const r = calc({ tier, overpriceCents: EUR(2000) });
    expect(r.overprice?.overpricePercentBps).toBe(1000); // 10 % des Netto-Preises ohne Überverkauf
    expect(line(r, 'overprice_share')?.amountCents).toBe(share);
  });

  it('Beispiel aus dem Auftrag: 20.000 € netto, 2.000 € Überverkauf, Pro', () => {
    const r = calc({ tier: 'pro', overpriceCents: EUR(2000) });
    expect(line(r, 'base')?.amountCents).toBe(EUR(1800));
    expect(line(r, 'overprice_share')?.amountCents).toBe(EUR(1180));
    expect(r.totalCents).toBe(EUR(2980));
  });

  it('genau am Grenzwert (12,5 %) wird nicht begrenzt', () => {
    const r = calc({ overpriceCents: EUR(2500) });
    expect(r.overprice?.capped).toBe(false);
    expect(r.overprice?.excessCents).toBe(0);
    expect(r.warnings.some((w) => w.code === 'OVERPRICE_CAPPED')).toBe(false);
  });

  it('über dem Grenzwert: Anteil begrenzt, Rest separat ausgewiesen, Warnung', () => {
    const r = calc({ tier: 'pro', overpriceCents: EUR(3500) });
    expect(r.overprice?.capCents).toBe(EUR(2500));
    expect(r.overprice?.creditableCents).toBe(EUR(2500));
    expect(r.overprice?.excessCents).toBe(EUR(1000));
    expect(line(r, 'overprice_share')?.amountCents).toBe(EUR(1475)); // 59 % von 2.500 €
    expect(r.totalCents).toBe(EUR(1800) + EUR(1475));
    expect(r.warnings.find((w) => w.code === 'OVERPRICE_CAPPED')?.severity).toBe('warning');
  });

  it('Grenzwert ist in den Regeln änderbar', () => {
    const rules = { ...DEFAULT_RULES, overpriceCapBps: 1000 };
    const r = calc({ overpriceCents: EUR(2500) }, rules);
    expect(r.overprice?.creditableCents).toBe(EUR(2000));
    expect(r.overprice?.excessCents).toBe(EUR(500));
  });

  it('Überverkauf bei Wärmepumpe wird nicht angesetzt', () => {
    const r = calc({ projectType: 'heat_pump', netPriceCents: 0, overpriceCents: EUR(1000) });
    expect(r.overprice).toBeNull();
    expect(line(r, 'overprice_share')).toBeUndefined();
    expect(r.warnings.some((w) => w.code === 'OVERPRICE_NOT_APPLICABLE')).toBe(true);
  });
});

describe('Eigenlead (Tests 7–8)', () => {
  it('Eigenlead PV addiert 1.500 €', () => {
    const r = calc({ ownLead: true });
    expect(line(r, 'own_lead_pv')?.amountCents).toBe(EUR(1500));
    expect(r.totalCents).toBe(EUR(1800) + EUR(1500));
  });

  it('Eigenlead Wärmepumpe addiert 1.000 €', () => {
    const r = calc({ projectType: 'heat_pump', netPriceCents: 0, ownLead: true });
    expect(line(r, 'own_lead_hp')?.amountCents).toBe(EUR(1000));
    expect(r.totalCents).toBe(EUR(1000));
  });

  it('ohne Eigenlead wird nie ein Zusatz angesetzt – auch nicht bei übergebener Art', () => {
    const r = calc({ ownLead: false, ownLeadKind: 'both', projectType: 'pv_heat_pump' });
    expect(r.lines.some((l) => l.group === 'own_lead')).toBe(false);
  });

  it('PV + Wärmepumpe: ohne ausdrückliche Auswahl wird nicht still entschieden', () => {
    const o = calculateCommission(makeInput({ projectType: 'pv_heat_pump', ownLead: true }), DEFAULT_RULES);
    expect(o.ok).toBe(false);
    if (!o.ok) expect(o.errors[0].code).toBe('OWN_LEAD_KIND_REQUIRED');
  });

  it('PV + Wärmepumpe: beide Zusätze nur bei bewusster Wahl, getrennt ausgewiesen', () => {
    const r = calc({ projectType: 'pv_heat_pump', ownLead: true, ownLeadKind: 'both' });
    expect(line(r, 'own_lead_pv')?.amountCents).toBe(EUR(1500));
    expect(line(r, 'own_lead_hp')?.amountCents).toBe(EUR(1000));
    expect(r.warnings.some((w) => w.code === 'OWN_LEAD_BOTH')).toBe(true);
  });

  it('Eigenlead-Art muss zur Projektart passen', () => {
    const o = calculateCommission(makeInput({ projectType: 'pv', ownLead: true, ownLeadKind: 'heat_pump' }), DEFAULT_RULES);
    expect(o.ok).toBe(false);
  });

  it('Eigenlead zeigt stets den Hinweis zu Energieversum-Leads', () => {
    expect(calc({ ownLead: true }).warnings.some((w) => w.code === 'OWN_LEAD_CHECK')).toBe(true);
  });
});

describe('PV Secure, Bauleiter, Festbeträge (Tests 9–11)', () => {
  it('PV Secure Photovoltaik / Premium Plus: +225 €', () => {
    const r = calc({ pvSecurePv: true });
    expect(line(r, 'pv_secure_pv')?.amountCents).toBe(EUR(225));
  });

  it('PV Secure Wärmepumpe: +275 €', () => {
    const r = calc({ projectType: 'heat_pump', netPriceCents: 0, pvSecureHeatPump: true });
    expect(line(r, 'pv_secure_hp')?.amountCents).toBe(EUR(275));
  });

  it('Bauleiter zieht 295 € ab (Beispiel 3.000 € → 2.705 €), als eigene Position', () => {
    const r = calc({
      projectType: 'other',
      netPriceCents: 0,
      addons: [{ key: 'custom', label: 'Sonderprodukt', netValueCents: EUR(30_000), rateBps: 1000 }],
      siteManager: true,
    });
    expect(r.lines.reduce((s, l) => s + (l.group === 'deduction' ? 0 : l.amountCents), 0)).toBe(EUR(3000));
    expect(line(r, 'site_manager')?.amountCents).toBe(-EUR(295));
    expect(r.totalCents).toBe(EUR(2705));
  });

  it('ohne Bauleiter kein Abzug', () => {
    expect(line(calc({ siteManager: false }), 'site_manager')).toBeUndefined();
  });

  it('Wartungspaket ist ein Festbetrag von 375 €, unabhängig von der Stufe', () => {
    for (const tier of ['starter', 'expert'] as const) {
      const r = calc({ tier, projectType: 'other', netPriceCents: 0, addons: [{ key: 'maintenance_package' }] });
      expect(r.totalCents).toBe(EUR(375));
    }
  });

  it('Beträge in den Regeln sind änderbar und wirken in der Berechnung', () => {
    const rules = { ...DEFAULT_RULES, siteManagerDeductionCents: EUR(300) };
    expect(line(calc({ siteManager: true }, rules), 'site_manager')?.amountCents).toBe(-EUR(300));
  });
});

describe('Zusatzprodukte (Test 12)', () => {
  it('Provision nur auf den jeweiligen Nettowert, nicht auf den Gesamtpreis', () => {
    const r = calc({ addons: [{ key: 'ev_charger_a', netValueCents: EUR(1000) }] });
    expect(line(r, 'addon_0')?.basisCents).toBe(EUR(1000));
    expect(line(r, 'addon_0')?.amountCents).toBe(EUR(180)); // 18 % (Pro) von 1.000 €
    expect(r.totalCents).toBe(EUR(1800) + EUR(180));
  });

  it('Satz folgt der Auftragsstufe', () => {
    const starter = calc({ tier: 'starter', addons: [{ key: 'ev_charger_a', netValueCents: EUR(1000) }] });
    const expert = calc({ tier: 'expert', addons: [{ key: 'ev_charger_a', netValueCents: EUR(1000) }] });
    expect(line(starter, 'addon_0')?.amountCents).toBe(EUR(140));
    expect(line(expert, 'addon_0')?.amountCents).toBe(EUR(200));
  });

  it('mehrere Produkte, benutzerdefiniertes Produkt, Anpassungen getrennt', () => {
    const r = calc({
      addons: [
        { key: 'extended_warranty', netValueCents: EUR(5000) },
        { key: 'custom', label: 'Sonderprodukt', netValueCents: EUR(1000), rateBps: 500 },
      ],
      adjustments: [{ label: 'Korrektur Vorauszahlung', amountCents: -EUR(100) }],
    });
    expect(line(r, 'addon_0')?.amountCents).toBe(EUR(450));
    expect(line(r, 'addon_1')?.amountCents).toBe(EUR(50));
    expect(line(r, 'adjustment_0')?.amountCents).toBe(-EUR(100));
    expect(r.totalCents).toBe(EUR(1800) + EUR(450) + EUR(50) - EUR(100));
  });
});

describe('Rundung & Validierung', () => {
  it('rundet kaufmännisch auf ganze Cent, ohne Fließkommafehler', () => {
    expect(percentOf(125, 1000)).toBe(13); // 12,5 -> 13
    expect(roundDiv(-125_000, 10_000)).toBe(-13);
    expect(percentOf(33_333, 700)).toBe(2333);
    expect(percentOf(10_050, 1000)).toBe(1005);
  });

  it('lehnt negative, nicht ganzzahlige und überlange Beträge ab', () => {
    for (const bad of [-1, 100.5, Number.NaN, 1e12]) {
      const o = calculateCommission(makeInput({ netPriceCents: bad }), DEFAULT_RULES);
      expect(o.ok).toBe(false);
    }
    expect(calculateCommission(makeInput({ overpriceCents: -5 }), DEFAULT_RULES).ok).toBe(false);
  });

  it('verlangt bei PV einen Netto-Anlagenpreis > 0', () => {
    const o = calculateCommission(makeInput({ netPriceCents: 0 }), DEFAULT_RULES);
    expect(o.ok && 'x').toBe(false);
    if (!o.ok) expect(o.errors[0].code).toBe('NET_PRICE_REQUIRED');
  });

  it('lehnt unbekannte Stufe, fehlende Bezeichnungen und ungültige Sätze ab', () => {
    // @ts-expect-error absichtlich ungültig
    expect(calculateCommission(makeInput({ tier: 'gold' }), DEFAULT_RULES).ok).toBe(false);
    expect(calculateCommission(makeInput({ addons: [{ key: 'custom', label: ' ', netValueCents: 100, rateBps: 100 }] }), DEFAULT_RULES).ok).toBe(false);
    expect(calculateCommission(makeInput({ addons: [{ key: 'custom', label: 'x', netValueCents: 100, rateBps: 10_001 }] }), DEFAULT_RULES).ok).toBe(false);
    expect(calculateCommission(makeInput({ adjustments: [{ label: '', amountCents: 100 }] }), DEFAULT_RULES).ok).toBe(false);
  });

  it('warnt bei negativer Gesamtprovision', () => {
    const r = calc({ projectType: 'other', netPriceCents: 0, siteManager: true });
    expect(r.totalCents).toBe(-EUR(295));
    expect(r.warnings.some((w) => w.code === 'NEGATIVE_TOTAL')).toBe(true);
  });

  it('Vorschau und Speichern liefern dasselbe Ergebnis (reine Funktion)', () => {
    const input = makeInput({ overpriceCents: EUR(2000), ownLead: true, siteManager: true });
    const a = calculateCommission(input, DEFAULT_RULES);
    const b = calculateCommission(input, DEFAULT_RULES);
    expect(a).toEqual(b);
  });
});

describe('Parsen & Formatieren (deutsches Format)', () => {
  it('parst deutsche Beträge exakt', () => {
    expect(parseEuroToCents('20.000,50')).toBe(2_000_050);
    expect(parseEuroToCents('20000')).toBe(2_000_000);
    expect(parseEuroToCents('295,5')).toBe(29_550);
    expect(parseEuroToCents('-295,00 €')).toBe(-29_500);
    for (const bad of ['', 'abc', '1.00', '1,234', '1,2,3', '1e5']) expect(parseEuroToCents(bad)).toBeNull();
  });

  it('parst Prozentwerte als Basispunkte', () => {
    expect(parsePercentToBps('12,5')).toBe(1250);
    expect(parsePercentToBps('7 %')).toBe(700);
    expect(parsePercentToBps('101')).toBeNull();
    expect(parsePercentToBps('-1')).toBeNull();
  });

  it('formatiert Euro und Prozent auf Deutsch', () => {
    expect(formatEuro(2_000_050).replace(/\s/g, ' ')).toBe('20.000,50 €');
    expect(formatPercent(1250).replace(/\s/g, ' ')).toBe('12,5 %');
  });
});

describe('Gespeicherte Berechnung bleibt unverändert (Test 18)', () => {
  it('Snapshot friert Eingaben und Regeln ein; spätere Änderungen wirken nicht zurück', () => {
    const rules = structuredClone(DEFAULT_RULES);
    const input = makeInput({ tier: 'pro', overpriceCents: EUR(2000) });
    const outcome = calculateCommission(input, rules);
    if (!outcome.ok) throw new Error('unerwartet');
    const snapshot = buildSnapshot(input, rules, outcome, new Date('2026-10-18T10:00:00Z'), 1);
    const frozenTotal = snapshot.result.totalCents;

    // Aktuelle Stufe und Regeln ändern sich später:
    input.tier = 'expert';
    rules.baseRateBps.pro = 5000;
    rules.siteManagerDeductionCents = 1;

    expect(snapshot.input.tier).toBe('pro');
    expect(snapshot.rules.baseRateBps.pro).toBe(900);
    expect(snapshot.result.totalCents).toBe(frozenTotal);
    expect(snapshot.ruleSetVersion).toBe(1);
    expect(snapshot.calculatedAt).toBe('2026-10-18T10:00:00.000Z');

    // Neue Berechnung mit neuer Stufe ergibt ein anderes Ergebnis, ändert den Snapshot aber nicht
    const fresh = calc({ tier: 'expert', overpriceCents: EUR(2000) });
    expect(fresh.totalCents).not.toBe(frozenTotal);
    expect(snapshot.result.totalCents).toBe(frozenTotal);
  });
});
