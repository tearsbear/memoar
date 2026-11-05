import type { CaptureEnvelope } from '../capture/normalize';

export type Enrichment = {
  category: string | null; topics: string[]; visualDescription: string | null;
  slides: { position: number | null; summary: string | null; keyInsights: string[] }[];
  objects: { name: string | null; type: string | null; attributes: string[]; evidence: { claim: string; source: string; text: string | null }[] }[];
  brands: { name: string; sources: string[] }[];
  visibleText: string[]; rawVisibleText: string[]; visualKeywords: string[]; searchableKeywords: string[];
  captionContext: { summary: string | null; productNames: string[]; locations: string[] };
};
export type LibraryAsset = { itemIndex: number; mimeType: string; blob: Blob; temporaryUntil?: number };
export type SavedPost = {
  version: 1; id: string; capture: CaptureEnvelope; savedAt: string; updatedAt: string;
  aiStatus: 'pending' | 'processing' | 'completed' | 'failed_retryable' | 'failed_terminal';
  aiConsent: boolean; aiError: string | null; enrichment: Enrichment | null;
  attempts: number; nextAttemptAt: number; leaseUntil: number; model: string | null;
  mediaStored: number[]; mediaNote: string | null;
  aiInputNote?: string;
  lastOpenedAt?: string; lastReviewedAt?: string; remindAfter?: string;
};
export type LibraryPreferences = { aiEnabled: boolean; reminders: boolean; cadence: 'daily' | 'weekly' | 'monthly'; ageDays: number };
export const defaultPreferences: LibraryPreferences = { aiEnabled: true, reminders: true, cadence: 'daily', ageDays: 0 };
