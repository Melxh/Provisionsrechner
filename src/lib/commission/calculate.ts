import type {
  CalculationError,
  CalculationInput,
  CalculationLine,
  CalculationOutcome,
  CalculationSnapshot,
  CalculationWarning,
  OverpriceBreakdown,
  OwnLeadKind,
  RuleSet,
} from './types.ts';
import { PERCENT_ADDON_KEYS, PROJECT_TYPES, TIERS } from './types.ts';
import { isBps, isCents, percentOf, roundDiv, sumCents } from './money.ts';
import { addonLabel } from './labels.ts';
import { validateRuleSet } from './rules.ts';

const MAX_QUANTITY = 1000;

function validate(input: CalculationInput, rules: RuleSet): CalculationError[] {
  const errors: CalculationError[] = [];
  const add = (code: CalculationError['code'], field: string, message: string) =>
    errors.push({ code, field, message });

  const ruleErrors = validateRuleSet(rules);
  if (ruleErrors.length) add('INVALID_RULES', 'rules', `Ungültige Provisionsregeln: ${ruleErrors.join('; ')}`);

  if (!TIERS.includes(input.tier)) add('INVALID_TIER', 'tier', 'Bitte eine gültige Provisionsstufe wählen.');
  if (!PROJECT_TYPES.includes(input.projectType)) add('INVALID_PROJECT_TYPE', 'projectType', 'Bitte eine gültige Projektart wählen.');

  if (!isCents(input.netPriceCents)) add('INVALID_AMOUNT', 'netPriceCents', 'Der Netto-Anlagenpreis muss ein gültiger Betrag ≥ 0 € sein.');
  if (!isCents(input.overpriceCents)) add('INVALID_AMOUNT', 'overpriceCents', 'Der Überverkauf muss ein gültiger Betrag ≥ 0 € sein.');

  const includesPv = input.projectType === 'pv' || input.projectType === 'pv_heat_pump';
  const includesHp = input.projectType === 'heat_pump' || input.projectType === 'pv_heat_pump';

  if (includesPv && isCents(input.netPriceCents) && input.netPriceCents === 0) {
    add('NET_PRICE_REQUIRED', 'netPriceCents', 'Für Photovoltaikprojekte wird ein Netto-Anlagenpreis größer 0 € benötigt.');
  }

  if (input.ownLead) {
    const kind = resolveOwnLeadKind(input);
    if (!kind) {
      add('OWN_LEAD_KIND_REQUIRED', 'ownLeadKind', 'Bitte ausdrücklich wählen, welcher Eigenlead-Zusatz angesetzt wird (PV, Wärmepumpe oder beide).');
    } else if (
      ((kind === 'pv' || kind === 'both') && !includesPv) ||
      ((kind === 'heat_pump' || kind === 'both') && !includesHp)
    ) {
      add('OWN_LEAD_KIND_MISMATCH', 'ownLeadKind', 'Die gewählte Eigenlead-Art passt nicht zur Projektart.');
    }
  }

  input.addons.forEach((a, i) => {
    const f = `addons[${i}]`;
    if (a.key === 'custom') {
      if (!a.label?.trim()) add('INVALID_ADDON', `${f}.label`, 'Benutzerdefinierte Zusatzprodukte brauchen eine Bezeichnung.');
      if (!isCents(a.netValueCents)) add('INVALID_ADDON', `${f}.netValueCents`, 'Nettowert muss ein gültiger Betrag ≥ 0 € sein.');
      if (!isBps(a.rateBps)) add('INVALID_ADDON', `${f}.rateBps`, 'Provisionssatz muss zwischen 0 % und 100 % liegen.');
    } else if (a.key === 'maintenance_package') {
      const q = a.quantity ?? 1;
      if (!Number.isInteger(q) || q < 1 || q > MAX_QUANTITY) add('INVALID_ADDON', `${f}.quantity`, 'Anzahl muss eine ganze Zahl ≥ 1 sein.');
    } else if ((PERCENT_ADDON_KEYS as readonly string[]).includes(a.key)) {
      if (!isCents(a.netValueCents)) add('INVALID_ADDON', `${f}.netValueCents`, 'Nettowert muss ein gültiger Betrag ≥ 0 € sein.');
    } else {
      add('INVALID_ADDON', `${f}.key`, 'Unbekanntes Zusatzprodukt.');
    }
  });

  input.adjustments.forEach((a, i) => {
    if (!a.label?.trim()) add('INVALID_ADJUSTMENT', `adjustments[${i}].label`, 'Jede Anpassung braucht eine Begründung/Bezeichnung.');
    if (!isCents(a.amountCents, { allowNegative: true })) add('INVALID_ADJUSTMENT', `adjustments[${i}].amountCents`, 'Ungültiger Anpassungsbetrag.');
  });

  return errors;
}

/** Bei reinem PV- bzw. WP-Projekt ist die Art eindeutig; bei PV+WP muss sie explizit gewählt werden. */
function resolveOwnLeadKind(input: CalculationInput): OwnLeadKind | null {
  if (input.ownLeadKind) return input.ownLeadKind;
  if (input.projectType === 'pv') return 'pv';
  if (input.projectType === 'heat_pump') return 'heat_pump';
  return null;
}

/**
 * Zentrale Berechnung – wird von Vorschau UND Speichern verwendet.
 * Reine Funktion: gleiche Eingabe + gleiche Regeln = gleiches Ergebnis.
 */
export function calculateCommission(input: CalculationInput, rules: RuleSet): CalculationOutcome {
  const errors = validate(input, rules);
  if (errors.length) return { ok: false, errors };

  const lines: CalculationLine[] = [];
  const warnings: CalculationWarning[] = [];
  const warn = (code: CalculationWarning['code'], severity: CalculationWarning['severity'], message: string) =>
    warnings.push({ code, severity, message });

  const includesPv = input.projectType === 'pv' || input.projectType === 'pv_heat_pump';
  const includesHp = input.projectType === 'heat_pump' || input.projectType === 'pv_heat_pump';
  const { tier } = input;

  // 1./2. Grundprovision auf den Netto-Anlagenpreis (ohne Überverkauf)
  if (includesPv) {
    const rate = rules.baseRateBps[tier];
    lines.push({
      id: 'base',
      group: 'base',
      label: 'Grundprovision',
      basisCents: input.netPriceCents,
      rateBps: rate,
      amountCents: percentOf(input.netPriceCents, rate),
    });
  } else if (input.netPriceCents > 0) {
    warn('BASE_NOT_APPLICABLE', 'warning',
      'Die Grundprovision auf den Netto-Anlagenpreis gilt nur für Photovoltaik. Bitte Wärmepumpe bzw. Zusatzprodukte als eigene Zusatzprodukt-Position erfassen.');
  }

  // 3./4. Überverkauf
  let overprice: OverpriceBreakdown | null = null;
  if (input.overpriceCents > 0) {
    if (!includesPv) {
      warn('OVERPRICE_NOT_APPLICABLE', 'warning',
        'Überverkauf wird nur für Photovoltaikanlagen berücksichtigt und bei dieser Projektart nicht angesetzt.');
    } else {
      if (input.projectType === 'pv_heat_pump') {
        warn('OVERPRICE_CHECK_COMBINED', 'info',
          'Bei PV + Wärmepumpe darf nur der Überverkauf auf die PV-Anlage angesetzt werden. Bitte prüfen.');
      }
      const net = input.netPriceCents; // > 0, durch Validierung gesichert
      const capCents = percentOf(net, rules.overpriceCapBps);
      const creditableCents = Math.min(input.overpriceCents, capCents);
      const excessCents = input.overpriceCents - creditableCents;
      const shareBps = rules.overpriceShareBps[tier];
      const myShareCents = percentOf(creditableCents, shareBps);
      const capped = excessCents > 0;
      overprice = {
        netPriceCents: net,
        overpriceCents: input.overpriceCents,
        overpricePercentBps: roundDiv(input.overpriceCents * 10_000, net),
        capBps: rules.overpriceCapBps,
        capCents,
        creditableCents,
        excessCents,
        shareBps,
        myShareCents,
        capped,
      };
      if (capped) {
        warn('OVERPRICE_CAPPED', 'warning',
          'Der Überverkauf überschreitet den zulässigen Grenzwert. Der übersteigende Anteil steht vollständig Energieversum zu und wird nicht angerechnet.');
      }
      lines.push({
        id: 'overprice_share',
        group: 'overprice',
        label: 'Anteil am Überverkauf',
        basisCents: creditableCents,
        rateBps: shareBps,
        amountCents: myShareCents,
        detail: capped ? 'Anrechenbarer Überverkauf (auf Grenzwert begrenzt)' : 'Anrechenbarer Überverkauf',
      });
    }
  }

  // 5. Zusatzprodukte – jeweils NUR auf den eigenen Nettowert
  input.addons.forEach((a, i) => {
    const label = addonLabel(a);
    if (a.key === 'maintenance_package') {
      const qty = a.quantity ?? 1;
      lines.push({
        id: `addon_${i}`,
        group: 'fixed',
        label,
        amountCents: rules.maintenancePackageCents * qty,
        detail: qty > 1 ? `${qty} × Festbetrag` : 'Festbetrag',
      });
    } else {
      const rate = a.key === 'custom' ? a.rateBps : rules.addonRatesBps[a.key][tier];
      lines.push({
        id: `addon_${i}`,
        group: 'addon',
        label,
        basisCents: a.netValueCents,
        rateBps: rate,
        amountCents: percentOf(a.netValueCents, rate),
      });
    }
  });

  // 6. Eigenlead
  if (input.ownLead) {
    const kind = resolveOwnLeadKind(input) as OwnLeadKind; // Validierung hat Existenz gesichert
    warn('OWN_LEAD_CHECK', 'info',
      'Eigenlead nur ansetzen, wenn der Lead nicht von Energieversum vermittelt wurde.');
    if (kind === 'pv' || kind === 'both') {
      lines.push({ id: 'own_lead_pv', group: 'own_lead', label: 'Eigenlead Photovoltaik', amountCents: rules.ownLeadPvCents });
    }
    if (kind === 'heat_pump' || kind === 'both') {
      lines.push({ id: 'own_lead_hp', group: 'own_lead', label: 'Eigenlead Wärmepumpe', amountCents: rules.ownLeadHeatPumpCents });
    }
    if (kind === 'both') {
      warn('OWN_LEAD_BOTH', 'info', 'Beide Eigenlead-Zusätze (PV und Wärmepumpe) wurden bewusst gewählt.');
    }
  }

  // 7. PV Secure / Premium Plus
  if (input.pvSecurePv) {
    if (!includesPv) warn('PV_SECURE_PROJECT_MISMATCH', 'warning', 'PV Secure Photovoltaik (Premium Plus) bei einem Projekt ohne Photovoltaik – bitte prüfen.');
    lines.push({ id: 'pv_secure_pv', group: 'pv_secure', label: 'PV Secure Photovoltaik (Premium Plus)', amountCents: rules.pvSecurePvCents });
  }
  if (input.pvSecureHeatPump) {
    if (!includesHp) warn('PV_SECURE_PROJECT_MISMATCH', 'warning', 'PV Secure Wärmepumpe bei einem Projekt ohne Wärmepumpe – bitte prüfen.');
    lines.push({ id: 'pv_secure_hp', group: 'pv_secure', label: 'PV Secure Wärmepumpe', amountCents: rules.pvSecureHeatPumpCents });
  }

  // 9. Bauleiter-Abzug (eigene Position)
  if (input.siteManager) {
    lines.push({
      id: 'site_manager',
      group: 'deduction',
      label: 'Bauleiter-Abzug',
      amountCents: -rules.siteManagerDeductionCents,
      detail: 'netto',
    });
  }

  // 10. Sonstige ausdrücklich erfasste Anpassungen
  input.adjustments.forEach((a, i) => {
    lines.push({ id: `adjustment_${i}`, group: 'adjustment', label: a.label.trim(), amountCents: a.amountCents });
  });

  const totalCents = sumCents(lines.map((l) => l.amountCents));
  if (totalCents < 0) {
    warn('NEGATIVE_TOTAL', 'warning', 'Die Gesamtprovision ist negativ. Bitte Abzüge und Anpassungen prüfen.');
  }

  return { ok: true, result: { lines, overprice, warnings, totalCents } };
}

/** Friert Eingaben, Regeln und Ergebnis eines Auftrags ein (wird als jsonb gespeichert). */
export function buildSnapshot(
  input: CalculationInput,
  rules: RuleSet,
  outcome: Extract<CalculationOutcome, { ok: true }>,
  calculatedAt: Date,
  ruleSetVersion: number | null = null,
): CalculationSnapshot {
  return structuredClone({
    schemaVersion: 1 as const,
    calculatedAt: calculatedAt.toISOString(),
    ruleSetVersion,
    input,
    rules,
    result: outcome.result,
  });
}
