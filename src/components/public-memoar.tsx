import Link from 'next/link';
import { MemoarBrand } from './memoar-brand';

export function PublicHeader() { return <header className="public-header"><Link href="/" aria-label="Memoar home"><MemoarBrand /></Link><nav aria-label="Memoar"><Link href="/getting-started">Install guide</Link><Link className="memoar-link-button secondary" href="/setup">Open Memoar ↗</Link></nav></header>; }
export function OnboardingSteps() {
  return <div className="onboarding-steps">
    <article><span className="step-number">01</span><div className="step-art pin-art" aria-hidden="true"><img src="/memoar-icon.png" width="48" height="48" alt="" /><span>memoar</span><span className="pin-glyph">⌖</span></div><h2>Pin Memoar</h2><p>Keep it one click away in Chrome’s Extensions menu.</p></article>
    <article><span className="step-number">02</span><div className="step-art save-art" aria-hidden="true"><img src="/memoar-icon.png" width="28" height="28" alt="" /><span>Add to Memoar</span><span>＋</span></div><h2>Save a post</h2><p>Open a supported social post and choose Add to Memoar. Your save comes first; organizing can happen later.</p></article>
    <article><span className="step-number">03</span><div className="step-art search-art" aria-hidden="true"><span>⌕</span><span>Find that idea again…</span></div><h2>Rediscover it</h2><p>Search your saves, follow a collection, or return to an idea you nearly forgot.</p></article>
  </div>;
}
export function InstallGuide() {
  return <section id="install" className="install-guide"><div><p className="overline">Chrome desktop · Preview installation</p><h2>One small extension.<br />A place for everything you keep.</h2><p>This preview uses Chrome’s unpacked extension flow. A new downloadable package has not been built yet.</p><p>Use the project’s extension build instructions to prepare the updated folder, then follow these steps. The existing build may still contain the older inspector.</p><Link className="memoar-link-button" href="/setup">Check connection ↗</Link></div><ol><li>Prepare the updated extension folder and open <code>chrome://extensions</code> in Chrome.</li><li>Turn on <strong>Developer mode</strong>, then select <strong>Load unpacked</strong>.</li><li>Choose the built extension folder containing <code>manifest.json</code>.</li><li>Pin Memoar from the Extensions menu.</li><li>Open Memoar’s popup and choose <strong>Your library</strong> to connect this browser profile.</li></ol><p className="install-footnote">After an update, rebuild the extension yourself, click Reload on its Chrome extension card, and reopen Memoar. Instagram and Threads use the existing capture paths; Facebook and mixed media support may be partial.</p></section>;
}
export function PublicFooter() { return <footer className="public-footer"><MemoarBrand /><p>Good ideas deserve a way back.</p><Link href="/getting-started#install">Install Memoar</Link></footer>; }
