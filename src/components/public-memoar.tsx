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
  return <section id="install" className="install-guide"><div><p className="overline">Chrome desktop · Preview installation</p><h2>One small extension.<br />A place for everything you keep.</h2><p>Download the ZIP and extract it before loading the extension into Chrome.</p><div className="action-row"><a className="memoar-link-button" href="/api/extension/download">Download extension ZIP</a><Link className="plain-link" href="/setup">Check connection ↗</Link></div></div><ol><li>Download and extract <code>memoar-extension.zip</code> to a folder you will keep.</li><li>Open <code>chrome://extensions</code> and turn on <strong>Developer mode</strong>, then select <strong>Load unpacked</strong>.</li><li>Choose the extracted folder containing <code>manifest.json</code>, not the ZIP file.</li><li>Pin Memoar from the Extensions menu.</li><li>Open Memoar’s popup and choose <strong>Your library</strong> to connect this browser profile.</li></ol><p className="install-footnote">After an update, download the new ZIP and replace the files in the same extracted folder, click Reload on its Chrome extension card, and refresh the social tab. Instagram and Threads use the existing capture paths; Facebook and mixed media support may be partial.</p></section>;
}
export function PublicFooter() { return <footer className="public-footer"><MemoarBrand /><p>Good ideas deserve a way back.</p><Link href="/getting-started#install">Install Memoar</Link></footer>; }
