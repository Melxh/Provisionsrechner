import type {
  AddonInput, AdjustmentInput, CalculationInput, CalculationResult, CalculationSnapshot,
  CommissionStatus, OwnLeadKind, PaymentModel, ProjectType, Tier,
} from '../commission/types.ts';
import { PERCENT_ADDON_KEYS } from '../commission/types.ts';
import { parseEuroToCents, parsePercentToBps } from '../commission/money.ts';
import { centsToDecimal } from '../commission/csv.ts';

export type AddonKey = AddonInput['key'];

export interface AddonRow { id: string; key: AddonKey; label: string; netValue: string; rate: string; quantity: string }
export interface AdjustmentRow { id: string; label: string; amount: string }

/** Alle Eingaben als Text im deutschen Format, damit nichts vorzeitig "bereinigt" wird. */
export interface OrderFormState {
  customerName: string;
  projectType: ProjectType;
  contractDate: string;
  tier: Tier;
  orderNumber: string;
  confirmationDate: string;
  expectedPayoutDate: string;
  note: string;
  netPrice: string;
  overprice: string;
  ownLead: boolean;
  ownLeadConfirmed: boolean;
  ownLeadKind: OwnLeadKind | '';
  pvSecurePv: boolean;
  pvSecureHeatPump: boolean;
  siteManager: boolean;
  addons: AddonRow[];
  adjustments: AdjustmentRow[];
  paymentModel: PaymentModel;
  customThreshold: string;
  customerPaid: string;
  /** Nur beim Bearbeiten: manuelle Statuskorrektur (leer = automatisch). */
  statusOverride: CommissionStatus | '';
  statusOverrideReason: string;
}

export interface OrderMeta {
  customerName: string;
  projectType: ProjectType;
  contractDate: string;
  tier: Tier;
  orderNumber: string | null;
  confirmationDate: string | null;
  expectedPayoutDate: string | null;
  note: string | null;
  paymentModel: PaymentModel;
  customThresholdBps: number | null;
  customerPaidBps: number;
  statusOverride: CommissionStatus | null;
  statusOverrideReason: string | null;
}

export interface ParsedOrderForm {
  input: CalculationInput | null;
  meta: OrderMeta | null;
  errors: Record<string, string>;
}

export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function newRowId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function newOrderForm(tier: Tier, today: string): OrderFormState {
  return {
    customerName: '', projectType: 'pv', contractDate: today, tier,
    orderNumber: '', confirmationDate: '', expectedPayoutDate: '', note: '',
    netPrice: '', overprice: '',
    ownLead: false, ownLeadConfirmed: false, ownLeadKind: '',
    pvSecurePv: false, pvSecureHeatPump: false, siteManager: false,
    addons: [], adjustments: [],
    paymentModel: 'regular', customThreshold: '', customerPaid: '0',
    statusOverride: '', statusOverrideReason: '',
  };
}

export function newAddonRow(key: AddonKey = 'ev_charger_a'): AddonRow {
  return { id: newRowId(), key, label: '', netValue: '', rate: '', quantity: '1' };
}
export function newAdjustmentRow(): AdjustmentRow {
  return { id: newRowId(), label: '', amount: '' };
}

export const includesPv = (t: ProjectType) => t === 'pv' || t === 'pv_heat_pump';
export const includesHeatPump = (t: ProjectType) => t === 'heat_pump' || t === 'pv_heat_pump';

function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const MONEY_ERR = 'Bitte einen gültigen Betrag ab 0 € eingeben (z. B. 20.000 oder 1.250,50).';
const SIGNED_MONEY_ERR = 'Bitte einen gültigen Betrag eingeben (z. B. -100 oder 250,50).';
const PCT_ERR = 'Bitte einen Prozentwert zwischen 0 und 100 eingeben (z. B. 9 oder 12,5).';

/** Trennt Eingaben für die Berechnung von reinen Stammdaten, damit die Live-Berechnung auch bei unvollständigen Stammdaten läuft. */
export function parseOrderForm(form: OrderFormState): ParsedOrderForm {
  const calcErrors: Record<string, string> = {};
  const metaErrors: Record<string, string> = {};

  const money = (raw: string, key: string, opts: { required?: boolean; signed?: boolean } = {}): number => {
    const t = raw.trim();
    if (!t) {
      if (opts.required) calcErrors[key] = 'Bitte einen Betrag eingeben.';
      return 0;
    }
    const v = parseEuroToCents(t);
    if (v === null || (!opts.signed && v < 0)) {
      calcErrors[key] = opts.signed ? SIGNED_MONEY_ERR : MONEY_ERR;
      return 0;
    }
    return v;
  };

  const pvLike = includesPv(form.projectType);
  const netPriceCents = pvLike ? money(form.netPrice, 'netPrice', { required: true }) : 0;
  const overpriceCents = pvLike ? money(form.overprice, 'overprice') : 0;

  const ownLead = form.ownLead && form.projectType !== 'other';
  if (ownLead && !form.ownLeadConfirmed) {
    calcErrors.ownLeadConfirmed = 'Bitte bestätigen, dass der Lead nicht von Energieversum vermittelt wurde.';
  }

  const addons: AddonInput[] = [];
  for (const row of form.addons) {
    const k = `addons.${row.id}`;
    if (row.key === 'maintenance_package') {
      const q = row.quantity.trim() === '' ? 1 : /^\d{1,3}$/.test(row.quantity.trim()) ? Number(row.quantity) : NaN;
      if (!Number.isInteger(q) || q < 1) calcErrors[`${k}.quantity`] = 'Bitte eine ganze Zahl ab 1 eingeben.';
      addons.push({ key: 'maintenance_package', label: row.label.trim() || undefined, quantity: Number.isInteger(q) && q >= 1 ? q : 1 });
    } else if (row.key === 'custom') {
      const label = row.label.trim();
      if (!label) calcErrors[`${k}.label`] = 'Bitte eine Produktbezeichnung eingeben.';
      const net = money(row.netValue, `${k}.netValue`, { required: true });
      const rate = parsePercentToBps(row.rate);
      if (rate === null) calcErrors[`${k}.rate`] = PCT_ERR;
      addons.push({ key: 'custom', label, netValueCents: net, rateBps: rate ?? 0 });
    } else if ((PERCENT_ADDON_KEYS as readonly string[]).includes(row.key)) {
      const net = money(row.netValue, `${k}.netValue`, { required: true });
      addons.push({ key: row.key, label: row.label.trim() || undefined, netValueCents: net });
    }
  }

  const adjustments: AdjustmentInput[] = [];
  for (const row of form.adjustments) {
    const k = `adjustments.${row.id}`;
    const label = row.label.trim();
    if (!label) calcErrors[`${k}.label`] = 'Bitte eine Begründung eingeben.';
    adjustments.push({ label, amountCents: money(row.amount, `${k}.amount`, { required: true, signed: true }) });
  }

  // ---- Stammdaten ----
  const name = form.customerName.trim();
  if (!name) metaErrors.customerName = 'Bitte den Kundennamen eingeben.';
  else if (name.length > 200) metaErrors.customerName = 'Der Name ist zu lang (maximal 200 Zeichen).';
  if (!isValidIsoDate(form.contractDate)) metaErrors.contractDate = 'Bitte ein gültiges Vertragsdatum eingeben.';
  const optDate = (raw: string, key: string): string | null => {
    if (!raw) return null;
    if (!isValidIsoDate(raw)) { metaErrors[key] = 'Bitte ein gültiges Datum eingeben.'; return null; }
    return raw;
  };
  const confirmationDate = optDate(form.confirmationDate, 'confirmationDate');
  const expectedPayoutDate = optDate(form.expectedPayoutDate, 'expectedPayoutDate');
  if (form.orderNumber.length > 100) metaErrors.orderNumber = 'Maximal 100 Zeichen.';
  if (form.note.length > 5000) metaErrors.note = 'Maximal 5.000 Zeichen.';

  let customThresholdBps: number | null = null;
  if (form.paymentModel === 'custom') {
    customThresholdBps = parsePercentToBps(form.customThreshold);
    if (customThresholdBps === null) metaErrors.customThreshold = PCT_ERR;
  }
  const paid = form.customerPaid.trim() === '' ? 0 : parsePercentToBps(form.customerPaid);
  if (paid === null) metaErrors.customerPaid = PCT_ERR;

  if (form.statusOverride && !form.statusOverrideReason.trim()) {
    metaErrors.statusOverrideReason = 'Eine manuelle Statuskorrektur braucht eine nachvollziehbare Begründung.';
  }

  const input: CalculationInput = {
    tier: form.tier,
    projectType: form.projectType,
    netPriceCents,
    overpriceCents,
    ownLead,
    ownLeadKind: ownLead && form.ownLeadKind ? form.ownLeadKind : undefined,
    pvSecurePv: form.pvSecurePv,
    pvSecureHeatPump: form.pvSecureHeatPump,
    siteManager: form.siteManager,
    addons,
    adjustments,
  };

  const meta: OrderMeta = {
    customerName: name,
    projectType: form.projectType,
    contractDate: form.contractDate,
    tier: form.tier,
    orderNumber: form.orderNumber.trim() || null,
    confirmationDate,
    expectedPayoutDate,
    note: form.note.trim() || null,
    paymentModel: form.paymentModel,
    customThresholdBps,
    customerPaidBps: paid ?? 0,
    statusOverride: form.statusOverride || null,
    statusOverrideReason: form.statusOverride ? form.statusOverrideReason.trim() : null,
  };

  return {
    input: Object.keys(calcErrors).length === 0 ? input : null,
    meta: Object.keys(metaErrors).length === 0 ? meta : null,
    errors: { ...calcErrors, ...metaErrors },
  };
}

export interface OrderPayload {
  order: Record<string, unknown>;
  addons: Array<Record<string, unknown>>;
  adjustments: Array<Record<string, unknown>>;
}

/** Baut die Daten für die Datenbankfunktion create_order. Die Gesamtprovision stammt allein aus dem Snapshot. */
export function buildOrderPayload(
  meta: OrderMeta,
  input: CalculationInput,
  result: CalculationResult,
  snapshot: CalculationSnapshot,
  ruleSetId: string | null,
): OrderPayload {
  const lineAmount = (id: string) => result.lines.find((l) => l.id === id)?.amountCents ?? 0;
  const addons = input.addons.map((a, i) => {
    const base = { product_key: a.key, label: '', commission_cents: lineAmount(`addon_${i}`) };
    const line = result.lines.find((l) => l.id === `addon_${i}`);
    if (a.key === 'maintenance_package') {
      return { ...base, label: line?.label ?? '', kind: 'fixed', net_value_cents: null, rate_bps: null, quantity: a.quantity ?? 1 };
    }
    return {
      ...base,
      label: line?.label ?? '',
      kind: a.key === 'custom' ? 'custom' : 'percent',
      net_value_cents: a.netValueCents,
      rate_bps: line?.rateBps ?? null,
      quantity: 1,
    };
  });

  return {
    order: {
      customer_name: meta.customerName,
      project_type: meta.projectType,
      contract_date: meta.contractDate,
      order_number: meta.orderNumber,
      confirmation_date: meta.confirmationDate,
      note: meta.note,
      tier: meta.tier,
      payment_model: meta.paymentModel,
      custom_threshold_bps: meta.customThresholdBps,
      customer_paid_bps: meta.customerPaidBps,
      expected_payout_date: meta.expectedPayoutDate,
      status_override: meta.statusOverride,
      status_override_reason: meta.statusOverrideReason,
      rule_set_id: ruleSetId,
      calculation: snapshot,
    },
    addons,
    adjustments: input.adjustments.map((a) => ({ label: a.label.trim(), amount_cents: a.amountCents })),
  };
}

export interface StoredOrderMeta {
  customer_name: string;
  project_type: ProjectType;
  contract_date: string;
  tier: Tier;
  order_number: string | null;
  confirmation_date: string | null;
  expected_payout_date: string | null;
  note: string | null;
  payment_model: PaymentModel;
  custom_threshold_bps: number | null;
  customer_paid_bps: number;
  status_override: CommissionStatus | null;
  status_override_reason: string | null;
}

const pct = (bps: number) => centsToDecimal(bps).replace(/,00$/, '').replace(/(,\d)0$/, '$1');

/** Umkehrung von parseOrderForm: gespeicherter Auftrag (Meta + Snapshot-Eingaben) → Formularzustand zum Bearbeiten. */
export function formFromOrder(meta: StoredOrderMeta, input: CalculationInput): OrderFormState {
  return {
    customerName: meta.customer_name,
    projectType: meta.project_type,
    contractDate: meta.contract_date,
    tier: meta.tier,
    orderNumber: meta.order_number ?? '',
    confirmationDate: meta.confirmation_date ?? '',
    expectedPayoutDate: meta.expected_payout_date ?? '',
    note: meta.note ?? '',
    netPrice: input.netPriceCents > 0 ? centsToDecimal(input.netPriceCents) : '',
    overprice: input.overpriceCents > 0 ? centsToDecimal(input.overpriceCents) : '',
    ownLead: input.ownLead,
    ownLeadConfirmed: input.ownLead, // beim Anlegen bereits bestätigt
    ownLeadKind: input.ownLeadKind ?? '',
    pvSecurePv: input.pvSecurePv,
    pvSecureHeatPump: input.pvSecureHeatPump,
    siteManager: input.siteManager,
    addons: input.addons.map((a): AddonRow => {
      const id = newRowId();
      if (a.key === 'maintenance_package') return { id, key: a.key, label: a.label ?? '', netValue: '', rate: '', quantity: String(a.quantity ?? 1) };
      if (a.key === 'custom') return { id, key: a.key, label: a.label, netValue: centsToDecimal(a.netValueCents), rate: pct(a.rateBps), quantity: '1' };
      return { id, key: a.key, label: a.label ?? '', netValue: centsToDecimal(a.netValueCents), rate: '', quantity: '1' };
    }),
    adjustments: input.adjustments.map((a): AdjustmentRow => ({ id: newRowId(), label: a.label, amount: centsToDecimal(a.amountCents) })),
    paymentModel: meta.payment_model,
    customThreshold: meta.custom_threshold_bps === null ? '' : pct(meta.custom_threshold_bps),
    customerPaid: pct(meta.customer_paid_bps),
    statusOverride: meta.status_override ?? '',
    statusOverrideReason: meta.status_override_reason ?? '',
  };
}
