import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth/AuthProvider';
import { isSupabaseConfigured } from '../lib/supabase';
import { Alert, Button, Card, Spinner, TextField } from '../components/ui';
import { ConfigMissing } from '../lib/auth/RequireAuth';

const MIN_LENGTH = 10;

export default function ResetPasswordPage() {
  const { session, loading, updatePassword } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isSupabaseConfigured) return <ConfigMissing />;
  if (loading) return <Spinner label="Link wird geprüft …" />;

  if (!session) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
        <Alert kind="error" title="Link ungültig oder abgelaufen">Bitte fordere einen neuen Link zum Zurücksetzen des Passworts an.</Alert>
        <Link to="/passwort-vergessen" className="text-sm text-teal-700 underline">Neuen Link anfordern</Link>
      </main>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_LENGTH) { setError(`Das Passwort muss mindestens ${MIN_LENGTH} Zeichen lang sein.`); return; }
    if (password !== confirm) { setError('Die beiden Passwörter stimmen nicht überein.'); return; }
    setBusy(true);
    const err = await updatePassword(password);
    setBusy(false);
    if (err) setError(err); else navigate('/', { replace: true });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-center text-2xl font-semibold text-navy-800">Neues Passwort festlegen</h1>
      <Card>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Alert kind="error">{error}</Alert>}
          <TextField label="Neues Passwort" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint={`Mindestens ${MIN_LENGTH} Zeichen.`} required />
          <TextField label="Passwort wiederholen" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Wird gespeichert …' : 'Passwort speichern'}</Button>
        </form>
      </Card>
    </main>
  );
}
