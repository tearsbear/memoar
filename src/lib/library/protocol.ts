import { isRecord } from '../capture/protocol';

export type LibraryRequest = { type: 'MEMOAR_PING' | 'MEMOAR_LIBRARY_SUMMARY' | 'MEMOAR_PREFERENCES' | 'MEMOAR_CLEAR' | 'MEMOAR_TEST_NOTIFICATION' | 'MEMOAR_NOTIFICATION_STATUS' }
  | { type: 'MEMOAR_SET_ACCESS_CODE'; code: string }
  | { type: 'MEMOAR_LIST_POSTS'; offset: number }
  | { type: 'MEMOAR_GET_POST' | 'MEMOAR_DELETE_POST' | 'MEMOAR_RETRY_AI' | 'MEMOAR_REVIEW'; id: string; action?: 'keep' | 'later' | 'open' }
  | { type: 'MEMOAR_GET_ASSET'; id: string; itemIndex: number; offset: number }
  | { type: 'MEMOAR_SET_PREFERENCES'; aiEnabled: boolean; reminders: boolean; cadence: 'daily' | 'weekly' | 'monthly'; ageDays: number };
export function isLibraryRequest(value: unknown): value is LibraryRequest {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  const only = (...keys: string[]) => Object.keys(value).every(key => ['type', ...keys].includes(key));
  if (['MEMOAR_PING', 'MEMOAR_LIBRARY_SUMMARY', 'MEMOAR_PREFERENCES', 'MEMOAR_CLEAR', 'MEMOAR_TEST_NOTIFICATION', 'MEMOAR_NOTIFICATION_STATUS'].includes(value.type)) return only();
  if (value.type === 'MEMOAR_SET_ACCESS_CODE') return only('code') && typeof value.code === 'string' && value.code.length >= 24 && value.code.length <= 256;
  if (value.type === 'MEMOAR_LIST_POSTS') return only('offset') && Number.isSafeInteger(value.offset) && Number(value.offset) >= 0 && Number(value.offset) <= 100000;
  if (value.type === 'MEMOAR_SET_PREFERENCES') return only('aiEnabled', 'reminders', 'cadence', 'ageDays') && typeof value.aiEnabled === 'boolean' && typeof value.reminders === 'boolean' && ['daily', 'weekly', 'monthly'].includes(String(value.cadence)) && [0, 1, 30, 60, 90].includes(Number(value.ageDays));
  if (typeof value.id !== 'string' || value.id.length > 300 || !/^(instagram|threads|facebook):[^\s]+$/.test(value.id)) return false;
  if (value.type === 'MEMOAR_GET_ASSET') return only('id', 'itemIndex', 'offset') && Number.isInteger(value.itemIndex) && Number(value.itemIndex) >= 0 && Number(value.itemIndex) < 20 && Number.isSafeInteger(value.offset) && Number(value.offset) >= 0 && Number(value.offset) < 50 * 1024 * 1024;
  if (value.type === 'MEMOAR_REVIEW') return only('id', 'action') && ['keep', 'later', 'open'].includes(String(value.action));
  return ['MEMOAR_GET_POST', 'MEMOAR_DELETE_POST', 'MEMOAR_RETRY_AI'].includes(value.type) && only('id');
}
