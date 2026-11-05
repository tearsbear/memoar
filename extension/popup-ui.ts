import { parsePostUrl } from '../src/lib/inspection/parse-url';

export function mountPopup(root: ParentNode, pageUrl: string, icons: Record<string, string>) {
  const save = root.querySelector<HTMLButtonElement>('#capture')!;
  const open = root.querySelector<HTMLButtonElement>('#open')!;
  const status = root.querySelector<HTMLParagraphElement>('#status')!;
  const loading = root.querySelector<HTMLElement>('#saving-state')!;
  let savedId: string | null = null;
  function saved(id: string, duplicate: boolean) {
    savedId = id; open.hidden = false; save.hidden = true;
    status.textContent = duplicate ? 'Already in Memoar.' : 'Saved to Memoar. Open your library to explore it.';
  }
  async function initialize() {
    let parsed;
    try { parsed = parsePostUrl(pageUrl); }
    catch {
      root.querySelector('#platform')!.textContent = 'No supported post';
      status.textContent = 'Open a supported Instagram, Threads, or Facebook post to save it.';
      return;
    }
    root.querySelector('#platform')!.textContent = parsed.platform.charAt(0).toUpperCase() + parsed.platform.slice(1);
    const icon = root.querySelector<HTMLImageElement>('#platform-icon')!;
    icon.src = icons[parsed.platform]; icon.hidden = false;
    const url = root.querySelector<HTMLElement>('#page-url')!;
    url.textContent = parsed.normalizedUrl; url.title = parsed.normalizedUrl;
    status.textContent = parsed.platform === 'facebook' ? 'Facebook capture may be partial. Only available post content is saved.' : '';
    const response = await chrome.runtime.sendMessage({ type: 'FIND_SAVED', url: parsed.normalizedUrl });
    if (!response?.ok) throw new Error(response?.error || 'Could not check your saved posts. Reopen Memoar to retry.');
    if (response.result?.post) {
      if (response.result.post.id !== `${parsed.platform}:${parsed.postId}`) throw new Error('The saved result belongs to a different post. Reopen Memoar to check this post again.');
      saved(response.result.post.id, true);
    }
    save.disabled = false;
  }
  save.addEventListener('click', () => {
    save.disabled = true; save.textContent = 'Saving your post…';
    save.hidden = true; open.hidden = true; loading.hidden = false;
    status.textContent = '';
    void chrome.runtime.sendMessage({ type: 'SAVE_POST', url: pageUrl }).then(response => {
      if (!response?.ok || !response.result?.postId) throw new Error(response?.error ?? 'Couldn’t save this post. Try again.');
      saved(response.result.postId, response.result.duplicate === true);
    }).catch(error => { status.textContent = error instanceof Error ? error.message : 'Couldn’t save this post. Try again.'; save.textContent = 'Try saving again'; }).finally(() => { loading.hidden = true; save.disabled = false; save.hidden = Boolean(savedId); });
  });
  function openLibrary(detail: boolean) {
    void chrome.runtime.sendMessage({ type: 'OPEN_LIBRARY', postId: detail ? savedId : null }).then(response => {
      if (!response?.ok) throw new Error('Couldn’t open Memoar. Try again.');
    }).catch(() => { status.textContent = 'Couldn’t open Memoar. Try again.'; });
  }
  open.addEventListener('click', () => openLibrary(true));
  root.querySelector('#library')!.addEventListener('click', () => openLibrary(false));
  void initialize().catch(error => { status.textContent = error instanceof Error ? error.message : 'Close and reopen Memoar to check this tab again.'; });
}
