import { describe, expect, it } from 'vitest';
import { buildStoragePath, guessAttachmentKind, safeStorageName, sniffMime, validateFileMeta } from './files.ts';

describe('Dateiprüfung', () => {
  it('akzeptiert PDF/JPG/PNG bis 10 MB', () => {
    expect(validateFileMeta({ name: 'Angebot.pdf', size: 1000, type: 'application/pdf' })).toBeNull();
    expect(validateFileMeta({ name: 'foto.JPG', size: 1000, type: 'image/jpeg' })).toBeNull();
    expect(validateFileMeta({ name: 'x.png', size: 1000, type: '' })).toBeNull();
  });
  it('lehnt falsche Typen, leere und zu große Dateien ab', () => {
    expect(validateFileMeta({ name: 'x.exe', size: 10, type: 'application/octet-stream' })).not.toBeNull();
    expect(validateFileMeta({ name: 'x.pdf', size: 10, type: 'text/html' })).not.toBeNull();
    expect(validateFileMeta({ name: 'x.pdf', size: 0, type: 'application/pdf' })).not.toBeNull();
    expect(validateFileMeta({ name: 'x.pdf', size: 10 * 1024 * 1024 + 1, type: 'application/pdf' })).not.toBeNull();
    expect(validateFileMeta({ name: 'x.pdf', size: 10 * 1024 * 1024, type: 'application/pdf' })).toBeNull();
  });
  it('erkennt den echten Typ an den Bytes', () => {
    expect(sniffMime(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe('application/pdf');
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffMime(new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]))).toBeNull(); // "<html"
  });
});

describe('Speicherpfad', () => {
  it('bereinigt Dateinamen', () => {
    expect(safeStorageName('Angebot Müller & Söhne (final).PDF')).toBe('Angebot_Muller_Sohne_final.pdf');
    expect(safeStorageName('../../etc/passwd')).toBe('passwd');
    expect(safeStorageName('Straße.png')).toBe('Strasse.png');
    expect(safeStorageName('...')).toBe('datei');
  });
  it('Pfad beginnt mit der Benutzer-ID (Voraussetzung für die Storage-Policy)', () => {
    const p = buildStoragePath('uid-1', 'order-1', 'file-1', 'Angebot 1.pdf');
    expect(p).toBe('uid-1/order/order-1/file-1-Angebot_1.pdf');
    expect(p.split('/')[0]).toBe('uid-1');
    expect(p.split('/')).toHaveLength(4);
  });
  it('rät die Dokumentart aus dem Dateinamen', () => {
    expect(guessAttachmentKind('Angebot_123.pdf')).toBe('offer');
    expect(guessAttachmentKind('Auftragsbestätigung.pdf')).toBe('order_confirmation');
    expect(guessAttachmentKind('scan.png')).toBe('other');
  });
});
