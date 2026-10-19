import { requireClient } from '../supabase';
import { buildStoragePath } from './files';
import type { AllowedMime, AttachmentKind } from './files';
import type { OrderPayload } from './orderForm';

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

/** Upload mit echter Fortschrittsanzeige (supabase-js bietet dafür keinen Callback) – gleiche Storage-API, gleiche Berechtigungen. */
async function uploadWithProgress(path: string, file: File, mime: AllowedMime, onProgress: (percent: number) => void): Promise<void> {
  const client = requireClient();
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not authenticated');

  const baseUrl = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, '');
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const url = `${baseUrl}/storage/v1/object/documents/${path.split('/').map(encodeURIComponent).join('/')}`;

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

export interface UploadParams {
  userId: string;
  orderId: string;
  fileId: string;
  file: File;
  mime: AllowedMime;
  kind: AttachmentKind;
}

/** Datei in den privaten Bucket laden und den Anhang-Datensatz anlegen; bei Fehler wird die Datei wieder entfernt. */
export async function uploadAttachment(p: UploadParams, onProgress: (percent: number) => void): Promise<void> {
  const path = buildStoragePath(p.userId, p.orderId, p.fileId, p.file.name);
  await uploadWithProgress(path, p.file, p.mime, onProgress);
  const { error } = await requireClient().from('attachments').insert({
    kind: p.kind,
    order_id: p.orderId,
    file_name: p.file.name.slice(0, 255),
    storage_path: path,
    mime_type: p.mime,
    size_bytes: p.file.size,
  });
  if (error) {
    await requireClient().storage.from('documents').remove([path]);
    throw new Error(error.message);
  }
}
