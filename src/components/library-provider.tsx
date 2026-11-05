'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { dashboardCache, extensionRequest, importLibrary } from '@/lib/library/client';
import { EXTENSION_ID } from '@/lib/capture/protocol';
import { defaultPreferences, type LibraryPreferences, type SavedPost } from '@/lib/library/types';
import type { LibraryRequest } from '@/lib/library/protocol';

type LibraryContextValue = {
  posts: SavedPost[]; loading: boolean; busy: boolean; connected: boolean; extensionId: string; error: string; progress: string; lastImport: string;
  preferences: LibraryPreferences; connect: (id: string) => void; refresh: () => Promise<void>;
  mutate: (message: LibraryRequest) => Promise<void>; setPreferences: (value: LibraryPreferences) => Promise<void>;
  clearCache: () => Promise<void>;
};
const LibraryContext = createContext<LibraryContextValue | null>(null);
export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const [posts, setPosts] = useState<SavedPost[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false), [extensionId, setExtensionId] = useState(''), [error, setError] = useState('');
  const [progress, setProgress] = useState('Connecting to Memoar…'), [lastImport, setLastImport] = useState('');
  const [preferences, setPrefs] = useState(defaultPreferences);
  const inFlight = useRef(false), generation = useRef(0);
  const paired = useRef({ id: '', at: 0 });
  const connect = useCallback((id: string) => {
    if (!EXTENSION_ID.test(id)) { setError('Enter the 32-character ID shown for Memoar in Chrome’s extension settings.'); return; }
    generation.current++; setConnected(false); setExtensionId(id); setError('');
    try { localStorage.setItem('memoar-extension-id', id); } catch { /* Connection can still be used for this visit. */ }
  }, []);
  useEffect(() => {
    void dashboardCache.list().then(setPosts).catch(() => setError('Could not read the cached library. Check browser storage permissions.')).finally(() => setLoading(false));
    try {
      const id = new URL(window.location.href).searchParams.get('extensionId') || localStorage.getItem('memoar-extension-id') || process.env.NEXT_PUBLIC_MEMOAR_EXTENSION_ID || '';
      if (id) connect(id);
    } catch { setError('Browser storage is unavailable. Open Memoar from the extension.'); }
  }, [connect]);
  const refresh = useCallback(async () => {
    if (!extensionId || inFlight.current) return;
    const run = generation.current;
    inFlight.current = true; setBusy(true); setError(''); setProgress('Connecting to Memoar…');
    try {
      const ping = await extensionRequest(extensionId, { type: 'MEMOAR_PING' });
      if (ping.protocolVersion !== 1) throw new Error('Reload the Memoar extension to update it.');
      if (run !== generation.current) return;
      setConnected(true); setProgress('Checking your saved posts…');
      const result = await importLibrary(extensionId, (count, total) => setProgress(`Preparing your library… ${count} of ${total}`));
      if (run !== generation.current) return;
      setPosts(result); setLastImport(new Date().toISOString()); setProgress('Your saves are ready.');
      const prefs = await extensionRequest(extensionId, { type: 'MEMOAR_PREFERENCES' });
      if (run === generation.current) setPrefs(prefs.preferences as LibraryPreferences);
      if (paired.current.id !== extensionId || Date.now() - paired.current.at > 3600000) {
        try {
          const response = await fetch('/api/enrich/connect', { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(5000) });
          const connection = await response.json();
          if (response.ok && typeof connection.accessCode === 'string') {
            await extensionRequest(extensionId, { type: 'MEMOAR_SET_ACCESS_CODE', code: connection.accessCode });
            paired.current = { id: extensionId, at: Date.now() };
          }
        } catch { /* Saved posts remain usable while the local AI connection is unavailable. */ }
      }
    } catch (failure) { if (run === generation.current) { setConnected(false); setError(failure instanceof Error ? failure.message : 'Could not import your saves. Please retry.'); } }
    finally { inFlight.current = false; setBusy(false); setLoading(false); }
  }, [extensionId]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 20000);
    return () => clearInterval(timer);
  }, [refresh]);
  const mutate = async (message: LibraryRequest) => {
    if (!connected || inFlight.current) throw new Error('Wait for the library to finish connecting, then try again.');
    await extensionRequest(extensionId, message);
    if (message.type === 'MEMOAR_DELETE_POST') { await dashboardCache.remove(message.id); setPosts(current => current.filter(post => post.id !== message.id)); }
    if (message.type === 'MEMOAR_CLEAR') { await dashboardCache.clear(); setPosts([]); }
    await refresh();
  };
  const setPreferences = async (value: LibraryPreferences) => {
    await mutate({ type: 'MEMOAR_SET_PREFERENCES', ...value }); setPrefs(value);
  };
  const clearCache = async () => { await dashboardCache.clear(); setPosts([]); setLastImport(''); };
  return <LibraryContext.Provider value={{ posts, loading, busy, connected, extensionId, error, progress, lastImport, preferences, connect, refresh, mutate, setPreferences, clearCache }}>{children}</LibraryContext.Provider>;
}
export function useLibrary() { const value = useContext(LibraryContext); if (!value) throw new Error('LibraryProvider is required.'); return value; }
