import type { CalculationResult, LineGroup } from '../lib/commission/types';
import { formatEuro, formatPercent } from '../lib/commission/money';
import { Alert } from './ui';

const GROUPS: Array<{ group: LineGroup; title: string }> = [
  { group: 'base', title: 'Grundprovision' },
  { group: 'overprice', title: 'Überverkauf' },
  { group: 'addon', title: 'Produktprovisionen' },
  { group: 'own_lead', title: 'Eigenlead' },
  { group: 'pv_secure', title: 'PV Secure / Premium Plus' },
  { group: 'fixed', title: 'Festbeträge' },
  { group: 'deduction', title: 'Abzüge' },
  { group: 'adjustment', title: 'Sonstige Anpassungen' },
];

const amountClass = (c: number) => (c < 0 ? 'text-red-700' : 'text-anthracite-800');

/** Vollständige, nachvollziehbare Aufschlüsselung – nie nur eine Gesamtsumme. */
export default function CalculationBreakdown({ result, netPriceCents }: { result: CalculationResult; netPriceCents?: number }) {
  const { overprice } = result;
  return (
    <div className="space-y-4">
      {netPriceCents !== undefined && netPriceCents > 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-anthracite-600">Netto-Anlagenpreis (Berechnungsgrundlage, ohne Überverkauf)</span>
          <span className="tabular-nums">{formatEuro(netPriceCents)}</span>
        </div>
      )}

      {overprice && (
        <dl className="space-y-1 rounded-md bg-slate-50 p-3 text-sm">
          <div className="flex justify-between"><dt>Überverkauf erfasst</dt><dd className="tabular-nums">{formatEuro(overprice.overpriceCents)}</dd></div>
          <div className="flex justify-between"><dt>in % des Netto-Anlagenpreises</dt><dd className="tabular-nums">{formatPercent(overprice.overpricePercentBps)}</dd></div>
          <div className="flex justify-between"><dt>Zulässig bis ({formatPercent(overprice.capBps)})</dt><dd className="tabular-nums">{formatEuro(overprice.capCents)}</dd></div>
          <div className="flex justify-between"><dt>Anrechenbarer Überverkauf</dt><dd className="tabular-nums">{formatEuro(overprice.creditableCents)}</dd></div>
          {overprice.capped && (
            <div className="flex justify-between font-medium text-amber-900"><dt>Nicht anrechenbar (steht Energieversum zu)</dt><dd className="tabular-nums">{formatEuro(overprice.excessCents)}</dd></div>
          )}
        </dl>
      )}

      {GROUPS.map(({ group, title }) => {
        const lines = result.lines.filter((l) => l.group === group);
        if (lines.length === 0) return null;
        return (
          <div key={group}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-anthracite-600">{title}</h3>
            <ul className="divide-y divide-slate-100 text-sm">
              {lines.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3 py-1.5">
                  <div>
                    <p>{l.label}</p>
                    {(l.basisCents !== undefined || l.detail) && (
                      <p className="text-xs text-anthracite-600">
                        {l.basisCents !== undefined && l.rateBps !== undefined && `${formatEuro(l.basisCents)} × ${formatPercent(l.rateBps)}`}
                        {l.basisCents !== undefined && l.rateBps !== undefined && l.detail ? ' · ' : ''}
                        {l.detail}
                      </p>
                    )}
                  </div>
                  <span className={`whitespace-nowrap tabular-nums ${amountClass(l.amountCents)}`}>{formatEuro(l.amountCents)}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      <div className="flex items-baseline justify-between rounded-md bg-navy-800 px-4 py-3 text-white">
        <span className="font-medium">Gesamtprovision</span>
        <span className="text-2xl font-semibold tabular-nums" aria-live="polite">{formatEuro(result.totalCents)}</span>
      </div>

      {result.warnings.map((w) => (
        <Alert key={w.code} kind={w.severity === 'warning' ? 'warning' : 'info'}>{w.message}</Alert>
      ))}
    </div>
  );
}
