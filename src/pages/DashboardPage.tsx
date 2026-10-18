import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadDashboardData } from '../lib/data/dashboard';
import { EMPTY_FILTERS, buildDashboard, periodFor } from '../lib/data/dashboardModel';
import type { DashboardFilters, RowStatus } from '../lib/data/dashboardModel';
import { useRules } from '../lib/rules/RulesProvider';
import { describeError } from '../lib/supabase';
import { formatEuro } from '../lib/commission/money';
import { PROJECT_TYPES, TIERS } from '../lib/commission/types';
import type { ProjectType, Tier } from '../lib/commission/types';
import { PROJECT_TYPE_LABELS, TIER_LABELS } from '../lib/commission/labels';
import { Alert, Button, Card, SelectField, Spinner, TextField } from '../components/ui';

type Data = Awaited<ReturnType<typeof loadDashboardData>>;

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const STATUS_OPTIONS: Array<{ value: RowStatus; label: string }> = [
  { value: 'expected', label: 'Erwartet' },
  { value: 'open', label: 'Offen' },
  { value: 'paid', label: 'Ausgezahlt' },
  { value: 'historical', label: 'Historisch ausgezahlt' },
];
const STATUS_BADGE: Record<RowStatus, string> = {
  expected: 'bg-slate-100 text-anthracite-700',
  open: 'bg-teal-100 text-teal-700',
  paid: 'bg-navy-800 text-white',
  historical: 'bg-violet-100 text-violet-600',
};

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function Kpi({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent: string }) {
  return (
    <div className={`rounded-lg border border-slate-200 border-t-4 bg-white p-4 shadow-sm ${accent}`}>
      <p className="text-sm text-anthracite-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-navy-800">{value}</p>
      {hint && <p className="mt-1 text-xs text-anthracite-600">{hint}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const { rules, loading: rulesLoading } = useRules();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [filters, setFilters] = useState<DashboardFilters>(EMPTY_FILTERS);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setData(await loadDashboardData()); } catch (e) { setError(describeError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const years = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: 8 }, (_, i) => current + 1 - i);
  }, []);

  const model = useMemo(
    () => (data ? buildDashboard(data, rules, periodFor(year, year === null ? null : month), filters) : null),
    [data, rules, year, month, filters],
  );

  if (loading || rulesLoading) return <Spinner label="Dashboard wird geladen …" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold text-navy-800">Dashboard</h1>
        <div className="flex flex-wrap items-end gap-3">
          <SelectField label="Jahr" value={year ?? ''} onChange={(e) => { const v = e.target.value; setYear(v ? Number(v) : null); setMonth(null); }}>
            <option value="">Alle Jahre</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </SelectField>
          <SelectField label="Monat" value={month ?? ''} disabled={year === null} onChange={(e) => setMonth(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Alle Monate</option>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </SelectField>
          <Button variant="secondary" onClick={() => void load()}>Aktualisieren</Button>
        </div>
      </div>

      {error && <Alert kind="error" title="Daten konnten nicht geladen werden">{error}</Alert>}

      {model && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi label="Erwartete Provisionen" value={formatEuro(model.summary.expectedCents)} hint="Noch nicht auszahlungsberechtigt" accent="border-t-slate-400" />
            <Kpi label="Offene Provisionen" value={formatEuro(model.summary.openCents)} hint="Auszahlungsberechtigt, noch nicht gezahlt" accent="border-t-teal-500" />
            <Kpi label="Bereits ausgezahlt" value={formatEuro(model.summary.paidCents)} hint={`davon historisch: ${formatEuro(model.summary.historicalPaidCents)}`} accent="border-t-navy-800" />
            <Kpi label="Gesamtvolumen" value={formatEuro(model.summary.totalVolumeCents)} hint="Erwartet + offen + ausgezahlt" accent="border-t-violet-500" />
            <Kpi label="Anzahl Aufträge" value={String(model.summary.orderCount)} hint={`${model.summary.historicalCount} historische Auszahlungen`} accent="border-t-anthracite-600" />
          </div>

          <Card title="Neueste Aufträge und Auszahlungen">
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <TextField label="Kunde suchen" type="search" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Name oder Projekt" />
              <SelectField label="Projektart" value={filters.projectType} onChange={(e) => setFilters({ ...filters, projectType: e.target.value as ProjectType | '' })}>
                <option value="">Alle</option>
                {PROJECT_TYPES.map((p) => <option key={p} value={p}>{PROJECT_TYPE_LABELS[p]}</option>)}
              </SelectField>
              <SelectField label="Provisionsstufe" value={filters.tier} onChange={(e) => setFilters({ ...filters, tier: e.target.value as Tier | '' })}>
                <option value="">Alle</option>
                {TIERS.map((t) => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}
              </SelectField>
              <SelectField label="Status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value as RowStatus | '' })}>
                <option value="">Alle</option>
                {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </SelectField>
            </div>

            {model.rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-anthracite-600">Keine Einträge für die gewählten Filter.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <caption className="sr-only">Neueste Aufträge und Auszahlungen</caption>
                  <thead className="border-b border-slate-200 text-anthracite-600">
                    <tr>
                      <th scope="col" className="py-2 pr-3 font-medium">Datum</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Kunde</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Projektart</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Status</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Stufe</th>
                      <th scope="col" className="py-2 text-right font-medium">Provision</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {model.rows.slice(0, 25).map((r) => (
                      <tr key={r.key}>
                        <td className="py-2 pr-3 tabular-nums">{formatDate(r.date)}</td>
                        <td className="py-2 pr-3 font-medium text-navy-800">{r.customer}</td>
                        <td className="py-2 pr-3">{r.projectLabel}</td>
                        <td className="py-2 pr-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[r.status]}`}>{r.statusLabel}</span></td>
                        <td className="py-2 pr-3">{r.tierLabel}</td>
                        <td className="py-2 text-right tabular-nums">{formatEuro(r.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-anthracite-600">Dokument-Anzeige und Aktionen (Öffnen, Bearbeiten) kommen mit der Auftragsverwaltung.</p>
          </Card>
        </>
      )}
    </div>
  );
}
