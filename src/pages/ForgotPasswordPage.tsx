import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth/AuthProvider';
import { isSupabaseConfigured } from '../lib/supabase';
import { Alert, Button, Card, TextField } from '../components/ui';
import { ConfigMissing } from '../lib/auth/RequireAuth';

export default function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!isSupabaseConfigured) return <ConfigMissing />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) { setError('Bitte die E-Mail-Adresse eingeben.'); return; }
    setBusy(true);
    const err = await requestPasswordReset(email);
    setBusy(false);
    if (err) setError(err); else setSent(true);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-center text-2xl font-semibold text-navy-800">Passwort zurücksetzen</h1>
      <Card>
        {sent ? (
          <div className="space-y-4">
            <Alert kind="success">Falls zu dieser Adresse ein Konto existiert, wurde eine E-Mail mit einem Link zum Zurücksetzen gesendet.</Alert>
            <Link to="/anmelden" className="text-sm text-teal-700 underline">Zurück zur Anmeldung</Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {error && <Alert kind="error">{error}</Alert>}
            <TextField label="E-Mail-Adresse" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Wird gesendet …' : 'Link anfordern'}</Button>
            <p className="text-center text-sm"><Link to="/anmelden" className="text-teal-700 underline">Zurück zur Anmeldung</Link></p>
          </form>
        )}
      </Card>
    </main>
  );
}
