import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth/AuthProvider';
import { RulesProvider } from '../lib/rules/RulesProvider';
import { TierProvider, useTier } from '../lib/tier/TierProvider';
import { TIERS } from '../lib/commission/types';
import { TIER_LABELS } from '../lib/commission/labels';
import { formatPercent } from '../lib/commission/money';
import { useRules } from '../lib/rules/RulesProvider';
import { Alert, Button } from './ui';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/neue-provision', label: 'Neue Provision' },
  { to: '/kunden', label: 'Alle Kunden und Aufträge' },
  { to: '/historisch', label: 'Historische Auszahlungen' },
  { to: '/auswertungen', label: 'Auswertungen' },
  { to: '/einstellungen', label: 'Einstellungen' },
];

function TierSelector() {
  const { tier, setTier, loading, error } = useTier();
  const { rules } = useRules();
  return (
    <div>
      <fieldset className="flex flex-wrap items-center gap-2" disabled={loading}>
        <legend className="sr-only">Aktuelle Vertriebsstufe (Standard für neue Aufträge)</legend>
        <span className="text-sm font-medium text-white/80" aria-hidden>Aktuelle Stufe:</span>
        <div className="inline-flex overflow-hidden rounded-md ring-1 ring-white/30" role="radiogroup" aria-label="Aktuelle Vertriebsstufe">
          {TIERS.map((t) => (
            <label key={t} className={`cursor-pointer px-3 py-1.5 text-sm font-medium transition focus-within:ring-2 focus-within:ring-teal-100 ${tier === t ? 'bg-teal-500 text-navy-900' : 'bg-navy-700 text-white hover:bg-navy-700/80'}`}>
              <input type="radio" name="tier" value={t} checked={tier === t} onChange={() => void setTier(t)} className="sr-only" />
              {TIER_LABELS[t]} <span className="text-xs opacity-80">{formatPercent(rules.baseRateBps[t])}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {error && <p role="alert" className="mt-1 text-xs text-red-200">{error}</p>}
    </div>
  );
}

function Shell() {
  const { user, signOut } = useAuth();
  const { error } = useRules();
  return (
    <div className="min-h-screen">
      <header className="bg-navy-800 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span aria-hidden className="h-6 w-1.5 rounded bg-teal-500" />
            <p className="text-lg font-semibold">Provisionsmanager</p>
          </div>
          <TierSelector />
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-white/80 sm:inline" title={user?.email ?? ''}>{user?.email}</span>
            <Button variant="secondary" onClick={() => void signOut()}>Abmelden</Button>
          </div>
        </div>
        <nav aria-label="Hauptnavigation" className="border-t border-white/10">
          <ul className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-2">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `block whitespace-nowrap border-b-2 px-3 py-2.5 text-sm ${isActive ? 'border-teal-500 font-semibold text-white' : 'border-transparent text-white/75 hover:text-white'}`}
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        {error && <Alert kind="error" title="Provisionsregeln konnten nicht geladen werden">{error} Es gelten vorübergehend die Standardwerte – bitte nicht speichern, bevor der Fehler behoben ist.</Alert>}
        <Outlet />
      </main>
    </div>
  );
}

export default function AppLayout() {
  return (
    <RulesProvider>
      <TierProvider>
        <Shell />
      </TierProvider>
    </RulesProvider>
  );
}
