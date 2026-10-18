import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/** Nur URL und öffentlicher (Publishable/Anon-)Key – Schutz erfolgt über Login + Row Level Security. */
export const isSupabaseConfigured = Boolean(url && key && /^https?:\/\//.test(url));

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, key as string, {
      auth: {
        flowType: 'pkce', // Passwort-Reset-Link kommt als ?code=… (kompatibel mit Unterpfad-Hosting)
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function requireClient(): SupabaseClient {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert.');
  return supabase;
}

/** Verständliche deutsche Fehlermeldung, ohne technische Details oder Kundendaten. */
export function describeError(error: unknown): string {
  const msg = (error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as { message: unknown }).message) : '').toLowerCase();
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('network request failed')) {
    return 'Keine Verbindung zu Supabase. Bitte Internetverbindung und Konfiguration prüfen.';
  }
  if (msg.includes('invalid login credentials')) return 'E-Mail-Adresse oder Passwort ist falsch.';
  if (msg.includes('email not confirmed')) return 'Die E-Mail-Adresse ist noch nicht bestätigt.';
  if (msg.includes('rate limit') || msg.includes('too many')) return 'Zu viele Versuche. Bitte einen Moment warten und erneut probieren.';
  if (msg.includes('jwt') || msg.includes('not authenticated')) return 'Die Sitzung ist abgelaufen. Bitte erneut anmelden.';
  if (msg.includes('row-level security') || msg.includes('permission denied')) return 'Keine Berechtigung für diese Aktion.';
  if (msg.includes('password') && msg.includes('characters')) return 'Das Passwort ist zu kurz.';
  return 'Es ist ein Fehler aufgetreten. Bitte erneut versuchen.';
}
