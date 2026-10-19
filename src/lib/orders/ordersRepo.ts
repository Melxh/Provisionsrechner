import { requireClient } from '../supabase';
import { buildStoragePathIn } from './files';
import type { AllowedMime, AttachmentKind, StorageFolder } from './files';
import type { OrderPayload, StoredOrderMeta } from './orderForm';
import type { CalculationSnapshot } from '../commission/types';
import type { AuditEntry } from '../data/auditFormat';
import type { DbAttachmentRef, DbOrderRow, DbPayoutRow } from '../data/dashboardModel';

const BUCKET = 'documents';

/** Legt Auftrag + Positionen atomar an (Datenbankfunktion create_order, RLS gilt für den Benutzer). */
export async function createOrder(payload: OrderPayload): Promise<string> {
  const { data, error } = await requireClient().rpc('create_order', {
    p_order: payload.order,
    p_addons: payload.addons,
    p_adjustments: payload.adjustments,
  });
  if (error) throw new Error(error.message);
  if (typeof data !== 'string') throw new Error('Unerwartete Antwort der Datenbank.');
  return data;
}

/** Ändert Auftrag + Positionen atomar. Ein geänderter Snapshot wird serverseitig im Verlauf archiviert. */
export async function updateOrder(orderId: string, payload: OrderPayload): Promise<void> {
  const { error } = await requireClient().rpc('update_order', {
    p_order_id: orderId,
    p_order: payload.order,
    p_addons: payload.addons,
    p_adjustments: payload.adjustments,
  });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------- Laden

const THRESHOLDS = 'thresholds:calculation->rules->payoutThresholds';
const ORDER_LIST_COLUMNS =
  `id, customer_name, project_type, contract_date, tier, payment_model, custom_threshold_bps, customer_paid_bps, status_override, status_override_reason, commission_total_cents, archived_at, order_number, ${THRESHOLDS}`;

async function rows<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

export async function loadOrdersOverview() {
  const c = requireClient();
  const [orders, payouts, attachments] = await Promise.all([
    rows<DbOrderRow>(c.from('orders').select(ORDER_LIST_COLUMNS).order('contract_date', { ascending: false }).limit(5000)),
    rows<DbPayoutRow>(c.from('payouts').select('id, order_id, paid_on, amount_cents').limit(10000)),
    rows<DbAttachmentRef>(c.from('attachments').select('id, order_id, payout_id, historical_payout_id').limit(20000)),
  ]);
  return { orders, payouts, attachments };
}

export interface OrderFull extends StoredOrderMeta {
  id: string;
  commission_total_cents: number;
  archived_at: string | null;
  rule_set_id: string | null;
  calculation: CalculationSnapshot;
  calculation_history: Array<{ replaced_at: string; commission_total_cents: number }>;
  created_at: string;
}
export interface PayoutFull { id: string; paid_on: string; amount_cents: number; note: string | null; created_at: string }
export interface AttachmentFull {
  id: string; kind: AttachmentKind; order_id: string | null; payout_id: string | null;
  file_name: string; storage_path: string; mime_type: string; size_bytes: number; created_at: string;
}
export interface OrderDetail { order: OrderFull; payouts: PayoutFull[]; attachments: AttachmentFull[]; audit: AuditEntry[] }

const ATT_COLUMNS = 'id, kind, order_id, payout_id, file_name, storage_path, mime_type, size_bytes, created_at';

export async function loadOrderDetail(id: string): Promise<OrderDetail | null> {
  const c = requireClient();
  const { data: order, error } = await c.from('orders').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) return null;
  const payouts = await rows<PayoutFull>(c.from('payouts').select('id, paid_on, amount_cents, note, created_at').eq('order_id', id).order('paid_on', { ascending: false }));
  const payoutIds = payouts.map((p) => p.id);
  const [orderDocs, proofDocs, audit] = await Promise.all([
    rows<AttachmentFull>(c.from('attachments').select(ATT_COLUMNS).eq('order_id', id).order('created_at')),
    payoutIds.length ? rows<AttachmentFull>(c.from('attachments').select(ATT_COLUMNS).in('payout_id', payoutIds).order('created_at')) : Promise.resolve([] as AttachmentFull[]),
    rows<AuditEntry>(c.from('audit_log').select('id, entity_table, entity_id, action, changes, created_at').eq('parent_order_id', id).order('created_at', { ascending: false }).limit(200)),
  ]);
  return { order: order as OrderFull, payouts, attachments: [...orderDocs, ...proofDocs], audit };
}

// ---------------------------------------------------------------- Ändern

export async function setCustomerPaid(orderId: string, bps: number): Promise<void> {
  const { error } = await requireClient().from('orders').update({ customer_paid_bps: bps }).eq('id', orderId);
  if (error) throw new Error(error.message);
}

export async function setArchived(orderId: string, archived: boolean): Promise<void> {
  const { error } = await requireClient().from('orders').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', orderId);
  if (error) throw new Error(error.message);
}

export async function addPayout(p: { orderId: string; paidOn: string; amountCents: number; note: string | null }): Promise<string> {
  const { data, error } = await requireClient().from('payouts')
    .insert({ order_id: p.orderId, paid_on: p.paidOn, amount_cents: p.amountCents, note: p.note })
    .select('id').single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function removeFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  // Best effort: Datensätze sind bereits weg; übrig gebliebene Dateien sind ohne Datensatz nicht erreichbar.
  await requireClient().storage.from(BUCKET).remove(paths);
}

export async function deletePayout(payoutId: string, proofPaths: string[]): Promise<void> {
  const { error } = await requireClient().from('payouts').delete().eq('id', payoutId);
  if (error) throw new Error(error.message);
  await removeFiles(proofPaths);
}

export async function deleteAttachment(att: Pick<AttachmentFull, 'id' | 'storage_path'>): Promise<void> {
  const { error } = await requireClient().from('attachments').delete().eq('id', att.id);
  if (error) throw new Error(error.message);
  await removeFiles([att.storage_path]);
}

/** Löscht Auszahlungen (inkl. Nachweise), den Auftrag (inkl. Positionen/Dokumente) und danach die Dateien. */
export async function deleteOrder(detail: OrderDetail): Promise<void> {
  const c = requireClient();
  const paths = detail.attachments.map((a) => a.storage_path);
  if (detail.payouts.length > 0) {
    const { error } = await c.from('payouts').delete().eq('order_id', detail.order.id);
    if (error) throw new Error(error.message);
  }
  const { error } = await c.from('orders').delete().eq('id', detail.order.id);
  if (error) throw new Error(error.message);
  await removeFiles(paths);
}

export async function createSignedUrl(path: string, seconds = 60): Promise<string> {
  const { data, error } = await requireClient().storage.from(BUCKET).createSignedUrl(path, seconds);
  if (error || !data) throw new Error(error?.message ?? 'Link konnte nicht erstellt werden.');
  return data.signedUrl;
}

// ---------------------------------------------------------------- Upload

/** Upload mit echter Fortschrittsanzeige (supabase-js bietet dafür keinen Callback) – gleiche Storage-API, gleiche Berechtigungen. */
async function uploadWithProgress(path: string, file: File, mime: AllowedMime, onProgress: (percent: number) => void): Promise<void> {
  const client = requireClient();
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not authenticated');

  const baseUrl = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, '');
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const url = `${baseUrl}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;

  const body = new FormData();
  body.append('cacheControl', '3600');
  body.append('', new File([file], file.name, { type: mime }));

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', key);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload fehlgeschlagen (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Failed to fetch'));
    xhr.send(body);
  });
}

export interface UploadTarget { folder: StorageFolder; parentId: string; column: 'order_id' | 'payout_id' | 'historical_payout_id' }
export interface UploadFileParams { userId: string; fileId: string; file: File; mime: AllowedMime; kind: AttachmentKind }

/** Datei in den privaten Bucket laden und den Anhang-Datensatz anlegen; bei Fehler wird die Datei wieder entfernt. */
export async function uploadAttachmentTo(target: UploadTarget, p: UploadFileParams, onProgress: (percent: number) => void): Promise<void> {
  const path = buildStoragePathIn(p.userId, target.folder, target.parentId, p.fileId, p.file.name);
  await uploadWithProgress(path, p.file, p.mime, onProgress);
  const { error } = await requireClient().from('attachments').insert({
    kind: p.kind,
    [target.column]: target.parentId,
    file_name: p.file.name.slice(0, 255),
    storage_path: path,
    mime_type: p.mime,
    size_bytes: p.file.size,
  });
  if (error) {
    await requireClient().storage.from(BUCKET).remove([path]);
    throw new Error(error.message);
  }
}

export interface UploadParams extends UploadFileParams { orderId: string }

/** Dokument zu einem Auftrag (Formular „Neue Provision“). */
export function uploadAttachment(p: UploadParams, onProgress: (percent: number) => void): Promise<void> {
  return uploadAttachmentTo({ folder: 'order', parentId: p.orderId, column: 'order_id' }, p, onProgress);
}
