'use client';
import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { useLibrary } from '@/components/library-provider';
import { LibraryConnection } from '@/components/library-connection';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { extensionRequest } from '@/lib/library/client';

export default function SettingsPage() {
  const library = useLibrary(); const [message, setMessage] = useState(''), [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<'clear' | 'cache' | null>(null);
  const preferences = library.preferences;
  const [notificationPermission, setNotificationPermission] = useState('checking');
  const [notificationError, setNotificationError] = useState('');
  useEffect(() => {
    if (!library.connected) { setNotificationPermission('unavailable'); return; }
    let active = true;
    void extensionRequest(library.extensionId, { type: 'MEMOAR_NOTIFICATION_STATUS' }).then(status => {
      if (active) { setNotificationPermission(String(status.permission)); setNotificationError(typeof status.error === 'string' ? status.error : ''); }
    }).catch(() => { if (active) { setNotificationPermission('unavailable'); setNotificationError('Reload the updated Memoar extension to enable notifications.'); } });
    return () => { active = false; };
  }, [library.connected, library.extensionId]);
  async function perform(action: () => Promise<void>, success: string) { setError(''); setMessage(''); try { await action(); setMessage(success); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save this change. Try again.'); } }
  function exportMetadata() {
    const text = JSON.stringify({ format: 'memoar-metadata', version: 1, exportedAt: new Date().toISOString(), posts: library.posts.map(post => ({ ...post, mediaStored: [], mediaNote: 'Metadata export: original image/video files are not included.' })) }, null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'memoar-metadata.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('Metadata exported. This file does not include original media and cannot restore the extension library.');
  }
  return <>
    <header className="view-heading"><h1>A space that’s yours.</h1><p>Manage your connection, your saves, and what happens to them.</p></header>
    <div className="settings-stack">
      <section className="settings-section"><div><h2>Extension connection</h2><p>{library.connected ? 'Connected to this Chrome profile.' : 'Memoar extension not detected.'}</p></div><LibraryConnection />{library.lastImport && <p className="muted">Last imported {new Date(library.lastImport).toLocaleString('en')}.</p>}<Button label="Resync from extension" isDisabled={!library.extensionId} isLoading={library.busy} onClick={() => void library.refresh()} /></section>
      <section className="settings-section"><div><h2>Notifications</h2><p>Automatic reminders every 3 minutes, featuring a post from your saved library. Click a notification to open that saved post.</p></div>
        <p className="muted">{notificationPermission === 'granted' ? 'Notifications allowed by Chrome.' : notificationPermission === 'denied' ? 'Notifications are blocked. Allow Memoar notifications in Chrome’s extension settings.' : notificationPermission === 'checking' ? 'Checking notification access…' : 'Connect the updated extension to check notification access.'}</p>
        <Button label="Test notification" isDisabled={!library.connected || !library.posts.length} clickAction={() => perform(async () => {
          await extensionRequest(library.extensionId, { type: 'MEMOAR_TEST_NOTIFICATION' });
          setNotificationError('');
        }, 'Test notification sent to Chrome. Click it to open the saved post.')} />
        {!library.posts.length && <p className="muted">Save a post first to preview a notification with a real destination.</p>}
        {notificationError && <p className="memoar-error" role="alert">{notificationError}</p>}
        <p className="muted">Chrome must be running. System notification permissions, Focus mode, and device sleep can delay or hide notifications.</p>
      </section>
      <section className="settings-section">
        <div><h2>In-app review</h2><p>Automatic reviews on Home. Daily is the default, using a 3-minute interval for this demo.</p></div>
        <div className="settings-fields">
          <label>How often<select disabled={!library.connected || library.busy} value={preferences.cadence} onChange={event => void perform(() => library.setPreferences({ ...preferences, cadence: event.target.value as 'daily' | 'weekly' | 'monthly' }), 'Review cadence saved.')}><option value="daily">Daily (3-minute demo)</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
          <label>Revisit after<select disabled={!library.connected || library.busy} value={preferences.ageDays} onChange={event => void perform(() => library.setPreferences({ ...preferences, ageDays: Number(event.target.value) }), 'Review age saved.')}><option value={0}>3 minutes (default)</option><option value={1}>1 day</option><option value={30}>30 days</option><option value={60}>60 days</option><option value={90}>90 days</option></select></label>
        </div>
        <p className="muted">Reviews are enabled automatically. Browser notifications also run every 3 minutes.</p>
      </section>
      <section className="settings-section"><div><h2>Your local library</h2><p>{library.posts.length} saved {library.posts.length === 1 ? 'post' : 'posts'}. The extension holds the original library; this website keeps a local cache.</p></div><div className="action-row"><Button label="Export metadata" onClick={exportMetadata} isDisabled={!library.posts.length} /><Button label="Clear dashboard cache" onClick={() => setConfirmation('cache')} /><Button label="Clear all saved data" variant="destructive" isDisabled={!library.connected || library.busy} onClick={() => setConfirmation('clear')} /></div><p className="muted">Uninstalling the extension or clearing browser data can erase your saves. Metadata export includes captured text, previews, and AI results, but excludes original media files. Restoring backups is not available yet.</p></section>
      <section className="settings-section"><h2>About Memoar</h2><p>A personal library in this browser profile. No account or cross-device sync. Instagram and Threads capture reuse the existing adapters; Facebook and mixed carousels can remain partial. Saved metadata does not establish that an original post is still available.</p><a href="/getting-started">Installation and capture guide ↗</a></section>
    </div>
    {message && <p role="status" className="settings-message">{message}</p>}{error && <p role="alert" className="memoar-error">{error}</p>}
    {confirmation === 'cache' && <ConfirmDialog title="Clear this dashboard’s cache?" description="Your saved posts remain in the extension. You can import them again using Resync from extension." label="Clear cache" onCancel={() => setConfirmation(null)} onConfirm={library.clearCache} />}
    {confirmation === 'clear' && <ConfirmDialog title="Clear all Memoar saved data?" description="This permanently removes every saved post and its media from this extension and the current dashboard cache. This cannot be undone. Other open tabs will update on their next import." label="Delete all saved posts" typed onCancel={() => setConfirmation(null)} onConfirm={() => library.mutate({ type: 'MEMOAR_CLEAR' })} />}
  </>;
}
