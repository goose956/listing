import { getValidToken } from '../shared/auth';
import { fetchQueue } from '../shared/api';

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
