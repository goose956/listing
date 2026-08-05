import { supabase } from '../shared/supabase';
import { saveAuth, clearAuth, getValidToken } from '../shared/auth';
import { fetchQueue } from '../shared/api';
import type { QueueItem } from '../shared/types';

// ── DOM refs ─────────────────────────────────────────────────
const loginView = document.getElementById('login-view')!;
const queueView = document.getElementById('queue-view')!;
const loginForm = document.getElementById('login-form') as HTMLFormElement;
const emailInput = document.getElementById('email') as HTMLInputElement;
const passwordInput = document.getElementById('password') as HTMLInputElement;
const loginBtn = document.getElementById('login-btn') as HTMLButtonElement;
const loginError = document.getElementById('login-error')!;
const logoutBtn = document.getElementById('logout-btn')!;
const queueHint = document.getElementById('queue-hint')!;
const queueList = document.getElementById('queue-list')!;
const queueError = document.getElementById('queue-error')!;

// ── Init ──────────────────────────────────────────────────────
async function init() {
  const token = await getValidToken();
  if (token) {
    await showQueueView(token);
  } else {
    showLoginView();
  }
}

// ── Login ─────────────────────────────────────────────────────
function showLoginView() {
  loginView.classList.remove('hidden');
  queueView.classList.add('hidden');
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');
  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in…';

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailInput.value.trim(),
      password: passwordInput.value,
    });

    if (error || !data.session) {
      throw new Error(error?.message ?? 'Login failed');
    }

    await saveAuth({
      jwt: data.session.access_token,
      refreshToken: data.session.refresh_token,
      email: data.user!.email ?? '',
      expiresAt: data.session.expires_at! * 1000,
    });

    passwordInput.value = '';
    await showQueueView(data.session.access_token);
  } catch (err) {
    loginError.textContent = err instanceof Error ? err.message : 'Login failed';
    loginError.classList.remove('hidden');
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Log in';
  }
});

// ── Logout ────────────────────────────────────────────────────
logoutBtn.addEventListener('click', async () => {
  await clearAuth();
  showLoginView();
});

// ── Queue view ────────────────────────────────────────────────
async function showQueueView(token: string) {
  loginView.classList.add('hidden');
  queueView.classList.remove('hidden');
  queueList.innerHTML = '<div class="loading">Loading queue…</div>';
  queueError.classList.add('hidden');

  try {
    const items = await fetchQueue(token);
    renderQueue(items, token);
  } catch (err) {
    queueList.innerHTML = '';
    queueError.textContent = err instanceof Error ? err.message : 'Failed to load queue';
    queueError.classList.remove('hidden');
  }
}

function renderQueue(items: QueueItem[], token: string) {
  const dueCount = items.filter(i => new Date(i.scheduled_at).getTime() <= Date.now()).length;

  if (dueCount > 0) {
    queueHint.textContent = `${dueCount} item${dueCount > 1 ? 's' : ''} due now`;
    queueHint.className = 'hint due';
    queueHint.classList.remove('hidden');
  } else if (items.length > 0) {
    queueHint.textContent = `${items.length} item${items.length > 1 ? 's' : ''} scheduled`;
    queueHint.className = 'hint';
    queueHint.classList.remove('hidden');
  } else {
    queueHint.classList.add('hidden');
  }

  if (items.length === 0) {
    queueList.innerHTML = `
      <div class="empty-state">
        <strong>Queue is empty</strong>
        Go to your app and schedule some items to list.
      </div>`;
    return;
  }

  queueList.innerHTML = '';
  for (const item of items) {
    queueList.appendChild(buildItemCard(item, token));
  }
}

function buildItemCard(item: QueueItem, token: string): HTMLElement {
  const isDue = new Date(item.scheduled_at).getTime() <= Date.now();
  const primaryImage = item.images.find(i => i.is_primary) ?? item.images[0];

  const card = document.createElement('div');
  card.className = 'item-card';

  const thumbHtml = primaryImage
    ? `<img class="item-thumb" src="${primaryImage.url}" alt="" loading="lazy">`
    : `<div class="item-thumb-placeholder"></div>`;

  const detailParts = [item.brand, item.size, item.price != null ? `£${item.price}` : null].filter(Boolean);
  const timeLabel = formatScheduledAt(item.scheduled_at, isDue);

  card.innerHTML = `
    <div class="item-header">
      ${thumbHtml}
      <div class="item-meta">
        <div class="item-number">${item.item_number}</div>
        <div class="item-title">${item.title ?? 'Untitled item'}</div>
        <div class="item-detail">${detailParts.join(' · ')}</div>
        <div class="item-time${isDue ? ' due' : ''}">${timeLabel}</div>
      </div>
    </div>
    <button class="btn-fill" data-queue-id="${item.queue_id}">Fill Vinted form</button>`;

  card.querySelector('.btn-fill')!.addEventListener('click', () => handleFillForm(item, card, token));
  return card;
}

async function handleFillForm(item: QueueItem, card: HTMLElement, token: string) {
  const btn = card.querySelector('.btn-fill') as HTMLButtonElement;

  // Check we're on the Vinted sell page
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.id || !tab.url?.match(/vinted\.[^/]+\/items\/new/)) {
    btn.textContent = 'Open Vinted\'s sell page first';
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = 'Fill Vinted form';
      btn.disabled = false;
    }, 2500);
    return;
  }

  btn.textContent = 'Filling…';
  btn.disabled = true;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'FILL_FORM', item });
    btn.textContent = '✓ Done — upload photos + publish';
    btn.style.background = '#16a34a';
  } catch {
    btn.textContent = 'Could not reach page — try refreshing';
    setTimeout(() => {
      btn.textContent = 'Fill Vinted form';
      btn.disabled = false;
      btn.style.background = '';
    }, 2500);
  }
}

// ── Helpers ───────────────────────────────────────────────────
function formatScheduledAt(isoString: string, isDue: boolean): string {
  if (isDue) return '⏰ Due now';
  const d = new Date(isoString);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Today at ${time}`;
  if (isTomorrow) return `Tomorrow at ${time}`;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ` at ${time}`;
}

// ── Start ─────────────────────────────────────────────────────
init();
