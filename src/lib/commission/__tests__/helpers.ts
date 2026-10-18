import type { CalculationInput, CalculationOutcome, CalculationResult, Tier } from '../types.ts';
import { calculateCommission } from '../calculate.ts';
import { DEFAULT_RULES } from '../rules.ts';

export const EUR = (euros: number): number => Math.round(euros * 100);

export function makeInput(over: Partial<CalculationInput> = {}): CalculationInput {
  return {
    tier: 'pro',
    projectType: 'pv',
    netPriceCents: EUR(20_000),
    overpriceCents: 0,
    ownLead: false,
    pvSecurePv: false,
    pvSecureHeatPump: false,
    siteManager: false,
    addons: [],
    adjustments: [],
    ...over,
  };
}

export function calc(over: Partial<CalculationInput> = {}, rules = DEFAULT_RULES): CalculationResult {
  const outcome: CalculationOutcome = calculateCommission(makeInput(over), rules);
  if (!outcome.ok) throw new Error('Unerwarteter Fehler: ' + JSON.stringify(outcome.errors));
  return outcome.result;
}

export const line = (r: CalculationResult, id: string) => r.lines.find((l) => l.id === id);
export const TIER_LIST: Tier[] = ['starter', 'med', 'pro', 'expert'];
