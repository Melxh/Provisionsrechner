import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadOrdersOverview } from '../lib/orders/ordersRepo';
import { EMPTY_ORDER_FILTERS, buildOrdersList } from '../lib/data/ordersModel';
import type { OrdersFilters } from '../lib/data/ordersModel';
import { useRules } from '../lib/rules/RulesProvider';
import { describeError } from '../lib/supabase';
import { formatEuro, formatPercent } from '../lib/commission/money';
import { PROJECT_TYPES, TIERS } from '../lib/commission/types';
import type { CommissionStatus, ProjectType, Tier } from '../lib/commission/types';
import { PROJECT_TYPE_LABELS, STATUS_LABELS, TIER_LABELS } from '../lib/commission/labels';
import { Alert, Button, Card, SelectField, Spinner, TextField } from '../components/ui';

type Data = Awaited<ReturnType<typeof loadOrdersOverview>>;

const STATUS_BADGE: Record<CommissionStatus, string> = {
  expected: 'bg-slate-100 text-anthracite-700',
  open: 'bg-teal-100 text-teal-700',
  paid: 'bg-navy-800 text-white',
};

const formatDate = (iso: string) => iso.split('-').reverse().join('.');

export default function OrdersPage() {
  const { rules, loading: rulesLoading } = useRules();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<OrdersFilters>(EMPTY_ORDER_FILTERS);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setData(await loadOrdersOverview()); } catch (e) { setError(describeError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const model = useMemo(() => (data ? buildOrdersList(data, rules, filters) : null), [data, rules, filters]);
  const set = <K extends keyof OrdersFilters>(k: K, v: OrdersFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const filtered = JSON.stringify(filters) !== JSON.stringify(EMPTY_ORDER_FILTERS);

  if (loading || rulesLoading) return <Spinner label="Aufträge werden geladen …" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-navy-800">Alle Kunden und Aufträge</h1>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => void load()}>Aktualisieren</Button>
          <Link to="/neue-provision" className="inline-flex items-center rounded-md bg-navy-800 px-4 py-2 text-sm font-medium text-white hover:bg-navy-700">Neue Provision</Link>
        </div>
      </div>

      {error && <Alert kind="error" title="Aufträge konnten nicht geladen werden">{error}</Alert>}

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TextField label="Suche (Kunde, Auftragsnummer)" type="search" value={filters.search} onChange={(e) => set('search', e.target.value)} />
          <TextField label="Vertragsdatum von" type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} />
          <TextField label="Vertragsdatum bis" type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} />
          <SelectField label="Anzeige" value={filters.archived} onChange={(e) => set('archived', e.target.value as OrdersFilters['archived'])}>
            <option value="active">Aktive Aufträge</option>
            <option value="archived">Archivierte Aufträge</option>
            <option value="all">Alle</option>
          </SelectField>
          <SelectField label="Projektart" value={filters.projectType} onChange={(e) => set('projectType', e.target.value as ProjectType | '')}>
            <option value="">Alle</option>
            {PROJECT_TYPES.map((p) => <option key={p} value={p}>{PROJECT_TYPE_LABELS[p]}</option>)}
          </SelectField>
          <SelectField label="Provisionsstufe" value={filters.tier} onChange={(e) => set('tier', e.target.value as Tier | '')}>
            <option value="">Alle</option>
            {TIERS.map((t) => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}
          </SelectField>
          <SelectField label="Status" value={filters.status} onChange={(e) => set('status', e.target.value as CommissionStatus | '')}>
            <option value="">Alle</option>
            {(Object.keys(STATUS_LABELS) as CommissionStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </SelectField>
          <div className="flex items-end">
            <Button variant="ghost" onClick={() => setFilters(EMPTY_ORDER_FILTERS)} disabled={!filtered}>Filter zurücksetzen</Button>
          </div>
        </div>
      </Card>

      {model && (
        <Card>
          {model.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-anthracite-600">{filtered ? 'Keine Aufträge für diese Filter.' : 'Noch keine Aufträge erfasst.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <caption className="sr-only">Alle Aufträge</caption>
                <thead className="border-b border-slate-200 text-anthracite-600">
                  <tr>
                    <th scope="col" className="py-2 pr-3 font-medium">Vertrag</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Kunde</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Projektart</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Stufe</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Status</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Zahlung</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Provision</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Ausgezahlt</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Rest</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Doku.</th>
                    <th scope="col" className="py-2 font-medium"><span className="sr-only">Aktionen</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {model.rows.map((r) => (
                    <tr key={r.id} className={r.archived ? 'text-anthracite-600' : ''}>
                      <td className="py-2 pr-3 tabular-nums">{formatDate(r.date)}</td>
                      <td className="py-2 pr-3 font-medium text-navy-800">
                        {r.customer}{r.orderNumber && <span className="ml-2 text-xs font-normal text-anthracite-600">{r.orderNumber}</span>}
                        {r.archived && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs">archiviert</span>}
                      </td>
                      <td className="py-2 pr-3">{r.projectLabel}</td>
                      <td className="py-2 pr-3">{r.tierLabel}</td>
                      <td className="py-2 pr-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[r.status]}`}>{r.statusLabel}</span>
                        {r.partiallyPaid && <span className="ml-1 text-xs text-anthracite-600">teilweise</span>}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatPercent(r.customerPaidBps)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatEuro(r.totalCents)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatEuro(r.paidCents)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatEuro(r.remainingCents)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.docCount}</td>
                      <td className="py-2 text-right">
                        <Link to={`/kunden/${r.id}`} className="text-teal-700 underline" aria-label={`Auftrag ${r.customer} öffnen`}>Öffnen</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 font-medium">
                  <tr>
                    <td colSpan={6} className="py-2 pr-3">{model.rows.length} Aufträge</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatEuro(model.totals.totalCents)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatEuro(model.totals.paidCents)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatEuro(model.totals.remainingCents)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
