import { parsePostUrl } from '../src/lib/inspection/parse-url';
import { isMemoarSender, isRecord, isTakeRequest, isMediaTransferRequest } from '../src/lib/capture/protocol';
import { normalizeCapture } from '../src/lib/capture/normalize';
import { createCaptureSession, type PendingCapture } from './session';
import { takeSnapshot } from './snapshot';
import type { SnapshotCandidate } from './snapshot-region';
import { samePost } from './adapters/dom';
import { rememberMediaTransfer, claimMediaTransfer, transferMedia } from './media-transfer';

const session = createCaptureSession({
  get: async () => (await chrome.storage.session.get('pending')).pending as PendingCapture | undefined ?? null,
  set: async value => { await chrome.storage.session.set({ pending: value }); },
  clear: async () => { await chrome.storage.session.remove('pending'); },
});
void chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
void session.peek();
chrome.runtime.onStartup.addListener(() => { void session.peek(); });

let pending: { tabId: number; url: string; nonce: string; resolve: (value: unknown) => void; reject: (reason: Error) => void } | null = null;
let capturing = false;
async function startCapture(allSlides: boolean) {
  if (capturing) throw new Error('A capture is already running. Wait a moment and try again.');
  capturing = true;
  try { return await performCapture(allSlides); }
  finally { capturing = false; }
}

async function performCapture(allSlides: boolean) {
  if (pending) throw new Error('A capture is already running. Wait a moment and try again.');
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url) throw new Error('No supported active tab is available.');
  parsePostUrl(tab.url);
  const tabId = tab.id;
  const url = tab.url;
  const nonce = crypto.randomUUID();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const completed = new Promise<unknown>((resolve, reject) => {
    pending = { tabId, url, nonce, resolve, reject };
    timeout = setTimeout(() => reject(new Error('Capture timed out. Open the post fully and try again.')), 55000);
  });
  // Attach before injection, so an early injection error cannot leave an unhandled rejection.
  const outcome = completed.then(value => ({ value }), error => ({ error: error as Error }));
  try {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED',
      func: (request: { nonce: string; url: string; allSlides: boolean }) => {
        (globalThis as typeof globalThis & { __memoarCaptureRequest?: typeof request }).__memoarCaptureRequest = request;
      }, args: [{ nonce, url, allSlides }],
    });
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', files: ['capture.js'] });
    const result = await outcome;
    if ('error' in result) throw result.error;
    const latest = await chrome.tabs.get(tabId);
    if (!latest.url || !samePost(latest.url, parsePostUrl(url))) throw new Error('The tab navigated during capture. Capture discarded.');
    if (!isRecord(result.value)) throw new Error('Invalid capture result.');
    const payload = normalizeCapture(result.value.payload);
    const snapshot = await takeSnapshot(tabId, tab.windowId, latest.url, result.value.candidate as SnapshotCandidate | null);
    const afterSnapshot = await chrome.tabs.get(tabId);
    if (afterSnapshot.url !== latest.url) throw new Error('The tab navigated during snapshot. Capture discarded.');
    let envelope;
    try { envelope = normalizeCapture({ ...payload, snapshot }); }
    catch { envelope = normalizeCapture({ ...payload, snapshot: { status: 'unavailable', reason: 'Snapshot was omitted to keep the capture within its size limit.' } }); }
    const capture = await session.put(envelope);
    await rememberMediaTransfer(capture.id, capture.payload, tabId, url, nonce, capture.expiresAt, result.value.mediaAssets);
    return { captureId: capture.id, payload: capture.payload, expiresAt: capture.expiresAt };
  } finally { clearTimeout(timeout); pending = null; }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isRecord(message) || sender.id !== chrome.runtime.id) return false;
  if ((message.type === 'CAPTURE_RESULT' || message.type === 'CAPTURE_ERROR') && pending && message.nonce === pending.nonce
    && sender.tab?.id === pending.tabId && sender.frameId === 0 && sender.url && samePost(sender.url, parsePostUrl(pending.url))) {
    if (message.type === 'CAPTURE_RESULT') {
      try { pending.resolve({ payload: normalizeCapture(message.payload), candidate: message.candidate ?? null, mediaAssets: message.mediaAssets }); }
      catch (error) { pending.reject(error instanceof Error ? error : new Error('Invalid capture.')); }
    } else pending.reject(new Error(typeof message.message === 'string' ? message.message.slice(0, 1000) : 'Capture failed.'));
    sendResponse({ ok: true });
    return false;
  }
  if (sender.tab || sender.url !== chrome.runtime.getURL('popup.html')) return false;
  const action = message.type === 'START_CAPTURE' ? startCapture(message.allSlides === true)
    : message.type === 'LAST_CAPTURE' ? session.peek().then(value => value ? { captureId: value.id, payload: value.payload, expiresAt: value.expiresAt } : null)
    : null;
  if (!action) return false;
  void action.then(result => sendResponse({ ok: true, result }), error => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Capture failed.' }));
  return true;
});

chrome.runtime.onMessageExternal.addListener((message: unknown, sender, sendResponse) => {
  if (!isMemoarSender(sender)) return false;
  const action = isTakeRequest(message) ? session.take(message.captureId).then(async payload => ({ payload, mediaAssets: await claimMediaTransfer(message.captureId) }))
    : isMediaTransferRequest(message) ? transferMedia(message) : null;
  if (!action) return false;
  void action.then(
    result => sendResponse({ ok: true, ...result }),
    error => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Capture unavailable.' }),
  );
  return true;
});
