import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth/AuthProvider';
import { useRules } from '../lib/rules/RulesProvider';
import { describeError } from '../lib/supabase';
import { computeOrderState } from '../lib/commission/status';
import { formatEuro, formatPercent, parseEuroToCents, parsePercentToBps } from '../lib/commission/money';
import { centsToDecimal } from '../lib/commission/csv';
import { PROJECT_TYPE_LABELS, STATUS_LABELS, TIER_LABELS } from '../lib/commission/labels';
import type { CommissionStatus } from '../lib/commission/types';
import { describeAudit } from '../lib/data/auditFormat';
import {
  ATTACHMENT_KIND_LABELS, MAX_FILE_BYTES, ORDER_DOC_KINDS, formatFileSize, guessAttachmentKind, sniffMime, validateFileMeta,
} from '../lib/orders/files';
import type { AttachmentKind } from '../lib/orders/files';
import {
  addPayout, createSignedUrl, deleteAttachment, deleteOrder, deletePayout, loadOrderDetail, setArchived, setCustomerPaid,
  uploadAttachmentTo,
} from '../lib/orders/ordersRepo';
import type { AttachmentFull, OrderDetail } from '../lib/orders/ordersRepo';
import CalculationBreakdown from '../components/CalculationBreakdown';
import ConfirmDialog from '../components/ConfirmDialog';
import { Alert, Button, Card, SelectField, Spinner, TextAreaField, TextField } from '../components/ui';

const STATUS_BADGE: Record<CommissionStatus, string> = {
  expected: 'bg-slate-100 text-anthracite-700',
  open: 'bg-teal-100 text-teal-700',
  paid: 'bg-navy-800 text-white',
};
const PAYMENT_LABELS = { regular: 'Regulär', prepayment: 'Vollständige Vorkasse', custom: 'Individuell abweichend' } as const;

const formatDate = (iso: string) => iso.slice(0, 10).split('-').reverse().join('.');
const formatDateTime = (iso: string) => new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
const todayIso = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (<><dt className="text-anthracite-600">{label}</dt><dd>{children}</dd></>);
}

export default function OrderDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { rules } = useRules();

  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Zahlungsstand
  const [paidInput, setPaidInput] = useState('');
  // Auszahlung
  const [payDate, setPayDate] = useState(todayIso());
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [payFile, setPayFile] = useState<File | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [payProgress, setPayProgress] = useState<number | null>(null);
  // Dokumente
  const [docKind, setDocKind] = useState<AttachmentKind>('other');
  const [docProgress, setDocProgress] = useState<number | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [docLink, setDocLink] = useState<string | null>(null);
  // Dialoge
  const [confirm, setConfirm] = useState<
    | { type: 'delete-order' }
    | { type: 'delete-payout'; payoutId: string; label: string }
    | { type: 'delete-doc'; att: AttachmentFull }
    | { type: 'overpay'; amountCents: number }
    | null
  >(null);
  const [deleteText, setDeleteText] = useState('');

  const reload = useCallback(async () => {
    try {
      const d = await loadOrderDetail(id);
      setDetail(d);
      if (d) setPaidInput(centsToDecimal(d.order.customer_paid_bps).replace(/,00$/, '').replace(/(,\d)0$/, '$1'));
      setError(null);
    } catch (e) { setError(describeError(e)); } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { setLoading(true); void reload(); }, [reload]);

  const state = useMemo(() => {
    if (!detail) return null;
    const o = detail.order;
    try {
      return computeOrderState({
        commissionTotalCents: o.commission_total_cents,
        paymentModel: o.payment_model,
        customThresholdBps: o.custom_threshold_bps,
        customerPaidBps: o.customer_paid_bps,
        payoutThresholds: o.calculation?.rules?.payoutThresholds ?? null,
        statusOverride: o.status_override ? { status: o.status_override, reason: o.status_override_reason ?? '' } : null,
        payouts: detail.payouts.map((p) => ({ amountCents: p.amount_cents, paidOn: p.paid_on })),
      }, rules);
    } catch { return null; }
  }, [detail, rules]);

  // Vorbelegung des Auszahlungsbetrags mit dem Restbetrag
  useEffect(() => { if (state) setPayAmount(state.remainingCents > 0 ? centsToDecimal(state.remainingCents) : ''); }, [state?.remainingCents]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(action: () => Promise<void>, success?: string): Promise<boolean> {
    setBusy(true); setError(null); setNotice(null);
    try { await action(); if (success) setNotice(success); await reload(); return true; }
    catch (e) { setError(describeError(e)); return false; }
    finally { setBusy(false); }
  }

  if (loading) return <Spinner label="Auftrag wird geladen …" />;
  if (!detail || !state) {
    return (
      <div className="space-y-4">
        {error ? <Alert kind="error" title="Auftrag konnte nicht geladen werden">{error}</Alert> : <Alert kind="warning" title="Auftrag nicht gefunden">Der Auftrag existiert nicht (mehr) oder gehört nicht zu diesem Konto.</Alert>}
        <Link to="/kunden" className="text-sm text-teal-700 underline">Zurück zur Übersicht</Link>
      </div>
    );
  }

  const o = detail.order;
  const snapshot = o.calculation;
  const archived = o.archived_at !== null;
  const orderDocs = detail.attachments.filter((a) => a.order_id === o.id);
  const proofsOf = (payoutId: string) => detail.attachments.filter((a) => a.payout_id === payoutId);

  // ---------- Handler ----------
  async function savePaid(e: FormEvent) {
    e.preventDefault();
    const bps = parsePercentToBps(paidInput);
    if (bps === null) { setError('Bitte einen Prozentwert zwischen 0 und 100 eingeben.'); return; }
    await run(() => setCustomerPaid(o.id, bps), 'Zahlungsstand aktualisiert.');
  }

  function onPayoutSubmit(e: FormEvent) {
    e.preventDefault();
    setPayError(null);
    const cents = parseEuroToCents(payAmount);
    if (cents === null || cents <= 0) { setPayError('Bitte einen gültigen Auszahlungsbetrag größer 0 € eingeben.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate)) { setPayError('Bitte ein gültiges Auszahlungsdatum eingeben.'); return; }
    if (state && cents > state.remainingCents) { setConfirm({ type: 'overpay', amountCents: cents }); return; }
    void doPayout(cents);
  }

  async function doPayout(cents: number) {
    if (!user) return;
    setConfirm(null);
    setBusy(true); setError(null); setNotice(null); setPayError(null);
    try {
      let mime: ReturnType<typeof sniffMime> = null;
      if (payFile) {
        const problem = validateFileMeta(payFile);
        if (problem) { setPayError(problem); return; }
        mime = sniffMime(new Uint8Array(await payFile.slice(0, 8).arrayBuffer()));
        if (!mime) { setPayError('Der Dateiinhalt entspricht keinem erlaubten Format (PDF, JPG, PNG).'); return; }
      }
      const payoutId = await addPayout({ orderId: o.id, paidOn: payDate, amountCents: cents, note: payNote.trim() || null });
      let proofFailed = false;
      if (payFile && mime) {
        setPayProgress(0);
        try {
          await uploadAttachmentTo({ folder: 'payout', parentId: payoutId, column: 'payout_id' },
            { userId: user.id, fileId: crypto.randomUUID(), file: payFile, mime, kind: 'payout_proof' }, setPayProgress);
        } catch { proofFailed = true; }
        setPayProgress(null);
      }
      setPayNote(''); setPayFile(null);
      setNotice(proofFailed ? 'Auszahlung erfasst – der Nachweis konnte nicht hochgeladen werden.' : 'Auszahlung erfasst.');
      await reload();
    } catch (e) { setError(describeError(e)); } finally { setBusy(false); setPayProgress(null); }
  }

  async function onDocSelected(file: File | undefined) {
    if (!file || !user) return;
    setDocError(null);
    const problem = validateFileMeta(file);
    if (problem) { setDocError(problem); return; }
    const mime = sniffMime(new Uint8Array(await file.slice(0, 8).arrayBuffer()));
    if (!mime) { setDocError('Der Dateiinhalt entspricht keinem erlaubten Format (PDF, JPG, PNG).'); return; }
    setBusy(true); setDocProgress(0);
    try {
      await uploadAttachmentTo({ folder: 'order', parentId: o.id, column: 'order_id' },
        { userId: user.id, fileId: crypto.randomUUID(), file, mime, kind: docKind }, setDocProgress);
      setNotice('Dokument hochgeladen.');
      await reload();
    } catch (e) { setDocError(describeError(e)); } finally { setBusy(false); setDocProgress(null); }
  }

  async function openDoc(att: AttachmentFull) {
    setDocLink(null); setDocError(null);
    const w = window.open('about:blank', '_blank');
    try {
      const url = await createSignedUrl(att.storage_path, 60);
      if (w) { w.opener = null; w.location.href = url; } else setDocLink(url);
    } catch (e) { w?.close(); setDocError(describeError(e)); }
  }

  async function onConfirm() {
    const c = confirm;
    if (!c) return;
    if (c.type === 'overpay') { await doPayout(c.amountCents); return; }
    setBusy(true); setError(null);
    try {
      if (c.type === 'delete-order') {
        await deleteOrder(detail as OrderDetail);
        navigate('/kunden', { replace: true });
        return;
      }
      if (c.type === 'delete-payout') {
        await deletePayout(c.payoutId, proofsOf(c.payoutId).map((a) => a.storage_path));
        setNotice('Auszahlung gelöscht.');
      }
      if (c.type === 'delete-doc') {
        await deleteAttachment(c.att);
        setNotice('Dokument gelöscht.');
      }
      setConfirm(null); setDeleteText('');
      await reload();
    } catch (e) { setError(describeError(e)); setConfirm(null); } finally { setBusy(false); }
  }

  const history = Array.isArray(o.calculation_history) ? o.calculation_history : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/kunden" className="text-sm text-teal-700 underline">← Alle Kunden und Aufträge</Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold text-navy-800">
            {o.customer_name}
            <span className={`rounded-full px-3 py-0.5 text-sm font-medium ${STATUS_BADGE[state.status]}`}>{STATUS_LABELS[state.status]}</span>
            {archived && <span className="rounded bg-slate-100 px-2 py-0.5 text-sm font-normal text-anthracite-700">archiviert</span>}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/kunden/${o.id}/bearbeiten`} className="inline-flex items-center rounded-md bg-navy-800 px-4 py-2 text-sm font-medium text-white hover:bg-navy-700">Bearbeiten</Link>
          <Button variant="secondary" disabled={busy} onClick={() => void run(() => setArchived(o.id, !archived), archived ? 'Auftrag wiederhergestellt.' : 'Auftrag archiviert.')}>
            {archived ? 'Wiederherstellen' : 'Archivieren'}
          </Button>
          <Button variant="secondary" disabled={busy} className="text-red-700" onClick={() => { setDeleteText(''); setConfirm({ type: 'delete-order' }); }}>Löschen</Button>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Kunde und Projekt">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <Row label="Projektart">{PROJECT_TYPE_LABELS[o.project_type]}</Row>
            <Row label="Vertragsabschluss">{formatDate(o.contract_date)}</Row>
            <Row label="Stufe zum Abschluss">{TIER_LABELS[o.tier]}</Row>
            <Row label="Auftrags-/Angebotsnr.">{o.order_number ?? '–'}</Row>
            <Row label="Auftragsbestätigung">{o.confirmation_date ? formatDate(o.confirmation_date) : '–'}</Row>
            <Row label="Voraussichtliche Auszahlung">{o.expected_payout_date ? formatDate(o.expected_payout_date) : '–'}</Row>
            <Row label="Notiz"><span className="whitespace-pre-wrap">{o.note ?? '–'}</span></Row>
            <Row label="Angelegt">{formatDateTime(o.created_at)}</Row>
          </dl>
        </Card>

        <Card title="Provision und Zahlung">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <Row label="Gesamtprovision"><strong className="tabular-nums">{formatEuro(state.totalCents)}</strong></Row>
            <Row label="Bereits ausgezahlt"><span className="tabular-nums">{formatEuro(state.paidCents)}</span></Row>
            <Row label="Restbetrag"><span className="tabular-nums">{formatEuro(state.remainingCents)}</span> <span className="text-anthracite-600">({state.status === 'open' ? 'offen' : state.status === 'expected' ? 'erwartet' : 'abgeschlossen'})</span></Row>
            {state.overpaidCents > 0 && <Row label="Überzahlung"><span className="tabular-nums text-amber-900">{formatEuro(state.overpaidCents)}</span></Row>}
            <Row label="Zahlungsbedingung">{PAYMENT_LABELS[o.payment_model]} (ab {formatPercent(state.thresholdBps)})</Row>
            {state.overrideApplied && <Row label="Manuelle Korrektur">{STATUS_LABELS[o.status_override as CommissionStatus]} – {o.status_override_reason}</Row>}
          </dl>
          <form onSubmit={(e) => void savePaid(e)} className="mt-4 flex items-end gap-3">
            <TextField label="Bereits bezahlt vom Kunden (%)" inputMode="decimal" value={paidInput} onChange={(e) => setPaidInput(e.target.value)} className="flex-1" />
            <Button type="submit" disabled={busy}>Aktualisieren</Button>
          </form>
          <p className="mt-2 text-xs text-anthracite-600">Erreicht der Zahlungsstand die Schwelle, gilt der Restbetrag als „offen“.</p>
        </Card>
      </div>

      <Card title="Berechnung">
        <p className="mb-3 text-sm text-anthracite-600">
          Berechnet am {formatDateTime(snapshot.calculatedAt)} mit Regelversion {snapshot.ruleSetVersion ?? 'Standardwerte'}. Spätere Änderungen der Einstellungen wirken hier nicht.
        </p>
        <CalculationBreakdown result={snapshot.result} netPriceCents={snapshot.input.netPriceCents} />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link to={`/kunden/${o.id}/bearbeiten?neu=1`} className="inline-flex items-center rounded-md px-4 py-2 text-sm font-medium text-navy-800 ring-1 ring-slate-300 hover:bg-slate-50">Mit aktuellen Regeln neu berechnen …</Link>
          <span className="text-xs text-anthracite-600">Zeigt zuerst eine Warnung; die bisherige Berechnung bleibt im Verlauf erhalten.</span>
        </div>
        {history.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-anthracite-600">Frühere Berechnungen</h3>
            <ul className="text-sm">
              {history.map((h, i) => (
                <li key={`${h.replaced_at}-${i}`} className="flex justify-between py-0.5">
                  <span>ersetzt am {formatDateTime(h.replaced_at)}</span>
                  <span className="tabular-nums">{formatEuro(h.commission_total_cents)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card title="Auszahlungen und Teilzahlungen">
        {detail.payouts.length === 0 ? <p className="text-sm text-anthracite-600">Noch keine Auszahlung erfasst.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <caption className="sr-only">Erfasste Auszahlungen</caption>
              <thead className="border-b border-slate-200 text-anthracite-600">
                <tr><th scope="col" className="py-2 pr-3 font-medium">Datum</th><th scope="col" className="py-2 pr-3 text-right font-medium">Betrag</th><th scope="col" className="py-2 pr-3 font-medium">Notiz / Nachweis</th><th scope="col" className="py-2"><span className="sr-only">Aktionen</span></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detail.payouts.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 pr-3 tabular-nums">{formatDate(p.paid_on)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatEuro(p.amount_cents)}</td>
                    <td className="py-2 pr-3">
                      {p.note}
                      {proofsOf(p.id).map((a) => (
                        <button key={a.id} type="button" onClick={() => void openDoc(a)} className="ml-2 text-teal-700 underline">Nachweis öffnen</button>
                      ))}
                    </td>
                    <td className="py-2 text-right">
                      <Button variant="ghost" disabled={busy} onClick={() => setConfirm({ type: 'delete-payout', payoutId: p.id, label: `${formatEuro(p.amount_cents)} vom ${formatDate(p.paid_on)}` })}>Löschen</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form onSubmit={onPayoutSubmit} className="mt-5 space-y-3 border-t border-slate-100 pt-4" noValidate>
          <h3 className="text-sm font-semibold text-anthracite-700">Auszahlung oder Teilzahlung erfassen</h3>
          {payError && <Alert kind="error">{payError}</Alert>}
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField label="Auszahlungsdatum" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            <TextField label="Tatsächlich ausgezahlt (€)" inputMode="decimal" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} hint={state.remainingCents > 0 ? `Restbetrag: ${formatEuro(state.remainingCents)}` : 'Kein Restbetrag offen'} />
            <TextField label="Notiz" value={payNote} onChange={(e) => setPayNote(e.target.value)} />
          </div>
          <div>
            <label htmlFor="pay-proof" className="mb-1 block text-sm font-medium text-anthracite-700">Nachweis (optional, PDF/JPG/PNG, max. {MAX_FILE_BYTES / 1024 / 1024} MB)</label>
            <input id="pay-proof" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(e) => setPayFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-200 file:px-3 file:py-1.5 file:text-sm" />
          </div>
          {payProgress !== null && <p role="status" className="text-sm text-anthracite-600">Nachweis wird hochgeladen … {payProgress} %</p>}
          <Button type="submit" disabled={busy}>Auszahlung erfassen</Button>
        </form>
      </Card>

      <Card title="Dokumente">
        {docError && <div className="mb-3"><Alert kind="error">{docError}</Alert></div>}
        {docLink && <div className="mb-3"><Alert kind="info">Pop-up blockiert. <a href={docLink} target="_blank" rel="noopener noreferrer" className="underline">Dokument hier öffnen</a> (Link ist 60 Sekunden gültig).</Alert></div>}
        {orderDocs.length === 0 ? <p className="text-sm text-anthracite-600">Keine Dokumente zu diesem Auftrag.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {orderDocs.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0 flex-1 truncate" title={a.file_name}>
                  <span className="mr-2 rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-600">{ATTACHMENT_KIND_LABELS[a.kind]}</span>
                  {a.file_name} <span className="text-anthracite-600">({formatFileSize(a.size_bytes)}, {formatDate(a.created_at)})</span>
                </span>
                <span className="flex gap-1">
                  <Button variant="secondary" onClick={() => void openDoc(a)}>Öffnen</Button>
                  <Button variant="ghost" className="text-red-700" disabled={busy} onClick={() => setConfirm({ type: 'delete-doc', att: a })}>Löschen</Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-[14rem_1fr] sm:items-end">
          <SelectField label="Dokumentart" value={docKind} onChange={(e) => setDocKind(e.target.value as AttachmentKind)}>
            {ORDER_DOC_KINDS.map((k) => <option key={k} value={k}>{ATTACHMENT_KIND_LABELS[k]}</option>)}
          </SelectField>
          <div>
            <label htmlFor="doc-upload" className="mb-1 block text-sm font-medium text-anthracite-700">Dokument hochladen</label>
            <input id="doc-upload" type="file" disabled={busy} accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) setDocKind(guessAttachmentKind(f.name)); void onDocSelected(f); e.target.value = ''; }}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-navy-800 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white" />
          </div>
        </div>
        {docProgress !== null && <p role="status" className="mt-2 text-sm text-anthracite-600">Wird hochgeladen … {docProgress} %</p>}
      </Card>

      <Card title="Änderungsverlauf">
        {detail.audit.length === 0 ? <p className="text-sm text-anthracite-600">Noch keine Einträge.</p> : (
          <ol className="space-y-3 text-sm">
            {detail.audit.map((e) => {
              const d = describeAudit(e);
              return (
                <li key={e.id} className="border-l-2 border-teal-500 pl-3">
                  <p className="font-medium">{d.title} <span className="font-normal text-anthracite-600">· {formatDateTime(e.created_at)}</span></p>
                  {d.details.length > 0 && <ul className="mt-0.5 text-anthracite-600">{d.details.map((x) => <li key={x}>{x}</li>)}</ul>}
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      {confirm?.type === 'delete-order' && (
        <ConfirmDialog title="Auftrag endgültig löschen?" confirmLabel="Endgültig löschen" danger busy={busy} confirmDisabled={deleteText !== 'LÖSCHEN'} onConfirm={() => void onConfirm()} onCancel={() => setConfirm(null)}>
          <p>Der Auftrag „{o.customer_name}“ wird mit allen Auszahlungen und Dokumenten unwiderruflich gelöscht. Zum Archivieren nutze stattdessen „Archivieren“.</p>
          <TextAreaField label="Zur Bestätigung LÖSCHEN eingeben" rows={1} value={deleteText} onChange={(e) => setDeleteText(e.target.value)} />
        </ConfirmDialog>
      )}
      {confirm?.type === 'delete-payout' && (
        <ConfirmDialog title="Auszahlung löschen?" confirmLabel="Löschen" danger busy={busy} onConfirm={() => void onConfirm()} onCancel={() => setConfirm(null)}>
          <p>Die Auszahlung über {confirm.label} und ihre Nachweise werden gelöscht. Der Restbetrag erhöht sich entsprechend.</p>
        </ConfirmDialog>
      )}
      {confirm?.type === 'delete-doc' && (
        <ConfirmDialog title="Dokument löschen?" confirmLabel="Löschen" danger busy={busy} onConfirm={() => void onConfirm()} onCancel={() => setConfirm(null)}>
          <p>„{confirm.att.file_name}“ wird unwiderruflich gelöscht.</p>
        </ConfirmDialog>
      )}
      {confirm?.type === 'overpay' && (
        <ConfirmDialog title="Betrag übersteigt den Restbetrag" confirmLabel="Trotzdem erfassen" busy={busy} onConfirm={() => void onConfirm()} onCancel={() => setConfirm(null)}>
          <p>Du erfasst {formatEuro(confirm.amountCents)}, der Restbetrag beträgt {formatEuro(state.remainingCents)}. Die Differenz wird als Überzahlung getrennt ausgewiesen.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
