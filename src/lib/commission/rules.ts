import type { PercentAddonKey, RuleSet, Tier } from './types.ts';
import { TIERS, PERCENT_ADDON_KEYS } from './types.ts';
import { isBps, isCents } from './money.ts';

const hi = (a: number, b: number, c: number, d: number): Record<Tier, number> => ({
  starter: a,
  med: b,
  pro: c,
  expert: d,
});

/** Anfängliche Standardwerte laut Projektauftrag (Provisionsübersicht). */
export const DEFAULT_RULES: RuleSet = {
  baseRateBps: hi(700, 800, 900, 1000),
  overpriceShareBps: hi(5700, 5800, 5900, 6000),
  overpriceCapBps: 1250,
  ownLeadPvCents: 150_000,
  ownLeadHeatPumpCents: 100_000,
  pvSecurePvCents: 22_500,
  pvSecureHeatPumpCents: 27_500,
  siteManagerDeductionCents: 29_500,
  maintenancePackageCents: 37_500,
  addonRatesBps: {
    ev_charger_a: hi(1400, 1600, 1800, 2000),
    wallbox_install: hi(1400, 1600, 1800, 2000),
    longlife_battery: hi(1400, 1600, 1800, 2000),
    extended_warranty: hi(700, 800, 900, 1000),
    eps_box_pro: hi(700, 800, 900, 1000),
    heat_pump_5_18: hi(700, 800, 900, 1000),
  },
  payoutThresholds: { regularBps: 9500, prepaymentBps: 10_000 },
};

export function validateRuleSet(rules: RuleSet): string[] {
  const errs: string[] = [];
  for (const t of TIERS) {
    if (!isBps(rules.baseRateBps?.[t])) errs.push(`Grundprovision ${t} ungültig`);
    if (!isBps(rules.overpriceShareBps?.[t])) errs.push(`Überverkaufsanteil ${t} ungültig`);
    for (const k of PERCENT_ADDON_KEYS as readonly PercentAddonKey[]) {
      if (!isBps(rules.addonRatesBps?.[k]?.[t])) errs.push(`Satz ${k}/${t} ungültig`);
    }
  }
  if (!isBps(rules.overpriceCapBps)) errs.push('Überverkaufsgrenzwert ungültig');
  for (const k of [
    'ownLeadPvCents',
    'ownLeadHeatPumpCents',
    'pvSecurePvCents',
    'pvSecureHeatPumpCents',
    'siteManagerDeductionCents',
    'maintenancePackageCents',
  ] as const) {
    if (!isCents(rules[k])) errs.push(`${k} ungültig`);
  }
  if (!isBps(rules.payoutThresholds?.regularBps)) errs.push('Zahlungsschwelle (regulär) ungültig');
  if (!isBps(rules.payoutThresholds?.prepaymentBps)) errs.push('Zahlungsschwelle (Vorkasse) ungültig');
  return errs;
}
