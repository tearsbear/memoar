import Link from 'next/link';
import { PublicHeader, PublicFooter, OnboardingSteps, InstallGuide } from '@/components/public-memoar';
export default function GettingStartedPage() {
  return <div className="public-page"><PublicHeader /><main>
    <header className="onboarding-heading"><p className="overline">Make room for a little inspiration</p><h1>Your next good idea<br />has a home.</h1><p>Pin it. Save it. Come back when you need it.</p></header>
    <OnboardingSteps />
    <div className="onboarding-action"><Link className="memoar-link-button" href="/setup">Connect my extension ↗</Link><a href="#install">Need to install Memoar first?</a></div>
    <InstallGuide />
  </main><PublicFooter /></div>;
}
