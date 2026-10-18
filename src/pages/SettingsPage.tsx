import { useEffect, useMemo, useState } from 'react';
import { useRules } from '../lib/rules/RulesProvider';
import { DEFAULT_RULES } from '../lib/commission/rules';
import { ADDON_LABELS, TIER_LABELS } from '../lib/commission/labels';
import { PERCENT_ADDON_KEYS, TIERS } from '../lib/commission/types';
import type { Tier } from '../lib/commission/types';
import { formKeys, formToRules, formsEqual, rulesToForm } from '../lib/rules/ruleForm';
import type { RuleForm } from '../lib/rules/ruleForm';
import { Alert, Button, Card, Spinner, inputClass } from '../components/ui';

function Cell({ id, label, unit, form, errors, onChange }: {
  id: string; label: string; unit: '%' | '€'; form: RuleForm; errors: Record<string, string>; onChange: (key: string, value: string) => void;
}) {
  return (
    <div>
      <div className="relative">
        <input
          inputMode="decimal"
          aria-label={label}
          aria-invalid={errors[id] ? true : undefined}
          value={form[id] ?? ''}
          onChange={(e) => onChange(id, e.target.value)}
          className={`${inputClass} pr-8 text-right tabular-nums`}
        />
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-anthracite-600">{unit}</span>
      </div>
      {errors[id] && <p className="mt-1 text-xs text-red-700">{errors[id]}</p>}
    </div>
  );
}

export default function SettingsPage() {
  const { rules, version, loading, error: loadError, saveNewVersion } = useRules();
  const [form, setForm] = useState<RuleForm>(() => rulesToForm(rules));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const saved = useMemo(() => rulesToForm(rules), [rules]);
  useEffect(() => { setForm(rulesToForm(rules)); }, [rules]);
  const dirty = !formsEqual(form, saved);

  if (loading) return <Spinner label="Einstellungen werden geladen …" />;

  const change = (key: string, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setMessage(null);
  };
  const cell = (id: string, label: string, unit: '%' | '€') => (
    <Cell id={id} label={label} unit={unit} form={form} errors={errors} onChange={change} />
  );

  async function onSave() {
    setMessage(null);
    const result = formToRules(form);
    if (!result.ok) {
      setErrors(result.errors);
      setMessage({ kind: 'error', text: result.errors._form ?? 'Bitte die markierten Felder korrigieren.' });
      return;
    }
    setErrors({});
    setSaving(true);
    const err = await saveNewVersion(result.rules);
    setSaving(false);
    setMessage(err ? { kind: 'error', text: err } : { kind: 'success', text: 'Als neue Regelversion gespeichert. Sie gilt für neue Berechnungen.' });
  }

  // Bewusst eine Funktion statt einer Komponente: eine in render definierte Komponente würde bei jedem Tastendruck neu montiert (Fokusverlust).
  const tierGrid = ({ title, rows, unit }: { title: string; rows: Array<{ id: (t: Tier) => string; label: string }>; unit: '%' }) => {
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="text-left text-anthracite-600">
              <th scope="col" className="py-2 pr-3 font-medium">{title}</th>
              {TIERS.map((t) => <th key={t} scope="col" className="px-1 py-2 text-right font-medium">{TIER_LABELS[t]}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row" className="py-2 pr-3 text-left font-normal">{r.label}</th>
                {TIERS.map((t) => <td key={t} className="px-1 py-1.5">{cell(r.id(t), `${r.label} ${TIER_LABELS[t]}`, unit)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const single = (id: string, label: string, unit: '%' | '€') => (
    <div className="grid items-center gap-2 sm:grid-cols-[1fr_10rem]">
      <span className="text-sm">{label}</span>
      {cell(id, label, unit)}
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-navy-800">Einstellungen</h1>
        <p className="mt-1 text-sm text-anthracite-600">
          Provisionsregeln · aktuelle Regelversion: {version === 0 ? 'Standardwerte (noch nichts gespeichert)' : version}
        </p>
      </div>

      <Alert kind="info" title="Gilt nur für neue Berechnungen">
        Jede Speicherung legt eine neue, unveränderliche Regelversion an. Bereits gespeicherte Aufträge behalten ihre ursprünglichen Werte und werden nicht automatisch neu berechnet.
      </Alert>
      {loadError && <Alert kind="error">{loadError}</Alert>}
      {message && <Alert kind={message.kind}>{message.text}</Alert>}

      <Card title="Grundprovision und Überverkauf">
        <div className="space-y-6">
          {tierGrid({ title: 'Grundprovision', unit: '%', rows: [{ id: formKeys.base, label: 'Grundprovision' }] })}
          {tierGrid({ title: 'Anteil am Überverkauf (für mich)', unit: '%', rows: [{ id: formKeys.share, label: 'Überverkaufsanteil' }] })}
          {single(formKeys.cap, 'Zulässiger Überverkauf (in % des Netto-Anlagenpreises)', '%')}
        </div>
      </Card>

      <Card title="Zusatzprodukte (Provisionssatz je Stufe)">
        {tierGrid({
          title: 'Produkt',
          unit: '%',
          rows: PERCENT_ADDON_KEYS.map((k) => ({ id: (t: Tier) => formKeys.addon(k, t), label: ADDON_LABELS[k] })),
        })}
      </Card>

      <Card title="Festbeträge und Abzüge">
        <div className="space-y-3">
          {single(formKeys.ownLeadPv, 'Eigenlead Photovoltaik (Zusatz)', '€')}
          {single(formKeys.ownLeadHp, 'Eigenlead Wärmepumpe (Zusatz)', '€')}
          {single(formKeys.pvSecurePv, 'PV Secure Photovoltaik / Premium Plus', '€')}
          {single(formKeys.pvSecureHp, 'PV Secure Wärmepumpe', '€')}
          {single(formKeys.maintenance, 'Wartungspaket (Festbetrag)', '€')}
          {single(formKeys.siteManager, 'Bauleiter-Abzug (netto)', '€')}
        </div>
      </Card>

      <Card title="Auszahlungsberechtigung" description="Ab welchem Zahlungsstand des Kunden die Provision als „offen“ gilt.">
        <div className="space-y-3">
          {single(formKeys.thrRegular, 'Reguläre Zahlungsbedingung', '%')}
          {single(formKeys.thrPrepayment, 'Vollständige Vorkasse', '%')}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void onSave()} disabled={!dirty || saving}>{saving ? 'Wird gespeichert …' : 'Als neue Regelversion speichern'}</Button>
        <Button variant="secondary" onClick={() => { setForm(saved); setErrors({}); setMessage(null); }} disabled={!dirty || saving}>Änderungen verwerfen</Button>
        <Button variant="ghost" onClick={() => { setForm(rulesToForm(DEFAULT_RULES)); setErrors({}); setMessage(null); }} disabled={saving}>Standardwerte einsetzen</Button>
      </div>
    </div>
  );
}
