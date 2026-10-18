import type { Bps, Cents } from './types.ts';

/** Obergrenze (100 Mio. €), damit Cent × Basispunkte sicher im Integer-Bereich bleibt. */
export const MAX_CENTS = 10_000_000_000;

export function isCents(v: unknown, opts: { allowNegative?: boolean } = {}): v is Cents {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) return false;
  if (!opts.allowNegative && v < 0) return false;
  return Math.abs(v) <= MAX_CENTS;
}

export function isBps(v: unknown): v is Bps {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 10_000;
}

/** Ganzzahldivision, kaufmännisch gerundet (0,5 weg von Null). Nur mit Integer-Argumenten. */
export function roundDiv(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError('roundDiv erwartet Integer und einen positiven Nenner');
  }
  const sign = numerator < 0 ? -1 : 1;
  const abs = Math.abs(numerator);
  let q = Math.floor(abs / denominator);
  const r = abs - q * denominator;
  if (r * 2 >= denominator) q += 1;
  return sign * q;
}

/** Prozentbetrag: cents × bps / 10 000, auf ganze Cent gerundet. */
export function percentOf(cents: Cents, bps: Bps): Cents {
  return roundDiv(cents * bps, 10_000);
}

/** Summe als Integer; wirft bei Überlauf statt still falsch zu rechnen. */
export function sumCents(values: Cents[]): Cents {
  let total = 0;
  for (const v of values) {
    total += v;
    if (!Number.isSafeInteger(total)) throw new RangeError('Betragsüberlauf');
  }
  return total;
}

const DECIMAL_DE = /^(-?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

/**
 * Parst deutsche Zahleneingaben ("20.000,50", "20000", "295,5", "-295") in Hundertstel.
 * Gibt null bei ungültiger Eingabe zurück. Kein Fließkomma beteiligt.
 */
function parseHundredths(input: string): number | null {
  const cleaned = input.replace(/[\s\u00a0€%]/g, '');
  const m = DECIMAL_DE.exec(cleaned);
  if (!m) return null;
  const [, sign, intPart, frac = ''] = m;
  const whole = Number(intPart.replace(/\./g, ''));
  const value = whole * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(value)) return null;
  return sign === '-' ? -value : value;
}

export function parseEuroToCents(input: string): Cents | null {
  const v = parseHundredths(input);
  return v !== null && Math.abs(v) <= MAX_CENTS ? v : null;
}

/** "12,5" -> 1250 Basispunkte. */
export function parsePercentToBps(input: string): Bps | null {
  const v = parseHundredths(input);
  return v !== null && v >= 0 && v <= 10_000 ? v : null;
}

const euroFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const pctFmt = new Intl.NumberFormat('de-DE', {
  style: 'percent',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** Nur Anzeige (Fließkomma unkritisch, da die Cent-Zahl exakt ist). */
export function formatEuro(cents: Cents): string {
  return euroFmt.format(cents / 100);
}

export function formatPercent(bps: Bps): string {
  return pctFmt.format(bps / 10_000);
}
