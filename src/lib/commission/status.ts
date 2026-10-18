import type { Bps, Cents, CommissionStatus, PaymentModel, RuleSet } from './types.ts';
import { isBps, isCents, sumCents } from './money.ts';

export interface PayoutRecord {
  amountCents: Cents;
  /** ISO-Datum YYYY-MM-DD */
  paidOn: string;
}

export interface OrderForStatus {
  commissionTotalCents: Cents;
  paymentModel: PaymentModel;
  customThresholdBps?: Bps | null;
  /** Vom Kunden bereits bezahlter Anteil (Basispunkte, 9500 = 95 %). */
  customerPaidBps: Bps;
  payouts: PayoutRecord[];
  statusOverride?: { status: CommissionStatus; reason: string } | null;
}

export interface OrderCommissionState {
  status: CommissionStatus;
  eligible: boolean;
  thresholdBps: Bps;
  totalCents: Cents;
  paidCents: Cents;
  remainingCents: Cents;
  overpaidCents: Cents;
  partiallyPaid: boolean;
  overrideApplied: boolean;
}

export function requiredPaymentBps(
  model: PaymentModel,
  customThresholdBps: Bps | null | undefined,
  rules: Pick<RuleSet, 'payoutThresholds'>,
): Bps {
  switch (model) {
    case 'regular':
      return rules.payoutThresholds.regularBps;
    case 'prepayment':
      return rules.payoutThresholds.prepaymentBps;
    case 'custom':
      if (!isBps(customThresholdBps)) throw new RangeError('Individuelle Zahlungsschwelle fehlt oder ist ungültig');
      return customThresholdBps;
  }
}

/**
 * Status einer Auftragsprovision.
 * - Teilzahlungen: bereits ausgezahlt + Restbetrag werden getrennt geführt, nichts wird doppelt gezählt.
 * - Der Restbetrag ist "offen", sobald der Kundenzahlungsstand die Schwelle erreicht, sonst "erwartet".
 * - Manuelle Korrektur nur mit Begründung; "paid" setzt den Rest auf 0, erfindet aber keine Auszahlung.
 */
export function computeOrderState(order: OrderForStatus, rules: Pick<RuleSet, 'payoutThresholds'>): OrderCommissionState {
  if (!isCents(order.commissionTotalCents, { allowNegative: true })) throw new RangeError('Ungültige Gesamtprovision');
  if (!isBps(order.customerPaidBps)) throw new RangeError('Zahlungsfortschritt muss zwischen 0 % und 100 % liegen');
  for (const p of order.payouts) {
    if (!isCents(p.amountCents) || p.amountCents <= 0) throw new RangeError('Auszahlungsbeträge müssen größer 0 sein');
  }

  const thresholdBps = requiredPaymentBps(order.paymentModel, order.customThresholdBps, rules);
  const eligible = order.customerPaidBps >= thresholdBps;
  const totalCents = order.commissionTotalCents;
  const paidCents = sumCents(order.payouts.map((p) => p.amountCents));
  const overpaidCents = Math.max(paidCents - totalCents, 0);
  let remainingCents = Math.max(totalCents - paidCents, 0);

  const override =
    order.statusOverride && order.statusOverride.reason.trim().length > 0 ? order.statusOverride : null;

  let status: CommissionStatus;
  if (override) {
    status = override.status;
    if (override.status === 'paid') remainingCents = 0;
  } else if (remainingCents === 0 && paidCents > 0) {
    status = 'paid';
  } else {
    status = eligible ? 'open' : 'expected';
  }

  return {
    status,
    eligible,
    thresholdBps,
    totalCents,
    paidCents,
    remainingCents,
    overpaidCents,
    partiallyPaid: paidCents > 0 && remainingCents > 0,
    overrideApplied: override !== null,
  };
}
