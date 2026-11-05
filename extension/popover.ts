import html from './popup.html';
import css from './popup.css';
import icon from './memoar-icon.png';
import instagram from '../public/platforms/instagram.svg';
import threads from '../public/platforms/threads.svg';
import facebook from '../public/platforms/facebook.svg';
import { mountPopup } from './popup-ui';

type PopoverState = { host: HTMLDivElement; close: () => void };
const scope = globalThis as typeof globalThis & { __memoarPopover?: PopoverState };

if (scope.__memoarPopover) scope.__memoarPopover.close();
else {
  const previousFocus = document.activeElement;
  const host = document.createElement('div');
  host.style.cssText = 'all:initial!important;font:14px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;color:#12171c!important;color-scheme:light!important;position:fixed!important;inset:16px 16px auto auto!important;width:min(360px,calc(100vw - 32px))!important;z-index:2147483647!important;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = css + `
    :host { color-scheme:light; color:#12171c; font:14px Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .panel { position:relative; background:#f6f8fa; border:1px solid #e8edf0; border-radius:24px; box-shadow:0 12px 48px rgb(13 38 54 / 22%); max-height:calc(100dvh - 32px); overflow-y:auto; }
    main { padding-top:42px; }
    .close { position:absolute; top:9px; right:10px; width:30px; height:30px; border:0; border-radius:50%; background:transparent; color:#566570; font-size:22px; cursor:pointer; }
    .close:hover { background:#e8edf0; }
    @media (prefers-reduced-motion:reduce) { * { scroll-behavior:auto; } }
  `;
  const panel = document.createElement('section');
  panel.className = 'panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Memoar');
  const markup = new DOMParser().parseFromString(html, 'text/html').querySelector('main')!;
  panel.append(document.importNode(markup, true));
  panel.querySelector<HTMLImageElement>('header img')!.src = icon;
  const close = document.createElement('button');
  close.className = 'close'; close.textContent = '×'; close.setAttribute('aria-label', 'Close Memoar');
  panel.prepend(close); shadow.append(style, panel);
  document.documentElement.append(host);
  const state: PopoverState = { host, close: () => {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onOutside, true);
    host.remove(); delete scope.__memoarPopover;
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
  } };
  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); state.close(); }
  }
  function onOutside(event: PointerEvent) { if (!event.composedPath().includes(host)) state.close(); }
  close.addEventListener('click', state.close);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onOutside, true);
  scope.__memoarPopover = state;
  const data = (svg: string) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  mountPopup(shadow, location.href, { instagram: data(instagram), threads: data(threads), facebook: data(facebook) });
  close.focus({ preventScroll: true });
}
