import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Tier } from '../commission/types';
import { TIERS } from '../commission/types';
import { describeError, requireClient } from '../supabase';
import { useAuth } from '../auth/AuthProvider';

interface TierContextValue {
  /** Aktuelle Stufe = Standardwert für NEUE Aufträge. Gespeicherte Aufträge behalten ihre eigene Stufe. */
  tier: Tier;
  loading: boolean;
  error: string | null;
  setTier: (tier: Tier) => Promise<void>;
}

const TierContext = createContext<TierContextValue | null>(null);

export function TierProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [tier, setTierState] = useState<Tier>('starter');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      try {
        const { data, error: err } = await requireClient().from('user_settings').select('current_tier').maybeSingle();
        if (err) throw err;
        if (active && data && (TIERS as readonly string[]).includes(data.current_tier)) setTierState(data.current_tier as Tier);
      } catch (e) {
        if (active) setError(describeError(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [user]);

  const setTier = useCallback(async (next: Tier) => {
    if (!user) return;
    const previous = tier;
    setTierState(next);
    setError(null);
    try {
      const { error: err } = await requireClient().from('user_settings').upsert({ user_id: user.id, current_tier: next });
      if (err) throw err;
    } catch (e) {
      setTierState(previous);
      setError(`Stufe konnte nicht gespeichert werden. ${describeError(e)}`);
    }
  }, [tier, user]);

  const value = useMemo(() => ({ tier, loading, error, setTier }), [tier, loading, error, setTier]);
  return <TierContext.Provider value={value}>{children}</TierContext.Provider>;
}

export function useTier(): TierContextValue {
  const ctx = useContext(TierContext);
  if (!ctx) throw new Error('useTier muss innerhalb von TierProvider verwendet werden.');
  return ctx;
}
