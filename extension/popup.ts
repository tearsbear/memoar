import { parsePostUrl } from '../src/lib/inspection/parse-url';
import { normalizeCapture, type CaptureEnvelope } from '../src/lib/capture/normalize';
import { MEMOAR_ORIGIN, CAPTURE_ID } from '../src/lib/capture/protocol';

const captureButton = document.querySelector<HTMLButtonElement>('#capture')!;
const openButton = document.querySelector<HTMLButtonElement>('#open')!;
const copyButton = document.querySelector<HTMLButtonElement>('#copy')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
let current: { captureId: string; payload: CaptureEnvelope; expiresAt: number } | null = null;

function setResult(result: typeof current) {
  current = result;
  openButton.disabled = !result;
  copyButton.disabled = !result;
}

async function initialize() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const parsed = parsePostUrl(tab?.url);
    document.querySelector('#platform')!.textContent = `${parsed.platform.charAt(0).toUpperCase()}${parsed.platform.slice(1)} post`;
    document.querySelector('#page-url')!.textContent = parsed.normalizedUrl;
    captureButton.disabled = false;
  } catch {
    document.querySelector('#platform')!.textContent = 'No supported post';
    document.querySelector('#page-url')!.textContent = 'Open a specific Instagram, Threads, or Facebook post permalink.';
  }
  const previous = await chrome.runtime.sendMessage({ type: 'LAST_CAPTURE' });
  if (previous?.ok && previous.result) {
    setResult({ ...previous.result, payload: normalizeCapture(previous.result.payload) });
    status.textContent = 'A previous capture is available briefly for Open in Memoar or manual JSON copy.';
  }
}

captureButton.addEventListener('click', () => {
  captureButton.disabled = true;
  setResult(null);
  document.querySelector<HTMLTextAreaElement>('#manual-copy')!.hidden = true;
  const allSlides = document.querySelector<HTMLInputElement>('#all-slides')!.checked;
  status.textContent = allSlides ? 'Capturing carousel slides and checking permitted image resources…' : 'Reading the visible active post and checking permitted image resources…';
  void chrome.runtime.sendMessage({ type: 'START_CAPTURE', allSlides }).then(response => {
    if (!response?.ok) throw new Error(response?.error ?? 'Capture did not return a result.');
    const payload = normalizeCapture(response.result.payload);
    setResult({ ...response.result, payload });
    const count = Object.entries(payload.inspection.fields).filter(([key, field]) => key !== 'postId' && field.status === 'available').length;
    status.textContent = `Partial capture: ${count} content fields available. ${payload.snapshot?.status === 'available' ? 'Captured snapshot included.' : 'Snapshot unavailable.'} Review missing values and permission limits in Memoar.`;
  }).catch(error => {
    status.textContent = error instanceof Error ? error.message : 'Capture failed.';
  }).finally(() => { captureButton.disabled = false; });
});

openButton.addEventListener('click', () => {
  if (!current || !CAPTURE_ID.test(current.captureId) || current.expiresAt <= Date.now()) {
    status.textContent = 'Capture expired. Capture the post again.'; setResult(null); return;
  }
  const url = new URL(MEMOAR_ORIGIN);
  url.searchParams.set('captureId', current.captureId);
  url.searchParams.set('extensionId', chrome.runtime.id);
  void chrome.tabs.create({ url: url.href }).catch(() => { status.textContent = 'Could not open Memoar. Copy captured JSON instead.'; });
});

copyButton.addEventListener('click', () => {
  if (!current || current.expiresAt <= Date.now()) { setResult(null); status.textContent = 'Capture expired. Capture again.'; return; }
  const json = JSON.stringify(current.payload, null, 2);
  void Promise.resolve().then(() => {
    if (!navigator.clipboard) throw new Error('Clipboard unavailable.');
    return navigator.clipboard.writeText(json);
  }).then(() => { status.textContent = 'Captured JSON copied. In Memoar, choose Paste captured JSON.'; }).catch(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>('#manual-copy')!;
    textarea.value = json; textarea.hidden = false; textarea.focus(); textarea.select();
    status.textContent = 'Clipboard unavailable. Copy the selected JSON manually.';
  });
});

void initialize().catch(() => { status.textContent = 'Could not initialize the extension. Close and reopen this popup.'; });
