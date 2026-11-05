import { parsePostUrl } from '../src/lib/inspection/parse-url';
import { isMemoarSender, isRecord, isTakeRequest, isMediaTransferRequest } from '../src/lib/capture/protocol';
import { normalizeCapture } from '../src/lib/capture/normalize';
import { createCaptureSession, type PendingCapture } from './session';
import { takeSnapshot } from './snapshot';
import type { SnapshotCandidate } from './snapshot-region';
import { samePost } from './adapters/dom';
import { rememberMediaTransfer, claimMediaTransfer, transferMedia } from './media-transfer';
import { saveToLibrary, savedLibrary, libraryMessage, runEnrichmentQueue } from './library';
import { isLibraryRequest } from '../src/lib/library/protocol';
import { MEMOAR_ORIGIN } from '../src/lib/capture/protocol';
import { initializeNotifications, notificationStatus, sendSavedPostNotification } from './notifications';

initializeNotifications();

const session = createCaptureSession({
  get: async () => (await chrome.storage.session.get('pending')).pending as PendingCapture | undefined ?? null,
  set: async value => { await chrome.storage.session.set({ pending: value }); },
  clear: async () => { await chrome.storage.session.remove('pending'); },
});
void chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
void session.peek();
chrome.runtime.onStartup.addListener(() => { void session.peek(); });
const resumeQueue = () => { void runEnrichmentQueue().catch(() => {}); };
chrome.runtime.onStartup.addListener(resumeQueue);
chrome.runtime.onInstalled.addListener(() => { void chrome.alarms.create('memoar-enrichment', { periodInMinutes: 1 }); resumeQueue(); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'memoar-enrichment') resumeQueue(); });
void chrome.alarms.create('memoar-enrichment', { periodInMinutes: 1 });

chrome.action.onClicked.addListener(tab => {
  if (!tab.id) return;
  const tabId = tab.id;
  void chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', files: ['popover.js'] }).then(() => {
    void chrome.action.setBadgeText({ tabId, text: '' });
    void chrome.action.setTitle({ tabId, title: 'Memoar' });
  }).catch(() => {
    void chrome.action.setBadgeText({ tabId, text: '!' });
    void chrome.action.setBadgeBackgroundColor({ tabId, color: '#30779d' });
    void chrome.action.setTitle({ tabId, title: 'Memoar cannot open on this browser page. Open a social post and try again.' });
  });
});

let pending: { tabId: number; url: string; nonce: string; resolve: (value: unknown) => void; reject: (reason: Error) => void } | null = null;
let capturing = false;
async function startCapture(allSlides: boolean, save = false, sourceTabId?: number, expectedUrl?: string) {
  if (capturing) throw new Error('A capture is already running. Wait a moment and try again.');
  capturing = true;
  try { return await performCapture(allSlides, save, sourceTabId, expectedUrl); }
  finally { capturing = false; }
}

async function performCapture(allSlides: boolean, save: boolean, sourceTabId?: number, expectedUrl?: string) {
  if (pending) throw new Error('A capture is already running. Wait a moment and try again.');
  const tab = sourceTabId === undefined ? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0] : await chrome.tabs.get(sourceTabId);
  if (!tab?.id || !tab.url) throw new Error('No supported active tab is available.');
  if (expectedUrl && !samePost(tab.url, parsePostUrl(expectedUrl))) throw new Error('The post changed. Close and reopen Memoar before saving.');
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
    if (save) {
      const id = `${payload.inspection.platform}:${payload.inspection.fields.postId.value}`;
      const duplicate = Boolean(await savedLibrary.get(id));
      const post = await saveToLibrary(capture.id, capture.payload);
      return { postId: post.id, duplicate, aiStatus: post.aiStatus };
    }
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
  const fromPopover = Boolean(sender.tab?.id && sender.frameId === 0 && sender.url && /^https?:/.test(sender.url));
  const fromPopup = !sender.tab && sender.url === chrome.runtime.getURL('popup.html');
  if (!fromPopup && !fromPopover) return false;
  if (fromPopover && !['SAVE_POST', 'FIND_SAVED', 'OPEN_LIBRARY'].includes(String(message.type))) return false;
  const action = message.type === 'OPEN_LIBRARY' ? Promise.resolve().then(async () => {
      const post = typeof message.postId === 'string' ? await savedLibrary.get(message.postId) : undefined;
      const url = new URL(post ? `/app/saved/${encodeURIComponent(post.id)}` : '/setup', MEMOAR_ORIGIN);
      url.searchParams.set('extensionId', chrome.runtime.id);
      await chrome.tabs.create({ url: url.href }); return {};
    })
    : message.type === 'SAVE_POST' ? Promise.resolve().then(() => {
      if (fromPopover && typeof message.url !== 'string') throw new Error('Reopen Memoar on the post you want to save.');
      return startCapture(true, true, fromPopover ? sender.tab!.id : undefined, fromPopover ? message.url as string : undefined);
    })
    : message.type === 'FIND_SAVED' && typeof message.url === 'string' ? Promise.resolve().then(async () => { const parsed = parsePostUrl(fromPopover ? sender.url : message.url); return { post: await savedLibrary.get(`${parsed.platform}:${parsed.postId}`) ?? null }; })
    : message.type === 'START_CAPTURE' ? startCapture(message.allSlides === true)
    : message.type === 'LAST_CAPTURE' ? session.peek().then(value => value ? { captureId: value.id, payload: value.payload, expiresAt: value.expiresAt } : null)
    : null;
  if (!action) return false;
  void action.then(result => { try { sendResponse({ ok: true, result }); } finally { if (message.type === 'SAVE_POST') resumeQueue(); } }, error => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Capture failed.' }));
  return true;
});

chrome.runtime.onMessageExternal.addListener((message: unknown, sender, sendResponse) => {
  if (!isMemoarSender(sender)) return false;
  const action = isLibraryRequest(message) ? message.type === 'MEMOAR_TEST_NOTIFICATION' ? sendSavedPostNotification(true)
    : message.type === 'MEMOAR_NOTIFICATION_STATUS' ? notificationStatus() : libraryMessage(message)
    : isTakeRequest(message) ? session.take(message.captureId).then(async payload => ({ payload, mediaAssets: await claimMediaTransfer(message.captureId) }))
    : isMediaTransferRequest(message) ? transferMedia(message) : null;
  if (!action) return false;
  void action.then(
    result => { sendResponse({ ok: true, ...result }); resumeQueue(); },
    error => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Capture unavailable.' }),
  );
  return true;
});
