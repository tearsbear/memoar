import { parsePostUrl } from '../src/lib/inspection/parse-url';
import { MEMOAR_ORIGIN } from '../src/lib/capture/protocol';

const save = document.querySelector<HTMLButtonElement>('#capture')!;
const open = document.querySelector<HTMLButtonElement>('#open')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
let savedId: string | null = null;
function saved(id: string, duplicate: boolean) {
  savedId = id; open.hidden = false; save.hidden = true;
  status.textContent = duplicate ? 'Already in Memoar.' : 'Saved to Memoar. Open your library to explore it.';
}
async function initialize() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const parsed = parsePostUrl(tab?.url);
    document.querySelector('#platform')!.textContent = parsed.platform.charAt(0).toUpperCase() + parsed.platform.slice(1);
    const icon = document.querySelector<HTMLImageElement>('#platform-icon')!;
    icon.src = `platforms/${parsed.platform}.svg`; icon.hidden = false;
    const url = document.querySelector<HTMLElement>('#page-url')!;
    url.textContent = parsed.normalizedUrl; url.title = parsed.normalizedUrl;
    status.textContent = parsed.platform === 'facebook' ? 'Facebook capture may be partial. Only available post content is saved.' : '';
    save.disabled = false;
    const response = await chrome.runtime.sendMessage({ type: 'FIND_SAVED', url: parsed.normalizedUrl });
    if (response?.ok && response.result?.post) saved(response.result.post.id, true);
  } catch {
    document.querySelector('#platform')!.textContent = 'No supported post';
    document.querySelector<HTMLImageElement>('#platform-icon')!.hidden = true;
    status.textContent = 'Open a supported Instagram, Threads, or Facebook post to save it.';
  }
}
save.addEventListener('click', () => {
  save.disabled = true; save.textContent = 'Saving your post…';
  status.textContent = 'Keep the post open while Memoar captures its available content. Carousels may move through slides.';
  void chrome.runtime.sendMessage({ type: 'SAVE_POST' }).then(response => {
    if (!response?.ok || !response.result?.postId) throw new Error(response?.error ?? 'Couldn’t save this post. Try again.');
    saved(response.result.postId, response.result.duplicate === true);
  }).catch(error => { status.textContent = error instanceof Error ? error.message : 'Couldn’t save this post. Try again.'; save.textContent = 'Try saving again'; }).finally(() => { save.disabled = false; });
});
function openLibrary(detail: boolean) {
  const url = new URL(detail && savedId ? `/app/saved/${encodeURIComponent(savedId)}` : '/setup', MEMOAR_ORIGIN);
  url.searchParams.set('extensionId', chrome.runtime.id);
  void chrome.tabs.create({ url: url.href }).catch(() => { status.textContent = 'Couldn’t open Memoar. Try again.'; });
}
open.addEventListener('click', () => openLibrary(true));
document.querySelector('#library')!.addEventListener('click', () => openLibrary(false));
void initialize().catch(() => { status.textContent = 'Close and reopen Memoar to check this tab again.'; });
