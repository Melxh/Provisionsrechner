import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../commission/rules.ts';
import { formKeys, formToRules, formsEqual, rulesToForm } from './ruleForm.ts';

describe('Regelformular', () => {
  it('Standardregeln überstehen Hin- und Rückumwandlung unverändert', () => {
    const result = formToRules(rulesToForm(DEFAULT_RULES));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rules).toEqual(DEFAULT_RULES);
  });

  it('zeigt deutsche Schreibweise an', () => {
    const f = rulesToForm(DEFAULT_RULES);
    expect(f[formKeys.cap]).toBe('12,5');
    expect(f[formKeys.base('starter')]).toBe('7');
    expect(f[formKeys.ownLeadPv]).toBe('1500,00');
    expect(f[formKeys.siteManager]).toBe('295,00');
  });

  it('übernimmt geänderte Werte', () => {
    const f = { ...rulesToForm(DEFAULT_RULES), [formKeys.siteManager]: '300', [formKeys.cap]: '10' };
    const r = formToRules(f);
    expect(r.ok && r.rules.siteManagerDeductionCents).toBe(30_000);
    expect(r.ok && r.rules.overpriceCapBps).toBe(1000);
  });

  it('meldet fehlerhafte Felder einzeln', () => {
    const f = { ...rulesToForm(DEFAULT_RULES), [formKeys.cap]: '120', [formKeys.siteManager]: 'abc', [formKeys.ownLeadPv]: '-5' };
    const r = formToRules(f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual([formKeys.cap, formKeys.ownLeadPv, formKeys.siteManager].sort());
  });

  it('erkennt Änderungen', () => {
    const a = rulesToForm(DEFAULT_RULES);
    expect(formsEqual(a, { ...a })).toBe(true);
    expect(formsEqual(a, { ...a, [formKeys.cap]: '13' })).toBe(false);
  });
});
