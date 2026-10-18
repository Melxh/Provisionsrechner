import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { isSupabaseConfigured } from '../supabase';
import { useAuth } from './AuthProvider';
import { Alert, Spinner } from '../../components/ui';

export function ConfigMissing() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <Alert kind="error" title="Supabase ist nicht konfiguriert">
        Die Variablen <code>VITE_SUPABASE_URL</code> und <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> fehlen.
        Lokal gehören sie in die Datei <code>.env</code>, für GitHub Pages in die Repository-Secrets (siehe README).
      </Alert>
    </main>
  );
}

/** Schützt alle Unterrouten: ohne Sitzung Weiterleitung zur Anmeldung. */
export default function RequireAuth() {
  const { session, loading, recovery } = useAuth();
  const location = useLocation();

  if (!isSupabaseConfigured) return <ConfigMissing />;
  if (loading) return <Spinner label="Anmeldung wird geprüft …" />;
  if (!session) return <Navigate to="/anmelden" replace state={{ from: location.pathname }} />;
  if (recovery) return <Navigate to="/passwort-neu" replace />;
  return <Outlet />;
}
