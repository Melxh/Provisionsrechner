import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { describeError, requireClient, supabase } from '../supabase';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /** true, solange der Benutzer über einen Passwort-Reset-Link angemeldet ist und ein neues Passwort setzen muss. */
  recovery: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<string | null>;
  updatePassword: (password: string) => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(supabase));
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    }).catch(() => active && setLoading(false));

    // Im Callback nur State setzen (keine weiteren Supabase-Aufrufe), um Deadlocks zu vermeiden.
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') setRecovery(false);
      setLoading(false);
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { error } = await requireClient().auth.signInWithPassword({ email: email.trim(), password });
      return error ? describeError(error) : null;
    } catch (e) { return describeError(e); }
  }, []);

  const signOut = useCallback(async () => {
    try { await requireClient().auth.signOut(); } finally { setSession(null); setRecovery(false); }
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    try {
      const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}passwort-neu`;
      const { error } = await requireClient().auth.resetPasswordForEmail(email.trim(), { redirectTo });
      return error ? describeError(error) : null;
    } catch (e) { return describeError(e); }
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    try {
      const { error } = await requireClient().auth.updateUser({ password });
      if (error) return describeError(error);
      setRecovery(false);
      return null;
    } catch (e) { return describeError(e); }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ session, user: session?.user ?? null, loading, recovery, signIn, signOut, requestPasswordReset, updatePassword }),
    [session, loading, recovery, signIn, signOut, requestPasswordReset, updatePassword],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth muss innerhalb von AuthProvider verwendet werden.');
  return ctx;
}
