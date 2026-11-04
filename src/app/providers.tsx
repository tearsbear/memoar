'use client';

import { Theme } from '@astryxdesign/core/theme';
import { ToastViewport } from '@astryxdesign/core/Toast';
import { themes, defaultThemeSlug } from '../astryx-themes';

export function Providers({ children }: { children: React.ReactNode }) {
  return <Theme theme={themes[defaultThemeSlug]} mode="dark"><ToastViewport position="bottomEnd"><div className="app-root">{children}</div></ToastViewport></Theme>;
}
