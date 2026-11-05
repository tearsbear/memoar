import { notFound } from 'next/navigation';
import { PostInspector } from '@/components/post-inspector';
export default function InspectorPage() { if (process.env.NODE_ENV === 'production' && process.env.MEMOAR_DEV_INSPECTOR !== 'true') notFound(); return <PostInspector />; }
