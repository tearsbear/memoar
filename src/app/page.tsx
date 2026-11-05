import Link from 'next/link';
import { PublicHeader, PublicFooter, OnboardingSteps, InstallGuide } from '@/components/public-memoar';

export default function Page() {
  return <div className="public-page">
    <PublicHeader />
    <main>
      <section className="landing-hero">
        <div>
          <p className="overline">For the things you want to come back to</p>
          <h1>Keep what<br />inspires you.<br /><span>Find it again.</span></h1>
          <p className="hero-description">A personal home for the posts, ideas, and little discoveries you save along the way.</p>
          <div className="action-row"><Link className="memoar-link-button" href="/getting-started#install">Get the extension</Link><Link className="plain-link" href="/setup">Open Memoar ↗</Link></div>
          <div className="supported-platforms">{['instagram', 'threads', 'facebook'].map(platform => <span key={platform}><img src={`/platforms/${platform}.svg`} width="17" height="17" alt="" />{platform[0].toUpperCase() + platform.slice(1)}</span>)}</div>
          <p className="hero-caveat">A Chrome preview. Capture availability varies by platform and post.</p>
        </div>
        <div className="brand-poster"><img src="/memoar-icon.png" width="512" height="512" alt="Memoar’s original white symbol on a blue background" /><div><span>A place to keep.</span><span>A reason to return.</span></div></div>
      </section>
      <section className="how-section"><div className="memoar-section-heading"><h2>From a passing moment<br />to a lasting idea.</h2><p>No account to set up.<br />Start with one save.</p></div><OnboardingSteps /></section>
      <InstallGuide />
      <section className="privacy-note"><h2>Your browser. Your collection.</h2><p>Saves stay in this browser profile, with the extension holding your library. Muse Spark automatically organizes captured text and supported media through Meta after each save. No account or automatic import of your social bookmarks.</p><p>Uninstalling the extension or resetting browser data can remove your local library.</p></section>
    </main>
    <PublicFooter />
  </div>;
}
