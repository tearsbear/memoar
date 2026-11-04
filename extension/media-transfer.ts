import { MEDIA_CHUNK_BYTES, parseCapturedAssetInfo, type CapturedAssetInfo } from '../src/lib/capture/media-cache';
import type { CaptureEnvelope } from '../src/lib/capture/normalize';
import type { MediaTransferRequest } from '../src/lib/capture/protocol';
import { parsePostUrl } from '../src/lib/inspection/parse-url';
import { samePost } from './adapters/dom';

type Transfer = { captureId: string; tabId: number; url: string; nonce: string; expiresAt: number; claimed: boolean; assets: CapturedAssetInfo[] };
const key = 'mediaTransfer';

export async function rememberMediaTransfer(captureId: string, payload: CaptureEnvelope, tabId: number, url: string, nonce: string, expiresAt: number, rawAssets: unknown): Promise<void> {
  const assets = parseCapturedAssetInfo(rawAssets, payload.inspection.media);
  await chrome.storage.session.set({ [key]: { captureId, tabId, url, nonce, expiresAt, assets, claimed: false } satisfies Transfer });
}

async function current(captureId: string): Promise<Transfer | null> {
  const value = (await chrome.storage.session.get(key))[key] as Transfer | undefined;
  if (!value || value.captureId !== captureId) return null;
  if (value.expiresAt <= Date.now()) { await chrome.storage.session.remove(key); return null; }
  return value;
}

export async function claimMediaTransfer(captureId: string): Promise<CapturedAssetInfo[] | undefined> {
  const value = await current(captureId);
  if (!value) return;
  await chrome.storage.session.set({ [key]: { ...value, claimed: true } });
  return value.assets;
}

export async function transferMedia(request: MediaTransferRequest): Promise<{ base64?: string }> {
  const value = await current(request.captureId);
  if (!value || !value.claimed) throw new Error('Captured media expired or was already imported. Capture the post again.');
  if (request.type === 'RELEASE_MEDIA') {
    await chrome.storage.session.remove(key);
    try {
      await chrome.scripting.executeScript({ target: { tabId: value.tabId, frameIds: [0] }, world: 'ISOLATED',
        func: (nonce: string) => {
          const scope = globalThis as typeof globalThis & { __memoarCapturedMedia?: { nonce: string; assets: unknown[] } };
          if (scope.__memoarCapturedMedia?.nonce === nonce) { scope.__memoarCapturedMedia.assets.length = 0; delete scope.__memoarCapturedMedia; }
        }, args: [value.nonce],
      });
    } catch { /* Closing the source tab also releases its in-memory media. */ }
    return {};
  }
  const asset = value.assets.find(item => item.itemIndex === request.itemIndex);
  if (!asset || request.offset % MEDIA_CHUNK_BYTES || request.offset >= asset.byteLength) throw new Error('Invalid captured media chunk request.');
  const tab = await chrome.tabs.get(value.tabId);
  if (!tab.url || !samePost(tab.url, parsePostUrl(value.url))) throw new Error('The source post changed before its media was imported. Capture again.');
  const result = await chrome.scripting.executeScript({ target: { tabId: value.tabId, frameIds: [0] }, world: 'ISOLATED',
    func: (nonce: string, itemIndex: number, offset: number, length: number, expectedUrl: string) => {
      const scope = globalThis as typeof globalThis & { __memoarCapturedMedia?: {
        nonce: string; expiresAt: number; assets: { itemIndex: number; bytes: Uint8Array }[];
      } };
      const cache = scope.__memoarCapturedMedia;
      if (!cache || cache.nonce !== nonce || cache.expiresAt <= Date.now() || document.location.href !== expectedUrl) throw new Error('Captured media is no longer available. Capture again.');
      const bytes = cache.assets.find(item => item.itemIndex === itemIndex)?.bytes;
      if (!bytes || offset >= bytes.length) throw new Error('Captured media bytes are missing. Capture again.');
      const chunk = bytes.subarray(offset, offset + length);
      let binary = '';
      for (let i = 0; i < chunk.length; i += 16384) binary += String.fromCharCode(...chunk.subarray(i, i + 16384));
      return btoa(binary);
    }, args: [value.nonce, request.itemIndex, request.offset, MEDIA_CHUNK_BYTES, tab.url],
  });
  const base64 = result[0]?.result;
  if (typeof base64 !== 'string') throw new Error('Captured media transfer failed. Capture the post again.');
  return { base64 };
}
