/** Geldbeträge: ganze Cent (Integer). Prozentsätze: Basispunkte (100 = 1 %, 1250 = 12,5 %). */
export type Cents = number;
export type Bps = number;

export const TIERS = ['starter', 'med', 'pro', 'expert'] as const;
export type Tier = (typeof TIERS)[number];

export const PROJECT_TYPES = ['pv', 'heat_pump', 'pv_heat_pump', 'other'] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export type OwnLeadKind = 'pv' | 'heat_pump' | 'both';

export const PERCENT_ADDON_KEYS = [
  'ev_charger_a',
  'wallbox_install',
  'longlife_battery',
  'extended_warranty',
  'eps_box_pro',
  'heat_pump_5_18',
] as const;
export type PercentAddonKey = (typeof PERCENT_ADDON_KEYS)[number];

export type PaymentModel = 'regular' | 'prepayment' | 'custom';
export type CommissionStatus = 'expected' | 'open' | 'paid';

export interface RuleSet {
  baseRateBps: Record<Tier, Bps>;
  overpriceShareBps: Record<Tier, Bps>;
  /** Maximal anrechenbarer Überverkauf in % des Netto-Anlagenpreises (Basispunkte). */
  overpriceCapBps: Bps;
  ownLeadPvCents: Cents;
  ownLeadHeatPumpCents: Cents;
  pvSecurePvCents: Cents;
  pvSecureHeatPumpCents: Cents;
  siteManagerDeductionCents: Cents;
  maintenancePackageCents: Cents;
  addonRatesBps: Record<PercentAddonKey, Record<Tier, Bps>>;
  payoutThresholds: { regularBps: Bps; prepaymentBps: Bps };
}

export type AddonInput =
  | { key: PercentAddonKey; label?: string; netValueCents: Cents }
  | { key: 'maintenance_package'; label?: string; quantity?: number }
  | { key: 'custom'; label: string; netValueCents: Cents; rateBps: Bps };

export interface AdjustmentInput {
  label: string;
  /** Vorzeichenbehaftet: positiv = Zuschlag, negativ = Abzug. */
  amountCents: Cents;
}

export interface CalculationInput {
  tier: Tier;
  projectType: ProjectType;
  /** Netto-Anlagenpreis nach Rabatten, OHNE separat erfassten Überverkauf. */
  netPriceCents: Cents;
  /** Überverkauf als Eurobetrag (zusätzlich zum Netto-Anlagenpreis). */
  overpriceCents: Cents;
  ownLead: boolean;
  /** Pflicht bei PV+WP und "both" nur bewusst wählbar; bei reinem PV/WP-Projekt abgeleitet. */
  ownLeadKind?: OwnLeadKind;
  pvSecurePv: boolean;
  pvSecureHeatPump: boolean;
  siteManager: boolean;
  addons: AddonInput[];
  adjustments: AdjustmentInput[];
}

export type LineGroup =
  | 'base'
  | 'overprice'
  | 'addon'
  | 'own_lead'
  | 'pv_secure'
  | 'fixed'
  | 'deduction'
  | 'adjustment';

export interface CalculationLine {
  id: string;
  group: LineGroup;
  label: string;
  /** Berechnungsgrundlage in Cent, falls prozentual berechnet. */
  basisCents?: Cents;
  rateBps?: Bps;
  amountCents: Cents;
  detail?: string;
}

export interface OverpriceBreakdown {
  netPriceCents: Cents;
  overpriceCents: Cents;
  /** Überverkauf in % des Netto-Anlagenpreises (Basispunkte, gerundet). */
  overpricePercentBps: Bps;
  capBps: Bps;
  capCents: Cents;
  creditableCents: Cents;
  /** Nicht anrechenbarer Anteil – steht vollständig dem Unternehmen zu. */
  excessCents: Cents;
  shareBps: Bps;
  myShareCents: Cents;
  capped: boolean;
}

export type WarningCode =
  | 'OVERPRICE_CAPPED'
  | 'OVERPRICE_NOT_APPLICABLE'
  | 'OVERPRICE_CHECK_COMBINED'
  | 'BASE_NOT_APPLICABLE'
  | 'OWN_LEAD_CHECK'
  | 'OWN_LEAD_BOTH'
  | 'PV_SECURE_PROJECT_MISMATCH'
  | 'NEGATIVE_TOTAL';

export interface CalculationWarning {
  code: WarningCode;
  severity: 'info' | 'warning';
  message: string;
}

export type ErrorCode =
  | 'INVALID_TIER'
  | 'INVALID_PROJECT_TYPE'
  | 'INVALID_AMOUNT'
  | 'NET_PRICE_REQUIRED'
  | 'OWN_LEAD_KIND_REQUIRED'
  | 'OWN_LEAD_KIND_MISMATCH'
  | 'INVALID_ADDON'
  | 'INVALID_ADJUSTMENT'
  | 'INVALID_RULES';

export interface CalculationError {
  code: ErrorCode;
  field: string;
  message: string;
}

export interface CalculationResult {
  lines: CalculationLine[];
  overprice: OverpriceBreakdown | null;
  warnings: CalculationWarning[];
  totalCents: Cents;
}

export type CalculationOutcome =
  | { ok: true; result: CalculationResult }
  | { ok: false; errors: CalculationError[] };

/** Wird pro Auftrag als jsonb gespeichert – Basis für "nicht unbemerkt neu berechnen". */
export interface CalculationSnapshot {
  schemaVersion: 1;
  calculatedAt: string;
  ruleSetVersion: number | null;
  input: CalculationInput;
  rules: RuleSet;
  result: CalculationResult;
}
