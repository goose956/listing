import type { QueueItem } from '../shared/types';

// ── Selectors ─────────────────────────────────────────────────────────────────
// eBay's sell form uses a multi-step wizard. Selectors target the most stable
// attributes — update here if eBay redesigns the form.
const SELECTORS = {
  title: [
    'input[id*="title"]',
    'input[placeholder*="title" i]',
    'input[aria-label*="title" i]',
    'input[name="title"]',
  ],
  description: [
    'textarea[id*="description"]',
    'textarea[placeholder*="description" i]',
    'textarea[aria-label*="description" i]',
    'textarea[name="description"]',
  ],
  price: [
    'input[id*="startPrice"]',
    'input[id*="price"]',
    'input[placeholder*="price" i]',
    'input[aria-label*="price" i]',
    'input[name="startPrice"]',
    'input[name="price"]',
  ],
};

// ── State ─────────────────────────────────────────────────────────────────────
let sidebarRoot: HTMLElement | null = null;
const ACCENT = '#3b82f6'; // eBay blue

// ── Message listener ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FILL_FORM') {
    const item = message.item as QueueItem;
    fillEbayForm(item)
      .then((status) => sendResponse({ success: true, status }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }
  if (message.type === 'SHOW_SIDEBAR') {
    const item = message.item as QueueItem;
    showSidebar(item);
    sendResponse({ success: true });
    return true;
  }
});

// ── Form filling ──────────────────────────────────────────────────────────────
async function fillEbayForm(item: QueueItem): Promise<Record<string, boolean>> {
  const status: Record<string, boolean> = {};

  const price = item.platform_prices?.ebay ?? item.price;

  const fields: [keyof typeof SELECTORS, string | null][] = [
    ['title', item.title],
    ['description', item.description],
    ['price', price != null ? String(price) : null],
  ];

  for (const [field, value] of fields) {
    if (!value) continue;
    const el = findElement(SELECTORS[field]);
    if (el) {
      status[field] = setInputValue(el, value);
    } else {
      status[field] = false;
    }
  }

  return status;
}

// ── DOM helpers ───────────────────────────────────────────────────────────────
function findElement(selectors: string[]): HTMLElement | null {
  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return null;
}

function setInputValue(el: HTMLElement, value: string): boolean {
  try {
    const nativeInputSetter = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )?.set;
    nativeInputSetter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function showSidebar(item: QueueItem) {
  if (sidebarRoot) sidebarRoot.remove();

  const host = document.createElement('div');
  host.id = 'la-ebay-sidebar-host';
  host.style.cssText = 'position:fixed;top:80px;right:16px;z-index:2147483647;';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    .la-sidebar {
      width: 280px;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.18);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      overflow: hidden;
    }
    .la-header {
      background: ${ACCENT};
      color: #fff;
      padding: 10px 14px;
      font-weight: 700;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .la-body { padding: 12px 14px; }
    .la-title { font-weight: 600; color: #1e293b; margin-bottom: 4px; word-break: break-word; }
    .la-meta { color: #64748b; font-size: 12px; margin-bottom: 10px; }
    .la-price { font-size: 18px; font-weight: 700; color: ${ACCENT}; margin-bottom: 12px; }
    .la-btn {
      display: block;
      width: 100%;
      padding: 8px 0;
      border-radius: 8px;
      border: none;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      margin-bottom: 8px;
    }
    .la-btn-primary { background: ${ACCENT}; color: #fff; }
    .la-btn-primary:hover { opacity: 0.9; }
    .la-btn-ghost { background: #f1f5f9; color: #475569; }
    .la-btn-ghost:hover { background: #e2e8f0; }
    .la-close { background: none; border: none; color: #fff; cursor: pointer; font-size: 18px; line-height: 1; }
  `;

  const price = item.platform_prices?.ebay ?? item.price;
  const priceStr = price != null ? `£${Number(price).toFixed(2)}` : '—';

  const sidebar = document.createElement('div');
  sidebar.className = 'la-sidebar';
  sidebar.innerHTML = `
    <div class="la-header">
      <span>Starsella · eBay</span>
      <button class="la-close" id="la-close">✕</button>
    </div>
    <div class="la-body">
      <div class="la-title">${escHtml(item.title ?? 'Untitled')}</div>
      <div class="la-meta">${escHtml([item.brand, item.size, item.condition].filter(Boolean).join(' · '))}</div>
      <div class="la-price">${priceStr}</div>
      <button class="la-btn la-btn-primary" id="la-fill">Fill form fields</button>
      <button class="la-btn la-btn-ghost" id="la-done">Mark as listed</button>
    </div>
  `;

  shadow.appendChild(style);
  shadow.appendChild(sidebar);
  sidebarRoot = host;

  shadow.getElementById('la-close')?.addEventListener('click', () => host.remove());

  shadow.getElementById('la-fill')?.addEventListener('click', async () => {
    const status = await fillEbayForm(item);
    const filled = Object.values(status).filter(Boolean).length;
    const total = Object.keys(status).length;
    const btn = shadow.getElementById('la-fill') as HTMLButtonElement;
    btn.textContent = `✓ Filled ${filled}/${total} fields`;
    btn.disabled = true;
  });

  shadow.getElementById('la-done')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'COMPLETE_QUEUE_ITEM', queueId: item.queue_id });
    host.remove();
  });
}

function escHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
