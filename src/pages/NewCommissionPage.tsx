import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth/AuthProvider';
import { useRules } from '../lib/rules/RulesProvider';
import { useTier } from '../lib/tier/TierProvider';
import { describeError } from '../lib/supabase';
import { buildSnapshot, calculateCommission } from '../lib/commission/calculate';
import { computeOrderState } from '../lib/commission/status';
import { ADDON_LABELS, PROJECT_TYPE_LABELS, STATUS_LABELS, TIER_LABELS } from '../lib/commission/labels';
import { formatEuro, formatPercent } from '../lib/commission/money';
import { PERCENT_ADDON_KEYS, PROJECT_TYPES, TIERS } from '../lib/commission/types';
import type { OwnLeadKind, PaymentModel, ProjectType, Tier } from '../lib/commission/types';
import {
  buildOrderPayload, includesHeatPump, includesPv, newAddonRow, newAdjustmentRow, newOrderForm, parseOrderForm, todayIso,
} from '../lib/orders/orderForm';
import type { AddonKey, OrderFormState } from '../lib/orders/orderForm';
import {
  ATTACHMENT_KIND_LABELS, MAX_FILES_PER_UPLOAD, formatFileSize, guessAttachmentKind, sniffMime, validateFileMeta,
} from '../lib/orders/files';
import type { AllowedMime, AttachmentKind } from '../lib/orders/files';
import { createOrder, uploadAttachment } from '../lib/orders/ordersRepo';
import CalculationBreakdown from '../components/CalculationBreakdown';
import { Alert, Button, Card, SelectField, Spinner, TextAreaField, TextField, YesNo } from '../components/ui';

interface PendingFile {
  id: string;
  file: File;
  mime: AllowedMime;
  kind: AttachmentKind;
  status: 'pending' | 'uploading' | 'done' | 'error';
  progress: number;
  error?: string;
}

/** Fehler, die erst nach einem Speicherversuch angezeigt werden (leere Pflichtfelder). */
const HIDDEN_UNTIL_SUBMIT = new Set(['customerName', 'ownLeadConfirmed']);

const PAYMENT_LABELS: Record<PaymentModel, string> = {
  regular: 'Regulär',
  prepayment: 'Vollständige Vorkasse',
  custom: 'Individuell abweichend',
};

function Section({ letter, title, children }: { letter: string; title: string; children: ReactNode }) {
  return (
    <Card>
      <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-navy-800">
        <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded bg-violet-100 text-xs text-violet-600">{letter}</span>
        {title}
      </h2>
      {children}
    </Card>
  );
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export default function NewCommissionPage() {
  const { user } = useAuth();
  const { rules, version, ruleSetId, loading: rulesLoading, error: rulesError } = useRules();
  const { tier: currentTier, loading: tierLoading } = useTier();

  const [form, setForm] = useState<OrderFormState>(() => newOrderForm(currentTier, todayIso()));
  const [tierTouched, setTierTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [savedOrderId, setSavedOrderId] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // Die globale Stufe ist nur der Standardwert, solange sie für diesen Auftrag nicht manuell geändert wurde.
  useEffect(() => {
    if (!tierTouched && !tierLoading) setForm((f) => ({ ...f, tier: currentTier }));
  }, [currentTier, tierLoading, tierTouched]);

  const set = <K extends keyof OrderFormState>(key: K, value: OrderFormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const parsed = useMemo(() => parseOrderForm(form), [form]);
  const outcome = useMemo(() => (parsed.input ? calculateCommission(parsed.input, rules) : null), [parsed.input, rules]);
  const result = outcome && outcome.ok ? outcome.result : null;

  const statusPreview = useMemo(() => {
    if (!result || !parsed.meta) return null;
    try {
      return computeOrderState({
        commissionTotalCents: result.totalCents,
        paymentModel: parsed.meta.paymentModel,
        customThresholdBps: parsed.meta.customThresholdBps,
        customerPaidBps: parsed.meta.customerPaidBps,
        payouts: [],
      }, rules);
    } catch { return null; }
  }, [result, parsed.meta, rules]);

  const visible = (key: string): string | undefined =>
    parsed.errors[key] && (submitted || !HIDDEN_UNTIL_SUBMIT.has(key)) ? parsed.errors[key] : undefined;

  const pv = includesPv(form.projectType);
  const hp = includesHeatPump(form.projectType);
  const ownLeadAllowed = form.projectType !== 'other';
  const canSave = Boolean(parsed.input && parsed.meta && result && !rulesError);

  // ---------------- Dateien ----------------
  async function onFilesSelected(list: FileList | null) {
    if (!list) return;
    setFileError(null);
    const next: PendingFile[] = [];
    const problems: string[] = [];
    for (const file of Array.from(list)) {
      if (files.length + next.length >= MAX_FILES_PER_UPLOAD) { problems.push(`Maximal ${MAX_FILES_PER_UPLOAD} Dateien pro Auftrag.`); break; }
      const metaProblem = validateFileMeta(file);
      if (metaProblem) { problems.push(`${file.name}: ${metaProblem}`); continue; }
      const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      const mime = sniffMime(head);
      if (!mime) { problems.push(`${file.name}: Der Dateiinhalt entspricht keinem erlaubten Format (PDF, JPG, PNG).`); continue; }
      next.push({ id: crypto.randomUUID(), file, mime, kind: guessAttachmentKind(file.name), status: 'pending', progress: 0 });
    }
    if (next.length) setFiles((f) => [...f, ...next]);
    if (problems.length) setFileError(problems.join(' '));
  }

  const patchFile = (id: string, patch: Partial<PendingFile>) => setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  async function uploadAll(orderId: string, list: PendingFile[]) {
    if (!user) return;
    for (const pf of list) {
      if (pf.status === 'done') continue;
      patchFile(pf.id, { status: 'uploading', progress: 0, error: undefined });
      try {
        await uploadAttachment({ userId: user.id, orderId, fileId: pf.id, file: pf.file, mime: pf.mime, kind: pf.kind }, (p) => patchFile(pf.id, { progress: p }));
        patchFile(pf.id, { status: 'done', progress: 100 });
      } catch (e) {
        patchFile(pf.id, { status: 'error', error: describeError(e) });
      }
    }
  }

  // ---------------- Speichern ----------------
  function onSaveClick() {
    setSubmitted(true);
    if (!canSave) { topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    setConfirming(true);
  }

  async function doSave() {
    if (saving || !parsed.input || !parsed.meta || !outcome || !outcome.ok) return;
    setSaving(true);
    setSaveError(null);
    let orderId: string;
    try {
      const snapshot = buildSnapshot(parsed.input, rules, outcome, new Date(), version || null);
      orderId = await createOrder(buildOrderPayload(parsed.meta, parsed.input, outcome.result, snapshot, ruleSetId));
    } catch (e) {
      setSaveError(describeError(e));
      setSaving(false);
      return;
    }
    setConfirming(false);
    setSavedOrderId(orderId);
    await uploadAll(orderId, files);
    setSaving(false);
  }

  function resetForm() {
    setForm(newOrderForm(currentTier, todayIso()));
    setTierTouched(false);
    setSubmitted(false);
    setFiles([]);
    setFileError(null);
    setSaveError(null);
    setSavedOrderId(null);
  }

  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) setConfirming(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming, saving]);

  if (rulesLoading || tierLoading) return <Spinner label="Formular wird vorbereitet …" />;

  // ---------------- Nach dem Speichern ----------------
  if (savedOrderId) {
    const failed = files.filter((f) => f.status === 'error');
    const running = files.some((f) => f.status === 'uploading');
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-navy-800">Neue Provision</h1>
        <Alert kind="success" title="Auftrag gespeichert">
          Der Auftrag ist dauerhaft in der Datenbank gespeichert{result ? ` – Gesamtprovision ${formatEuro(result.totalCents)}` : ''}.
        </Alert>
        {files.length > 0 && (
          <Card title="Dokumente">
            <ul className="space-y-2 text-sm">
              {files.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{f.file.name} <span className="text-anthracite-600">({ATTACHMENT_KIND_LABELS[f.kind]})</span></span>
                  <span className={f.status === 'error' ? 'text-red-700' : 'text-anthracite-600'}>
                    {f.status === 'done' && 'Hochgeladen'}
                    {f.status === 'uploading' && `Wird hochgeladen … ${f.progress} %`}
                    {f.status === 'error' && (f.error ?? 'Fehlgeschlagen')}
                    {f.status === 'pending' && 'Wartet'}
                  </span>
                </li>
              ))}
            </ul>
            {failed.length > 0 && !running && (
              <div className="mt-3 space-y-2">
                <Alert kind="warning">Der Auftrag ist gespeichert, aber nicht alle Dokumente konnten hochgeladen werden.</Alert>
                <Button onClick={() => void uploadAll(savedOrderId, failed)}>Fehlgeschlagene Uploads wiederholen</Button>
              </div>
            )}
          </Card>
        )}
        <div className="flex flex-wrap gap-3">
          <Button onClick={resetForm} disabled={running}>Weiteren Auftrag erfassen</Button>
          <Link to="/" className="inline-flex items-center rounded-md px-4 py-2 text-sm font-medium text-navy-800 ring-1 ring-slate-300 hover:bg-slate-50">Zum Dashboard</Link>
        </div>
      </div>
    );
  }

  const addonOptions: Array<{ key: AddonKey; label: string }> = [
    ...PERCENT_ADDON_KEYS.map((k) => ({ key: k as AddonKey, label: ADDON_LABELS[k] })),
    { key: 'maintenance_package', label: `${ADDON_LABELS.maintenance_package} (Festbetrag ${formatEuro(rules.maintenancePackageCents)})` },
    { key: 'custom', label: 'Weiteres Zusatzprodukt (benutzerdefiniert)' },
  ];

  const errorList = submitted ? Object.entries(parsed.errors).filter(([k]) => parsed.errors[k]) : [];

  return (
    <div className="space-y-6">
      <div ref={topRef} />
      <h1 className="text-2xl font-semibold text-navy-800">Neue Provision</h1>

      {rulesError && <Alert kind="error" title="Speichern gesperrt">Die Provisionsregeln konnten nicht geladen werden. Bitte Seite neu laden.</Alert>}
      {submitted && !canSave && (
        <Alert kind="error" title="Bitte Eingaben prüfen">
          {errorList.length > 0 ? 'Einige Felder sind unvollständig oder ungültig – sie sind unten markiert.' : outcome && !outcome.ok ? outcome.errors.map((e) => e.message).join(' ') : 'Die Berechnung ist noch nicht möglich.'}
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-6">
          {/* A */}
          <Section letter="A" title="Kundendaten und Projekt">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Kundenname *" value={form.customerName} onChange={(e) => set('customerName', e.target.value)} error={visible('customerName')} autoComplete="off" className="sm:col-span-2" />
              <SelectField label="Projektart *" value={form.projectType} onChange={(e) => set('projectType', e.target.value as ProjectType)}>
                {PROJECT_TYPES.map((p) => <option key={p} value={p}>{PROJECT_TYPE_LABELS[p]}</option>)}
              </SelectField>
              <SelectField label="Provisionsstatus zum Vertragsabschluss *" value={form.tier} onChange={(e) => { setTierTouched(true); set('tier', e.target.value as Tier); }}>
                {TIERS.map((t) => <option key={t} value={t}>{TIER_LABELS[t]} ({formatPercent(rules.baseRateBps[t])})</option>)}
              </SelectField>
              <TextField label="Datum des Vertragsabschlusses *" type="date" value={form.contractDate} onChange={(e) => set('contractDate', e.target.value)} error={visible('contractDate')} />
              <TextField label="Datum der Auftragsbestätigung" type="date" value={form.confirmationDate} onChange={(e) => set('confirmationDate', e.target.value)} error={visible('confirmationDate')} />
              <TextField label="Auftrags- oder Angebotsnummer" value={form.orderNumber} onChange={(e) => set('orderNumber', e.target.value)} error={visible('orderNumber')} />
              <TextField label="Voraussichtliche Auszahlung" type="date" value={form.expectedPayoutDate} onChange={(e) => set('expectedPayoutDate', e.target.value)} error={visible('expectedPayoutDate')} hint="Nicht das Vertragsdatum – wann die Provision voraussichtlich ausgezahlt wird." />
              <TextAreaField label="Notiz" value={form.note} onChange={(e) => set('note', e.target.value)} error={visible('note')} className="sm:col-span-2" />
            </div>
            <p className="mt-3 text-xs text-anthracite-600">Die Stufe wird mit dem Auftrag gespeichert. Spätere Änderungen der aktuellen Stufe oben verändern ihn nicht.</p>
          </Section>

          {/* B + C */}
          <Section letter="B" title="Netto-Anlagenpreis und Überverkauf">
            {pv ? (
              <div className="space-y-4">
                <Alert kind="info" title="Welcher Preis wird verwendet?">
                  Den <strong>Netto-Anlagenpreis nach Rabatten, ohne</strong> den Überverkaufsaufschlag eintragen. Der Überverkauf kommt zusätzlich als Eurobetrag hinzu – so wird derselbe Aufschlag nicht doppelt gezählt.
                  Der Überverkauf in % bezieht sich auf diesen Netto-Anlagenpreis.
                </Alert>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label="Netto-Anlagenpreis (ohne Überverkauf) in € *" inputMode="decimal" value={form.netPrice} onChange={(e) => set('netPrice', e.target.value)} error={visible('netPrice')} placeholder="20.000" />
                  <TextField label="Überverkauf in €" inputMode="decimal" value={form.overprice} onChange={(e) => set('overprice', e.target.value)} error={visible('overprice')} placeholder="2.000"
                    hint={result?.overprice ? `= ${formatPercent(result.overprice.overpricePercentBps)} des Netto-Anlagenpreises` : `Zulässig bis ${formatPercent(rules.overpriceCapBps)}`} />
                </div>
                {result?.overprice?.capped && (
                  <Alert kind="warning" title="Überverkauf über dem Grenzwert">
                    Angerechnet werden höchstens {formatEuro(result.overprice.creditableCents)} ({formatPercent(rules.overpriceCapBps)}). Die übrigen {formatEuro(result.overprice.excessCents)} stehen Energieversum zu.
                  </Alert>
                )}
                {form.projectType === 'pv_heat_pump' && <Alert kind="info">Bei PV + Wärmepumpe nur Preis und Überverkauf der PV-Anlage eintragen; die Wärmepumpe unten als Zusatzprodukt erfassen.</Alert>}
              </div>
            ) : (
              <Alert kind="info">
                Grundprovision auf den Anlagenpreis und Überverkauf gelten nur für Photovoltaik. Die Provision für Wärmepumpen und sonstige Aufträge entsteht über die Zusatzprodukte weiter unten (z. B. „Wärmepumpe, 5–18 kW“ mit dem Nettowert).
              </Alert>
            )}
          </Section>

          {/* D */}
          <Section letter="D" title="Eigenlead">
            {ownLeadAllowed ? (
              <div className="space-y-4">
                <YesNo legend="Eigenlead" value={form.ownLead} onChange={(v) => set('ownLead', v)}
                  hint={`Zusatz: Photovoltaik ${formatEuro(rules.ownLeadPvCents)}, Wärmepumpe ${formatEuro(rules.ownLeadHeatPumpCents)}. Ohne Eigenlead wird nichts angesetzt.`} />
                {form.ownLead && (
                  <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3">
                    <p className="text-sm text-amber-900">Leads, die von Energieversum vermittelt wurden, sind <strong>kein</strong> Eigenlead.</p>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" className="mt-0.5 h-4 w-4" checked={form.ownLeadConfirmed} onChange={(e) => set('ownLeadConfirmed', e.target.checked)} />
                      <span>Ich bestätige: Der Lead stammt von mir und wurde nicht von Energieversum vermittelt.</span>
                    </label>
                    {visible('ownLeadConfirmed') && <p className="text-xs text-red-700">{visible('ownLeadConfirmed')}</p>}
                    {form.projectType === 'pv_heat_pump' && (
                      <fieldset>
                        <legend className="mb-1 text-sm font-medium">Welcher Eigenlead-Zusatz wird angesetzt?</legend>
                        {([['pv', `Nur Photovoltaik (${formatEuro(rules.ownLeadPvCents)})`], ['heat_pump', `Nur Wärmepumpe (${formatEuro(rules.ownLeadHeatPumpCents)})`], ['both', `Beide getrennt (${formatEuro(rules.ownLeadPvCents + rules.ownLeadHeatPumpCents)})`]] as Array<[OwnLeadKind, string]>).map(([v, text]) => (
                          <label key={v} className="mr-4 inline-flex items-center gap-2 text-sm">
                            <input type="radio" name="ownLeadKind" checked={form.ownLeadKind === v} onChange={() => set('ownLeadKind', v)} /> {text}
                          </label>
                        ))}
                        {submitted && !form.ownLeadKind && <p className="mt-1 text-xs text-red-700">Bitte ausdrücklich wählen.</p>}
                      </fieldset>
                    )}
                  </div>
                )}
              </div>
            ) : <p className="text-sm text-anthracite-600">Für sonstige Aufträge ist kein Eigenlead-Zusatz vorgesehen.</p>}
          </Section>

          {/* E + F */}
          <Section letter="E" title="PV Secure / Premium Plus und Bauleiter">
            <div className="grid gap-5 sm:grid-cols-2">
              <YesNo legend="PV Secure Photovoltaik / Premium Plus" value={form.pvSecurePv} onChange={(v) => set('pvSecurePv', v)} hint={`+ ${formatEuro(rules.pvSecurePvCents)}`} />
              <YesNo legend="PV Secure Wärmepumpe" value={form.pvSecureHeatPump} onChange={(v) => set('pvSecureHeatPump', v)} hint={`+ ${formatEuro(rules.pvSecureHeatPumpCents)}`} />
              <YesNo legend="Bauleiter gebucht" value={form.siteManager} onChange={(v) => set('siteManager', v)} hint={`Abzug − ${formatEuro(rules.siteManagerDeductionCents)} netto`} />
            </div>
            {form.pvSecurePv && !pv && <p className="mt-3 text-xs text-amber-900">Hinweis: PV Secure Photovoltaik bei einem Projekt ohne Photovoltaik – bitte prüfen.</p>}
            {form.pvSecureHeatPump && !hp && <p className="mt-3 text-xs text-amber-900">Hinweis: PV Secure Wärmepumpe bei einem Projekt ohne Wärmepumpe – bitte prüfen.</p>}
          </Section>

          {/* G */}
          <Section letter="G" title="Zusatzprodukte und Anpassungen">
            <p className="mb-3 text-sm text-anthracite-600">Die Provision wird nur auf den jeweiligen Nettowert des Produkts berechnet, nicht auf den Gesamtpreis.</p>
            <div className="space-y-3">
              {form.addons.map((row) => {
                const k = `addons.${row.id}`;
                const patch = (p: Partial<typeof row>) => set('addons', form.addons.map((r) => (r.id === row.id ? { ...r, ...p } : r)));
                return (
                  <div key={row.id} className="grid gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
                    <SelectField label="Produkt" value={row.key} onChange={(e) => patch({ key: e.target.value as AddonKey })}>
                      {addonOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </SelectField>
                    {row.key === 'maintenance_package' ? (
                      <TextField label="Anzahl" inputMode="numeric" value={row.quantity} onChange={(e) => patch({ quantity: e.target.value })} error={visible(`${k}.quantity`)} />
                    ) : (
                      <TextField label="Nettowert in €" inputMode="decimal" value={row.netValue} onChange={(e) => patch({ netValue: e.target.value })} error={visible(`${k}.netValue`)} />
                    )}
                    {row.key === 'custom' ? (
                      <TextField label="Provisionssatz in %" inputMode="decimal" value={row.rate} onChange={(e) => patch({ rate: e.target.value })} error={visible(`${k}.rate`)} />
                    ) : (
                      <div className="pt-6 text-sm text-anthracite-600">
                        {row.key === 'maintenance_package' ? 'Festbetrag' : `${formatPercent(rules.addonRatesBps[row.key][form.tier])} (${TIER_LABELS[form.tier]})`}
                      </div>
                    )}
                    <Button variant="ghost" className="sm:mt-6" onClick={() => set('addons', form.addons.filter((r) => r.id !== row.id))} aria-label="Produkt entfernen">Entfernen</Button>
                    {row.key === 'custom' && (
                      <TextField label="Bezeichnung" value={row.label} onChange={(e) => patch({ label: e.target.value })} error={visible(`${k}.label`)} className="sm:col-span-4" />
                    )}
                  </div>
                );
              })}
              <Button variant="secondary" onClick={() => set('addons', [...form.addons, newAddonRow()])}>Zusatzprodukt hinzufügen</Button>
            </div>

            <h3 className="mb-2 mt-6 text-sm font-semibold text-anthracite-700">Sonstige Anpassungen (ausdrücklich erfasst)</h3>
            <div className="space-y-3">
              {form.adjustments.map((row) => {
                const k = `adjustments.${row.id}`;
                const patch = (p: Partial<typeof row>) => set('adjustments', form.adjustments.map((r) => (r.id === row.id ? { ...r, ...p } : r)));
                return (
                  <div key={row.id} className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-start">
                    <TextField label="Begründung" value={row.label} onChange={(e) => patch({ label: e.target.value })} error={visible(`${k}.label`)} />
                    <TextField label="Betrag in € (Abzug mit −)" inputMode="decimal" value={row.amount} onChange={(e) => patch({ amount: e.target.value })} error={visible(`${k}.amount`)} />
                    <Button variant="ghost" className="sm:mt-6" onClick={() => set('adjustments', form.adjustments.filter((r) => r.id !== row.id))}>Entfernen</Button>
                  </div>
                );
              })}
              <Button variant="secondary" onClick={() => set('adjustments', [...form.adjustments, newAdjustmentRow()])}>Anpassung hinzufügen</Button>
            </div>
          </Section>

          {/* Zahlung */}
          <Section letter="Z" title="Zahlungsfortschritt des Kunden">
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField label="Zahlungsbedingung" value={form.paymentModel} onChange={(e) => set('paymentModel', e.target.value as PaymentModel)}>
                {(Object.keys(PAYMENT_LABELS) as PaymentModel[]).map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}
              </SelectField>
              {form.paymentModel === 'custom' && (
                <TextField label="Schwelle in %" inputMode="decimal" value={form.customThreshold} onChange={(e) => set('customThreshold', e.target.value)} error={visible('customThreshold')} />
              )}
              <TextField label="Bereits bezahlt in %" inputMode="decimal" value={form.customerPaid} onChange={(e) => set('customerPaid', e.target.value)} error={visible('customerPaid')}
                hint={`Auszahlungsberechtigt ab ${formatPercent(form.paymentModel === 'prepayment' ? rules.payoutThresholds.prepaymentBps : form.paymentModel === 'regular' ? rules.payoutThresholds.regularBps : parsed.meta?.customThresholdBps ?? 0)}`} />
            </div>
            {statusPreview && (
              <p className="mt-3 text-sm">Voraussichtlicher Provisionsstatus: <strong>{STATUS_LABELS[statusPreview.status]}</strong></p>
            )}
          </Section>

          {/* H */}
          <Section letter="H" title="Dokumente">
            <p className="mb-3 text-sm text-anthracite-600">Angebot, Auftragsbestätigung und weitere Dokumente (PDF, JPG, PNG, je max. 10 MB). Sie werden privat gespeichert und nach dem Speichern des Auftrags hochgeladen.</p>
            <input
              type="file" multiple accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              aria-label="Dokumente auswählen"
              onChange={(e) => { void onFilesSelected(e.target.files); e.target.value = ''; }}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-navy-800 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-navy-700"
            />
            {fileError && <div className="mt-3"><Alert kind="error">{fileError}</Alert></div>}
            {files.length > 0 && (
              <ul className="mt-3 divide-y divide-slate-100 text-sm">
                {files.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="min-w-0 flex-1 truncate" title={f.file.name}>{f.file.name} <span className="text-anthracite-600">({formatFileSize(f.file.size)})</span></span>
                    <label className="sr-only" htmlFor={`kind-${f.id}`}>Dokumentart für {f.file.name}</label>
                    <select id={`kind-${f.id}`} value={f.kind} onChange={(e) => patchFile(f.id, { kind: e.target.value as AttachmentKind })} className="rounded-md border border-slate-300 px-2 py-1 text-sm">
                      {(Object.keys(ATTACHMENT_KIND_LABELS) as AttachmentKind[]).map((k) => <option key={k} value={k}>{ATTACHMENT_KIND_LABELS[k]}</option>)}
                    </select>
                    <Button variant="ghost" onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}>Entfernen</Button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        {/* Live-Berechnung */}
        <aside aria-label="Live-Berechnung" className="lg:sticky lg:top-4 lg:self-start">
          <Card title="Berechnung">
            {result ? (
              <CalculationBreakdown result={result} netPriceCents={pv ? parsed.input?.netPriceCents : undefined} />
            ) : outcome && !outcome.ok ? (
              <Alert kind="warning" title="Noch nicht berechenbar">{outcome.errors.map((e) => e.message).join(' ')}</Alert>
            ) : (
              <p className="text-sm text-anthracite-600">Bitte die markierten Eingaben korrigieren, dann erscheint die Berechnung.</p>
            )}
            <Button className="mt-4 w-full" onClick={onSaveClick} disabled={saving || Boolean(rulesError)}>Auftrag speichern</Button>
            {submitted && !canSave && <p role="alert" className="mt-2 text-xs text-red-700">Speichern nicht möglich – bitte Eingaben prüfen.</p>}
          </Card>
        </aside>
      </div>

      {/* Vorschau vor dem Speichern */}
      {confirming && result && parsed.meta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <h2 id="confirm-title" className="text-lg font-semibold text-navy-800">Vorschau: Auftrag speichern?</h2>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-anthracite-600">Kunde</dt><dd>{parsed.meta.customerName}</dd>
              <dt className="text-anthracite-600">Projektart</dt><dd>{PROJECT_TYPE_LABELS[parsed.meta.projectType]}</dd>
              <dt className="text-anthracite-600">Vertragsabschluss</dt><dd>{formatDate(parsed.meta.contractDate)}</dd>
              <dt className="text-anthracite-600">Stufe</dt><dd>{TIER_LABELS[parsed.meta.tier]}</dd>
              <dt className="text-anthracite-600">Zahlungsstand</dt><dd>{formatPercent(parsed.meta.customerPaidBps)} bezahlt{statusPreview ? ` · ${STATUS_LABELS[statusPreview.status]}` : ''}</dd>
              <dt className="text-anthracite-600">Dokumente</dt><dd>{files.length === 0 ? 'keine' : `${files.length} Datei(en)`}</dd>
            </dl>
            <div className="mt-4"><CalculationBreakdown result={result} netPriceCents={pv ? parsed.input?.netPriceCents : undefined} /></div>
            <p className="mt-3 text-xs text-anthracite-600">Die verwendeten Regeln (Version {version === 0 ? 'Standardwerte' : version}) werden mit dem Auftrag gespeichert und später nicht automatisch neu berechnet.</p>
            {saveError && <div className="mt-3"><Alert kind="error">{saveError}</Alert></div>}
            <div className="mt-4 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setConfirming(false)} disabled={saving}>Zurück</Button>
              <Button onClick={() => void doSave()} disabled={saving} autoFocus>{saving ? 'Wird gespeichert …' : 'Jetzt speichern'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
