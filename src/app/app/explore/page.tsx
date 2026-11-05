import { Suspense } from 'react';
import { ExploreLibrary } from '@/components/explore-library';
export default function ExplorePage() { return <Suspense fallback={<p>Preparing your library…</p>}><ExploreLibrary /></Suspense>; }
