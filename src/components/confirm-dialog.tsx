'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';

export function ConfirmDialog({ title, description, label, onCancel, onConfirm, typed = false }: { title: string; description: string; label: string; onCancel: () => void; onConfirm: () => Promise<void>; typed?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null), [error, setError] = useState(''), [confirmation, setConfirmation] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  async function confirm() { setBusy(true); setError(''); try { await onConfirm(); onCancel(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not complete this action. Try again.'); } finally { setBusy(false); } }
  return <dialog ref={ref} className="memoar-dialog" aria-labelledby="confirmation-title" onCancel={event => { if (busy) event.preventDefault(); else onCancel(); }}><h2 id="confirmation-title">{title}</h2><p>{description}</p>{typed && <label className="typed-confirmation">Type DELETE to confirm<input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /></label>}{error && <p className="memoar-error" role="alert">{error}</p>}<div className="action-row"><Button label="Cancel" onClick={onCancel} isDisabled={busy} /><Button label={label} variant="destructive" onClick={() => void confirm()} isLoading={busy} isDisabled={typed && confirmation !== 'DELETE'} /></div></dialog>;
}
