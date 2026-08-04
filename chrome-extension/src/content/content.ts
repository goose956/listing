import type { QueueItem } from '../shared/types';

// ── Selectors ─────────────────────────────────────────────────
// Multiple fallbacks per field — Vinted may use any of these patterns.
// If a field is not being filled, open DevTools on /items/new, inspect
// the input, and add its selector here.
const SELECTORS = {
  title: [
    'input[data-testid="upload-form-title"]',
    'input[data-testid*="title"]',
    'input[name="title"]',
    'input[aria-label*="title" i]',
    'input[placeholder*="title" i]',
    'input[placeholder*="dress" i]',   // Vinted often uses example-item placeholder
    'input[maxlength="100"]',
  ],
  description: [
    'textarea[data-testid="upload-form-description"]',
    'textarea[data-testid*="description"]',
    'textarea[name="description"]',
    'textarea[aria-label*="description" i]',
    'textarea[placeholder*="describe" i]',
    'textarea[placeholder*="condition" i]',
    'textarea',
  ],
  price: [
    'input[data-testid="upload-form-price"]',
    'input[data-testid*="price"]',
    'input[name="price"]',
    'input[aria-label*="price" i]',
    'input[placeholder*="price" i]',
    'input[placeholder*="£" i]',
    'input[placeholder*="0.50" i]',
  ],
  brand: [
    'input[data-testid="upload-form-brand"]',
    'input[data-testid*="brand"]',
    'input[name="brand"]',
    'input[aria-label*="brand" i]',
    'input[placeholder*="brand" i]',
    'input[placeholder*="nike" i]',
    'input[placeholder*="h&m" i]',
  ],
};

// ── State ─────────────────────────────────────────────────────
let sidebarRoot: HTMLElement | null = null;

// ── Message listener ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FILL_FORM') {
    const item = message.item as QueueItem;
    fillVintedForm(item)
      .then((status) => sendResponse({ success: true, status }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }
});

// ── Form filling ──────────────────────────────────────────────
async function fillVintedForm(item: QueueItem): Promise<Record<string, boolean>> {
  const status: Record<string, boolean> = {};

  // Wait up to 8s for the form to render
  await waitForAny(SELECTORS.title, 8000);

  // Fill each text field
  if (item.title) {
    const el = findFirst(SELECTORS.title) as HTMLInputElement | null;
    status.title = !!el;
    if (el) setReactInputValue(el, item.title);
    else console.warn('[LA] Title field not found — tried:', SELECTORS.title);
  }

  if (item.description) {
    const el = findFirst(SELECTORS.description) as HTMLTextAreaElement | null;
    status.description = !!el;
    if (el) setReactInputValue(el, item.description);
    else console.warn('[LA] Description field not found — tried:', SELECTORS.description);
  }

  if (item.price != null) {
    const el = findFirst(SELECTORS.price) as HTMLInputElement | null;
    status.price = !!el;
    if (el) setReactInputValue(el, String(item.price));
    else console.warn('[LA] Price field not found — tried:', SELECTORS.price);
  }

  if (item.brand) {
    const el = findFirst(SELECTORS.brand) as HTMLInputElement | null;
    status.brand = !!el;
    if (el) setReactInputValue(el, item.brand);
    else console.warn('[LA] Brand field not found — tried:', SELECTORS.brand);
  }

  // Inject (or refresh) the sidebar
  injectSidebar(item, status);

  console.log('[LA] Fill complete. Status:', status);
  return status;
}

// ── Sidebar ───────────────────────────────────────────────────
function injectSidebar(item: QueueItem, status: Record<string, boolean>) {
  // Remove existing sidebar if re-filling
  sidebarRoot?.remove();

  const host = document.createElement('div');
  host.id = 'la-sidebar-host';
  Object.assign(host.style, {
    position: 'fixed', top: '0', right: '0', width: '0', height: '0',
    zIndex: '2147483647', fontFamily: 'inherit',
  });

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = buildSidebarHTML(item, status);

  // Photo download buttons
  shadow.querySelectorAll<HTMLAnchorElement>('[data-download]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const url = btn.dataset.download!;
      const a = document.createElement('a');
      a.href = url;
      a.download = btn.dataset.filename!;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  });

  // Collapse toggle
  const panel = shadow.getElementById('la-panel')!;
  shadow.getElementById('la-toggle')?.addEventListener('click', () => {
    const collapsed = panel.dataset.collapsed === 'true';
    panel.dataset.collapsed = collapsed ? 'false' : 'true';
    panel.style.transform = collapsed ? 'translateX(0)' : 'translateX(calc(100% - 36px))';
  });

  // Mark as listed
  shadow.getElementById('la-mark-listed')?.addEventListener('click', async (e) => {
    const btn = e.target as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'COMPLETE_QUEUE_ITEM',
        queueId: item.queue_id,
      }) as { success: boolean; error?: string };
      if (resp.success) {
        btn.textContent = '✓ Marked as listed';
        btn.style.background = '#16a34a';
      } else {
        btn.textContent = 'Error — try again';
        btn.disabled = false;
      }
    } catch {
      btn.textContent = 'Error — try again';
      btn.disabled = false;
    }
  });

  document.body.appendChild(host);
  sidebarRoot = host;
}

function buildSidebarHTML(item: QueueItem, status: Record<string, boolean>): string {
  const fields = [
    { key: 'title', label: 'Title' },
    { key: 'description', label: 'Description' },
    { key: 'price', label: 'Price' },
    { key: 'brand', label: 'Brand' },
  ];

  const fieldRows = fields
    .filter(f => item[f.key as keyof QueueItem] != null)
    .map(f => {
      const filled = status[f.key];
      const icon = filled ? '✓' : '✗';
      const color = filled ? '#4ade80' : '#f87171';
      return `<div class="field-row">
        <span class="field-label">${f.label}</span>
        <span class="field-status" style="color:${color}">${icon} ${filled ? 'Filled' : 'Not found'}</span>
      </div>`;
    }).join('');

  const photoItems = item.images.map((img, i) => `
    <div class="photo-item">
      <img src="${img.url}" alt="Photo ${i + 1}">
      <div class="photo-num">${i + 1}</div>
      <a class="photo-dl" data-download="${img.url}" data-filename="${item.item_number}-${i + 1}.jpg" href="#">⬇</a>
    </div>`).join('');

  return `
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    #la-panel {
      position: fixed; top: 0; right: 0;
      width: 270px; height: 100vh;
      background: #0f172a; color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px; display: flex; flex-direction: column;
      border-left: 1px solid #1e293b;
      transition: transform 0.2s ease;
      overflow: hidden;
    }
    #la-toggle {
      position: absolute; left: -36px; top: 50%;
      transform: translateY(-50%);
      width: 36px; height: 60px;
      background: #0f172a; border: 1px solid #1e293b;
      border-right: none; border-radius: 8px 0 0 8px;
      color: #94a3b8; cursor: pointer; font-size: 16px;
      display: flex; align-items: center; justify-content: center;
      writing-mode: vertical-rl;
    }
    .header {
      padding: 10px 12px 8px;
      border-bottom: 1px solid #1e293b;
      flex-shrink: 0;
    }
    .header-title { font-size: 11px; color: #0d9488; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .item-num { font-size: 10px; color: #64748b; margin-top: 2px; }
    .item-name { font-size: 13px; font-weight: 600; color: #f1f5f9; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .section { padding: 8px 12px; border-bottom: 1px solid #1e293b; flex-shrink: 0; }
    .section-title { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
    .field-row { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; }
    .field-label { color: #94a3b8; }
    .field-status { font-size: 12px; font-weight: 500; }
    .photos { padding: 8px 12px; flex: 1; overflow-y: auto; }
    .photos-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .photo-item { position: relative; border-radius: 6px; overflow: hidden; aspect-ratio: 1; background: #1e293b; }
    .photo-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .photo-num { position: absolute; top: 4px; left: 4px; background: rgba(0,0,0,0.65); color: #fff; font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 4px; }
    .photo-dl { position: absolute; bottom: 4px; right: 4px; background: rgba(13,148,136,0.9); color: #fff; font-size: 11px; padding: 2px 6px; border-radius: 4px; text-decoration: none; }
    .photo-dl:hover { background: #0d9488; }
    .no-photos { color: #64748b; font-size: 12px; padding: 8px 0; }
    .footer { padding: 10px 12px; flex-shrink: 0; border-top: 1px solid #1e293b; }
    .note { font-size: 11px; color: #64748b; margin-bottom: 8px; line-height: 1.4; }
    .btn-listed { width: 100%; padding: 9px; background: #0d9488; color: #fff; border: none; border-radius: 7px; font-size: 13px; font-weight: 600; cursor: pointer; }
    .btn-listed:hover { background: #0f766e; }
    .btn-listed:disabled { opacity: 0.55; cursor: not-allowed; }
  </style>
  <div id="la-panel">
    <button id="la-toggle">⬅</button>
    <div class="header">
      <div class="header-title">Listings Assistant</div>
      <div class="item-num">${item.item_number}</div>
      <div class="item-name">${item.title ?? 'Untitled item'}</div>
    </div>
    <div class="section">
      <div class="section-title">Fields</div>
      ${fieldRows}
    </div>
    <div class="photos">
      <div class="section-title" style="margin-bottom:8px">Photos — download &amp; upload to Vinted</div>
      ${item.images.length > 0
        ? `<div class="photos-grid">${photoItems}</div>`
        : '<div class="no-photos">No photos stored</div>'}
    </div>
    <div class="footer">
      <div class="note">After uploading photos and reviewing all fields, click to close the loop.</div>
      <button class="btn-listed" id="la-mark-listed">Mark as listed</button>
    </div>
  </div>`;
}

// ── Helpers ───────────────────────────────────────────────────
function findFirst(selectors: string[]): Element | null {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

async function waitForAny(selectors: string[], timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (findFirst(selectors)) return;
    await sleep(200);
  }
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

// Sets a value on a React-controlled input/textarea without bypassing React state.
function setReactInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
