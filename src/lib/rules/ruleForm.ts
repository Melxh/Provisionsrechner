import type { RuleSet, Tier } from '../commission/types.ts';
import { PERCENT_ADDON_KEYS, TIERS } from '../commission/types.ts';
import { parseEuroToCents, parsePercentToBps } from '../commission/money.ts';
import { centsToDecimal } from '../commission/csv.ts';
import { validateRuleSet } from '../commission/rules.ts';

/** Formularzustand: alle Felder als Text im deutschen Format (z. B. "12,5" oder "1500,00"). */
export type RuleForm = Record<string, string>;

export type RuleFormResult =
  | { ok: true; rules: RuleSet }
  | { ok: false; errors: Record<string, string> };

const pct = (bps: number) => centsToDecimal(bps).replace(/,00$/, '').replace(/(,\d)0$/, '$1');
const eur = (cents: number) => centsToDecimal(cents);

export const formKeys = {
  base: (t: Tier) => `base.${t}`,
  share: (t: Tier) => `share.${t}`,
  addon: (k: string, t: Tier) => `addon.${k}.${t}`,
  cap: 'cap',
  ownLeadPv: 'ownLeadPv',
  ownLeadHp: 'ownLeadHp',
  pvSecurePv: 'pvSecurePv',
  pvSecureHp: 'pvSecureHp',
  siteManager: 'siteManager',
  maintenance: 'maintenance',
  thrRegular: 'thr.regular',
  thrPrepayment: 'thr.prepayment',
} as const;

export function rulesToForm(rules: RuleSet): RuleForm {
  const f: RuleForm = {};
  for (const t of TIERS) {
    f[formKeys.base(t)] = pct(rules.baseRateBps[t]);
    f[formKeys.share(t)] = pct(rules.overpriceShareBps[t]);
    for (const k of PERCENT_ADDON_KEYS) f[formKeys.addon(k, t)] = pct(rules.addonRatesBps[k][t]);
  }
  f[formKeys.cap] = pct(rules.overpriceCapBps);
  f[formKeys.ownLeadPv] = eur(rules.ownLeadPvCents);
  f[formKeys.ownLeadHp] = eur(rules.ownLeadHeatPumpCents);
  f[formKeys.pvSecurePv] = eur(rules.pvSecurePvCents);
  f[formKeys.pvSecureHp] = eur(rules.pvSecureHeatPumpCents);
  f[formKeys.siteManager] = eur(rules.siteManagerDeductionCents);
  f[formKeys.maintenance] = eur(rules.maintenancePackageCents);
  f[formKeys.thrRegular] = pct(rules.payoutThresholds.regularBps);
  f[formKeys.thrPrepayment] = pct(rules.payoutThresholds.prepaymentBps);
  return f;
}

const PCT_ERR = 'Bitte einen Prozentwert zwischen 0 und 100 eingeben (z. B. 7 oder 12,5).';
const EUR_ERR = 'Bitte einen gültigen Betrag ab 0 € eingeben (z. B. 1500 oder 295,50).';

export function formToRules(form: RuleForm): RuleFormResult {
  const errors: Record<string, string> = {};
  const p = (key: string): number => {
    const v = parsePercentToBps(form[key] ?? '');
    if (v === null) { errors[key] = PCT_ERR; return 0; }
    return v;
  };
  const e = (key: string): number => {
    const v = parseEuroToCents(form[key] ?? '');
    if (v === null || v < 0) { errors[key] = EUR_ERR; return 0; }
    return v;
  };

  const baseRateBps = {} as RuleSet['baseRateBps'];
  const overpriceShareBps = {} as RuleSet['overpriceShareBps'];
  const addonRatesBps = {} as RuleSet['addonRatesBps'];
  for (const k of PERCENT_ADDON_KEYS) addonRatesBps[k] = {} as Record<Tier, number>;
  for (const t of TIERS) {
    baseRateBps[t] = p(formKeys.base(t));
    overpriceShareBps[t] = p(formKeys.share(t));
    for (const k of PERCENT_ADDON_KEYS) addonRatesBps[k][t] = p(formKeys.addon(k, t));
  }

  const rules: RuleSet = {
    baseRateBps,
    overpriceShareBps,
    overpriceCapBps: p(formKeys.cap),
    ownLeadPvCents: e(formKeys.ownLeadPv),
    ownLeadHeatPumpCents: e(formKeys.ownLeadHp),
    pvSecurePvCents: e(formKeys.pvSecurePv),
    pvSecureHeatPumpCents: e(formKeys.pvSecureHp),
    siteManagerDeductionCents: e(formKeys.siteManager),
    maintenancePackageCents: e(formKeys.maintenance),
    addonRatesBps,
    payoutThresholds: { regularBps: p(formKeys.thrRegular), prepaymentBps: p(formKeys.thrPrepayment) },
  };

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const remaining = validateRuleSet(rules);
  if (remaining.length > 0) return { ok: false, errors: { _form: remaining.join('; ') } };
  return { ok: true, rules };
}

export function formsEqual(a: RuleForm, b: RuleForm): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? '').trim() !== (b[k] ?? '').trim()) return false;
  return true;
}
