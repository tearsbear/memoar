import type { LibraryPreferences } from './types';

export const REVIEW_DEMO_INTERVAL_MS = 3 * 60 * 1000;
export function reviewIntervalMs(cadence: LibraryPreferences['cadence']) {
  // Daily is accelerated to three minutes for the current demo.
  return cadence === 'daily' ? REVIEW_DEMO_INTERVAL_MS : (cadence === 'weekly' ? 7 : 30) * 86400000;
}
