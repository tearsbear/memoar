'use client';

import { Theme } from '@astryxdesign/core/theme';
import { ToastViewport } from '@astryxdesign/core/Toast';
import { themes, defaultThemeSlug } from '../astryx-themes';

export function Providers({ children }: { children: React.ReactNode }) {
  return <Theme theme={themes[defaultThemeSlug]} mode="light"><ToastViewport position="bottomEnd"><div className="app-root memoar-theme">{children}</div></ToastViewport></Theme>;
}
