export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 10;
export const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type AllowedMime = (typeof ALLOWED_MIME)[number];

const EXT_TO_MIME: Record<string, AllowedMime> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
};

export function validateFileMeta(f: { name: string; size: number; type: string }): string | null {
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  if (!(ext in EXT_TO_MIME)) return 'Nur PDF-, JPG- und PNG-Dateien sind erlaubt.';
  if (f.type && !(ALLOWED_MIME as readonly string[]).includes(f.type)) return 'Dieser Dateityp ist nicht erlaubt (nur PDF, JPG, PNG).';
  if (f.size <= 0) return 'Die Datei ist leer.';
  if (f.size > MAX_FILE_BYTES) return 'Die Datei ist größer als 10 MB.';
  return null;
}

/** Erkennt den tatsächlichen Dateityp an den ersten Bytes (nicht nur an Endung/MIME-Angabe des Browsers). */
export function sniffMime(bytes: Uint8Array): AllowedMime | null {
  const startsWith = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (startsWith([0x25, 0x50, 0x44, 0x46])) return 'application/pdf'; // %PDF
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  return null;
}

/** Dateiname für den Storage-Pfad: nur ASCII, keine Pfadtrenner, begrenzte Länge. */
export function safeStorageName(rawName: string): string {
  const name = rawName.split(/[\\/]/).pop() ?? ''; // nur der Dateiname, nie ein Pfad
  const lastDot = name.lastIndexOf('.');
  const ext = lastDot > 0 ? name.slice(lastDot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) : '';
  const stem = (lastDot > 0 ? name.slice(0, lastDot) : name)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'datei';
  return ext ? `${stem}.${ext}` : stem;
}

export function buildStoragePath(userId: string, orderId: string, fileId: string, originalName: string): string {
  return `${userId}/order/${orderId}/${fileId}-${safeStorageName(originalName)}`;
}

export type AttachmentKind = 'offer' | 'order_confirmation' | 'other';
export const ATTACHMENT_KIND_LABELS: Record<AttachmentKind, string> = {
  offer: 'Angebot',
  order_confirmation: 'Auftragsbestätigung',
  other: 'Weiteres Dokument',
};

export function guessAttachmentKind(fileName: string): AttachmentKind {
  const n = fileName.toLowerCase();
  if (n.includes('angebot')) return 'offer';
  if (/auftragsbest|bestätigung|bestaetigung|\bab[-_ .]/.test(n)) return 'order_confirmation';
  return 'other';
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
