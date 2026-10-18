import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth/AuthProvider';
import { isSupabaseConfigured } from '../lib/supabase';
import { Alert, Button, Card, Spinner, TextField } from '../components/ui';
import { ConfigMissing } from '../lib/auth/RequireAuth';

export default function LoginPage() {
  const { session, loading, recovery, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isSupabaseConfigured) return <ConfigMissing />;
  if (loading) return <Spinner label="Anmeldung wird geprüft …" />;
  if (session && !recovery) return <Navigate to="/" replace />;

  const from = (location.state as { from?: string } | null)?.from ?? '/';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) { setError('Bitte E-Mail-Adresse und Passwort eingeben.'); return; }
    setBusy(true);
    const err = await signIn(email, password);
    setBusy(false);
    if (err) setError(err); else navigate(from, { replace: true });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div className="text-center">
        <span aria-hidden className="mx-auto mb-3 block h-1.5 w-12 rounded bg-teal-500" />
        <h1 className="text-2xl font-semibold text-navy-800">Provisionsmanager</h1>
        <p className="mt-1 text-sm text-anthracite-600">Privater Bereich – bitte anmelden.</p>
      </div>
      <Card>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Alert kind="error">{error}</Alert>}
          <TextField label="E-Mail-Adresse" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <TextField label="Passwort" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Anmeldung läuft …' : 'Anmelden'}</Button>
          <p className="text-center text-sm"><Link to="/passwort-vergessen" className="text-teal-700 underline">Passwort vergessen?</Link></p>
        </form>
      </Card>
    </main>
  );
}
