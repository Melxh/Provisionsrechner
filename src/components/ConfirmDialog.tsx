import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Button } from './ui';

/** Bestätigungsdialog (Escape schließt, Fokus auf der sicheren Schaltfläche, Hintergrund nicht klickbar). */
export default function ConfirmDialog({
  title, children, confirmLabel, danger = false, busy = false, confirmDisabled = false, onConfirm, onCancel,
}: {
  title: string; children: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean; confirmDisabled?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation">
      <div role="alertdialog" aria-modal="true" aria-labelledby="cd-title" className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 id="cd-title" className="text-lg font-semibold text-navy-800">{title}</h2>
        <div className="mt-2 space-y-3 text-sm text-anthracite-700">{children}</div>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={busy} autoFocus>Abbrechen</Button>
          <Button onClick={onConfirm} disabled={busy || confirmDisabled} className={danger ? 'bg-red-700 hover:bg-red-800' : ''}>
            {busy ? 'Bitte warten …' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
