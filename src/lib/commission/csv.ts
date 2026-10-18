import type { Bps, Cents, ProjectType, RuleSet, Tier } from './types.ts';
import { PROJECT_TYPE_LABELS, STATUS_LABELS, TIER_LABELS } from './labels.ts';
import { computeOrderState } from './status.ts';
import type { OrderForStatus } from './status.ts';

export interface ExportOrder extends OrderForStatus {
  id: string;
  customerName: string;
  projectType: ProjectType;
  contractDate: string;
  tier: Tier;
  orderNumber?: string | null;
  archived: boolean;
}

export interface ExportPayout {
  id: string;
  orderId: string;
  customerName: string;
  paidOn: string;
  amountCents: Cents;
  note?: string | null;
}

export interface ExportHistoricalPayout {
  id: string;
  customerName: string;
  paidOn: string;
  amountCents: Cents;
  projectType?: ProjectType | null;
  formerTier?: string | null;
  formerModel?: string | null;
  note?: string | null;
}

export interface DateRange {
  from?: string;
  to?: string;
}

const inRange = (d: string, r?: DateRange) => (!r?.from || d >= r.from) && (!r?.to || d <= r.to);

/** Deutsches Format ohne Tausenderpunkt, exakt aus Integer: 123450 -> "1234,50". */
export function centsToDecimal(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

export function bpsToDecimal(bps: Bps): string {
  return centsToDecimal(bps); // gleiche Hundertstel-Darstellung: 1250 -> "12,50"
}

const isoToDe = (iso: string) => iso.split('-').reverse().join('.');

/** Schützt Textzellen vor Formel-Injection in Excel/LibreOffice und maskiert für CSV. */
export function csvText(value: string | null | undefined): string {
  let v = value ?? '';
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function toCsv(header: string[], rows: string[][]): string {
  return '\uFEFF' + [header.join(';'), ...rows.map((r) => r.join(';'))].join('\r\n') + '\r\n';
}

export function ordersToCsv(
  orders: ExportOrder[],
  rules: Pick<RuleSet, 'payoutThresholds'>,
  range?: DateRange,
): string {
  const header = [
    'ID', 'Kunde', 'Projektart', 'Vertragsdatum', 'Stufe', 'Auftragsnummer',
    'Provision gesamt (EUR)', 'Ausgezahlt (EUR)', 'Restbetrag (EUR)', 'Status',
    'Zahlungsfortschritt (%)', 'Archiviert',
  ];
  const rows = orders
    .filter((o) => inRange(o.contractDate, range))
    .map((o) => {
      const s = computeOrderState(o, rules);
      return [
        o.id, csvText(o.customerName), csvText(PROJECT_TYPE_LABELS[o.projectType]),
        isoToDe(o.contractDate), TIER_LABELS[o.tier], csvText(o.orderNumber),
        centsToDecimal(s.totalCents), centsToDecimal(s.paidCents), centsToDecimal(s.remainingCents),
        STATUS_LABELS[s.status], bpsToDecimal(o.customerPaidBps), o.archived ? 'Ja' : 'Nein',
      ];
    });
  return toCsv(header, rows);
}

export function payoutsToCsv(
  payouts: ExportPayout[],
  historical: ExportHistoricalPayout[],
  range?: DateRange,
  kinds: Array<'order' | 'historical'> = ['order', 'historical'],
): string {
  const header = ['Art', 'ID', 'Auftrags-ID', 'Kunde/Projekt', 'Auszahlungsdatum', 'Betrag (EUR)', 'Projektart', 'Frühere Stufe', 'Frühere Provisionsübersicht', 'Notiz'];
  const rows: string[][] = [];
  if (kinds.includes('order')) {
    for (const p of payouts.filter((x) => inRange(x.paidOn, range))) {
      rows.push(['Auszahlung', p.id, p.orderId, csvText(p.customerName), isoToDe(p.paidOn), centsToDecimal(p.amountCents), '', '', '', csvText(p.note)]);
    }
  }
  if (kinds.includes('historical')) {
    for (const h of historical.filter((x) => inRange(x.paidOn, range))) {
      rows.push([
        'Historische Auszahlung', h.id, '', csvText(h.customerName), isoToDe(h.paidOn), centsToDecimal(h.amountCents),
        h.projectType ? csvText(PROJECT_TYPE_LABELS[h.projectType]) : '', csvText(h.formerTier), csvText(h.formerModel), csvText(h.note),
      ]);
    }
  }
  return toCsv(header, rows);
}

/** Vollständiger Datenexport: Beträge bleiben als Cent-Integer (verlustfrei), Daten als ISO. */
export function buildJsonBackup(data: Record<string, unknown[]>, exportedAt: Date): string {
  return JSON.stringify({ format: 'provisionsmanager-backup', version: 1, exportedAt: exportedAt.toISOString(), amountsUnit: 'cents', data }, null, 2);
}
