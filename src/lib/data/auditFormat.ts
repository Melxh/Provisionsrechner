import { formatEuro, formatPercent } from '../commission/money.ts';
import { PROJECT_TYPE_LABELS, STATUS_LABELS, TIER_LABELS } from '../commission/labels.ts';

export interface AuditEntry {
  id: number;
  entity_table: string;
  entity_id: string;
  action: 'insert' | 'update' | 'delete';
  changes: Record<string, { old: unknown; new: unknown }>;
  created_at: string;
}

const FIELD_LABELS: Record<string, string> = {
  customer_name: 'Kunde', project_type: 'Projektart', contract_date: 'Vertragsdatum', order_number: 'Auftragsnummer',
  confirmation_date: 'Datum Auftragsbestätigung', note: 'Notiz', tier: 'Stufe', payment_model: 'Zahlungsbedingung',
  custom_threshold_bps: 'Individuelle Zahlungsschwelle', customer_paid_bps: 'Zahlungsfortschritt des Kunden',
  expected_payout_date: 'Voraussichtliche Auszahlung', status_override: 'Manuelle Statuskorrektur',
  status_override_reason: 'Begründung der Statuskorrektur', commission_total_cents: 'Gesamtprovision',
  rule_set_id: 'Regelversion', paid_on: 'Auszahlungsdatum', amount_cents: 'Betrag', file_name: 'Datei', kind: 'Art',
};

const PAYMENT_LABELS: Record<string, string> = { regular: 'Regulär', prepayment: 'Vollständige Vorkasse', custom: 'Individuell' };
const HIDDEN = new Set(['id', 'user_id', 'order_id', 'payout_id', 'historical_payout_id', 'storage_path', 'mime_type', 'size_bytes', 'archived_at']);

function formatDate(v: string): string {
  const [y, m, d] = v.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

export function formatAuditValue(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '–';
  if (key.endsWith('_cents') && typeof v === 'number') return formatEuro(v);
  if (key.endsWith('_bps') && typeof v === 'number') return formatPercent(v);
  if (key === 'tier' && typeof v === 'string') return TIER_LABELS[v as keyof typeof TIER_LABELS] ?? v;
  if (key === 'project_type' && typeof v === 'string') return PROJECT_TYPE_LABELS[v as keyof typeof PROJECT_TYPE_LABELS] ?? v;
  if (key === 'status_override' && typeof v === 'string') return STATUS_LABELS[v as keyof typeof STATUS_LABELS] ?? v;
  if (key === 'payment_model' && typeof v === 'string') return PAYMENT_LABELS[v] ?? v;
  if (key === 'rule_set_id') return 'andere Regelversion';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return formatDate(v);
  return String(v);
}

/** Verständliche deutsche Beschreibung eines Protokolleintrags (ohne technische IDs). */
export function describeAudit(e: AuditEntry): { title: string; details: string[] } {
  const c = e.changes ?? {};
  const val = (k: string) => (e.action === 'delete' ? c[k]?.old : c[k]?.new);
  const details = Object.entries(c)
    .filter(([k]) => !HIDDEN.has(k))
    .map(([k, ch]) => `${FIELD_LABELS[k] ?? k}: ${formatAuditValue(k, ch.old)} → ${formatAuditValue(k, ch.new)}`);

  switch (e.entity_table) {
    case 'orders': {
      if (e.action === 'insert') return { title: 'Auftrag angelegt', details: [] };
      if (e.action === 'delete') return { title: 'Auftrag gelöscht', details: [] };
      const arch = c.archived_at;
      const title = arch ? (arch.new ? 'Auftrag archiviert' : 'Auftrag wiederhergestellt') : 'Auftrag geändert';
      return { title, details };
    }
    case 'payouts': {
      const what = `${formatAuditValue('amount_cents', val('amount_cents'))} am ${formatAuditValue('paid_on', val('paid_on'))}`;
      if (e.action === 'insert') return { title: `Auszahlung erfasst: ${what}`, details: [] };
      if (e.action === 'delete') return { title: `Auszahlung gelöscht: ${what}`, details: [] };
      return { title: 'Auszahlung geändert', details };
    }
    case 'attachments': {
      const name = String(val('file_name') ?? 'Datei');
      return { title: e.action === 'insert' ? `Dokument hinzugefügt: ${name}` : `Dokument entfernt: ${name}`, details: [] };
    }
    default:
      return { title: `${e.entity_table}: ${e.action}`, details };
  }
}
