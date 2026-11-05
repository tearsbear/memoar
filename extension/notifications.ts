import { savedLibrary } from './library';
import { postTitle } from '../src/lib/library/search';
import { MEMOAR_ORIGIN } from '../src/lib/capture/protocol';

const alarmName = 'memoar-revisit';
const prefix = 'memoar-revisit:';
const intervalMinutes = 3;
let sending = false;
type NotificationState = { postId?: string; lastSentAt?: number; error?: string | null };

async function notificationState(): Promise<NotificationState> {
  const value = await chrome.storage.local.get('notificationState');
  return (value.notificationState ?? {}) as NotificationState;
}

export async function ensureNotificationAlarm() {
  const alarm = await chrome.alarms.get(alarmName);
  if (!alarm || alarm.periodInMinutes !== intervalMinutes) await chrome.alarms.create(alarmName, { delayInMinutes: intervalMinutes, periodInMinutes: intervalMinutes });
}

export async function notificationStatus() {
  const [permission, alarm, state] = await Promise.all([
    chrome.notifications.getPermissionLevel(), chrome.alarms.get(alarmName), notificationState(),
  ]);
  return { permission, intervalMinutes, nextAt: alarm?.scheduledTime ?? null, error: state.error ?? null };
}

export async function sendSavedPostNotification(test = false) {
  if (sending) throw new Error('A notification is already being sent. Try again in a moment.');
  sending = true;
  try {
    if (await chrome.notifications.getPermissionLevel() !== 'granted') throw new Error('Notifications are blocked for Memoar. Allow them in Chrome’s extension settings.');
    const state = await notificationState();
    if (!test && typeof state?.lastSentAt === 'number' && Date.now() - state.lastSentAt < intervalMinutes * 60000) return {};
    const posts = (await savedLibrary.list()).sort((a, b) => a.savedAt.localeCompare(b.savedAt) || a.id.localeCompare(b.id));
    if (!posts.length) {
      if (test) throw new Error('Save a post first so the test notification can open its details.');
      return {};
    }
    const previousIndex = posts.findIndex(post => post.id === state?.postId);
    const post = posts[(previousIndex + 1) % posts.length];
    const active = await chrome.notifications.getAll();
    await Promise.all(Object.keys(active).filter(id => id.startsWith(prefix)).map(id => chrome.notifications.clear(id)));
    await chrome.notifications.create(prefix + encodeURIComponent(post.id), {
      type: 'basic', iconUrl: chrome.runtime.getURL('memoar-icon.png'),
      title: test ? 'Memoar · Test notification' : 'Worth revisiting?',
      message: postTitle(post).replace(/\s+/g, ' ').trim().slice(0, 160),
      contextMessage: 'Click to open this saved post in Memoar.',
    });
    await chrome.storage.local.set({ notificationState: { postId: post.id, lastSentAt: Date.now(), error: null } });
    return { postId: post.id };
  } catch (error) {
    const previous = await notificationState();
    await chrome.storage.local.set({ notificationState: { ...previous, error: error instanceof Error ? error.message : 'Could not send a notification.' } });
    throw error;
  } finally { sending = false; }
}

export function initializeNotifications() {
  const schedule = () => { void ensureNotificationAlarm().catch(() => {}); };
  chrome.runtime.onInstalled.addListener(schedule);
  chrome.runtime.onStartup.addListener(schedule);
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === alarmName) void sendSavedPostNotification().catch(() => {});
  });
  chrome.notifications.onClicked.addListener(notificationId => {
    if (!notificationId.startsWith(prefix)) return;
    void (async () => {
      const id = decodeURIComponent(notificationId.slice(prefix.length));
      const post = await savedLibrary.get(id);
      const url = new URL(post ? `/app/saved/${encodeURIComponent(post.id)}` : '/app/explore', MEMOAR_ORIGIN);
      url.searchParams.set('extensionId', chrome.runtime.id);
      await chrome.tabs.create({ url: url.href });
      await chrome.notifications.clear(notificationId);
    })().catch(() => {});
  });
  schedule();
}
