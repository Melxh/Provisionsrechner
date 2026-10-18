import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { RuleSet } from '../commission/types';
import { DEFAULT_RULES, validateRuleSet } from '../commission/rules';
import { describeError, requireClient } from '../supabase';
import { useAuth } from '../auth/AuthProvider';

interface RulesContextValue {
  rules: RuleSet;
  /** 0 = noch keine eigene Version gespeichert, es gelten die Standardwerte. */
  version: number;
  loading: boolean;
  error: string | null;
  /** Speichert die Regeln als NEUE, unveränderliche Version. Bestehende Aufträge bleiben unberührt. */
  saveNewVersion: (rules: RuleSet) => Promise<string | null>;
  reload: () => Promise<void>;
}

const RulesContext = createContext<RulesContextValue | null>(null);

export function RulesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [rules, setRules] = useState<RuleSet>(DEFAULT_RULES);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await requireClient()
        .from('rule_sets').select('version, rules').order('version', { ascending: false }).limit(1);
      if (err) throw err;
      const latest = data?.[0];
      if (latest) {
        const problems = validateRuleSet(latest.rules as RuleSet);
        if (problems.length > 0) throw new Error('Gespeicherte Provisionsregeln sind ungültig.');
        setRules(latest.rules as RuleSet);
        setVersion(latest.version as number);
      } else {
        setRules(DEFAULT_RULES);
        setVersion(0);
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (user) void reload(); }, [user, reload]);

  const saveNewVersion = useCallback(async (next: RuleSet): Promise<string | null> => {
    const problems = validateRuleSet(next);
    if (problems.length > 0) return problems.join('; ');
    try {
      const client = requireClient();
      const { data, error: readErr } = await client.from('rule_sets').select('version').order('version', { ascending: false }).limit(1);
      if (readErr) throw readErr;
      const nextVersion = ((data?.[0]?.version as number | undefined) ?? 0) + 1;
      const { error: insErr } = await client.from('rule_sets').insert({ version: nextVersion, rules: next });
      if (insErr) throw insErr;
      setRules(next);
      setVersion(nextVersion);
      return null;
    } catch (e) {
      return describeError(e);
    }
  }, []);

  const value = useMemo(() => ({ rules, version, loading, error, saveNewVersion, reload }), [rules, version, loading, error, saveNewVersion, reload]);
  return <RulesContext.Provider value={value}>{children}</RulesContext.Provider>;
}

export function useRules(): RulesContextValue {
  const ctx = useContext(RulesContext);
  if (!ctx) throw new Error('useRules muss innerhalb von RulesProvider verwendet werden.');
  return ctx;
}
