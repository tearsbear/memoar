import { Suspense } from 'react';
import { ExploreLibrary } from '@/components/explore-library';
export default async function CollectionPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <Suspense fallback={<p>Preparing your collection…</p>}><ExploreLibrary collectionId={id} /></Suspense>; }
