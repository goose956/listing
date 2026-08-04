import { getValidToken } from '../shared/auth';
import { fetchQueue, completeQueueItem } from '../shared/api';

const ALARM_NAME = 'la-badge-refresh';

// ── Setup ─────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  updateBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) updateBadge();
});

// Content scripts can't call the API directly (CORS), so they delegate here
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'COMPLETE_QUEUE_ITEM') {
    handleComplete(message.queueId as string)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }
});

// ── Badge update ──────────────────────────────────────────────
async function updateBadge() {
  try {
    const token = await getValidToken();
    if (!token) {
      chrome.action.setBadgeText({ text: '' });
      return;
    }

    const items = await fetchQueue(token);
    const dueCount = items.filter(i => new Date(i.scheduled_at).getTime() <= Date.now()).length;

    if (dueCount > 0) {
      chrome.action.setBadgeText({ text: String(dueCount) });
      chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ── Mark as listed ────────────────────────────────────────────
async function handleComplete(queueId: string) {
  const token = await getValidToken();
  if (!token) throw new Error('Not authenticated');
  await completeQueueItem(queueId, token);
  // Refresh badge immediately after marking listed
  updateBadge();
}
