import type { QueueItem } from '../shared/types';

// ── Selectors ─────────────────────────────────────────────────
// Multiple fallbacks per field — Depop's form structure can change.
// If a field is not being filled, open DevTools on /products/create,
// inspect the input, and add its selector here.
const SELECTORS = {
  title: [
    'input[data-testid="product-description-title"]',
    'input[name="itemDescription"]',
    'input[name="title"]',
    'input[placeholder*="name your item" i]',
    'input[placeholder*="what are you selling" i]',
    'input[aria-label*="item name" i]',
    'input[aria-label*="title" i]',
  ],
  description: [
    'textarea[data-testid="product-description-description"]',
    'textarea[name="description"]',
    'textarea[placeholder*="describe your item" i]',
    'textarea[placeholder*="tell buyers" i]',
    'textarea[aria-label*="description" i]',
    'textarea',
  ],
  price: [
    'input[data-testid="product-price-input"]',
    'input[name="price"]',
    'input[placeholder*="set a price" i]',
    'input[placeholder*="price" i]',
    'input[type="number"][aria-label*="price" i]',
    'input[aria-label*="price" i]',
  ],
  brand: [
    'input[data-testid="product-brand-input"]',
    'input[name="brand"]',
    'input[placeholder*="enter a brand" i]',
    'input[placeholder*="brand" i]',
    'input[aria-label*="brand" i]',
  ],
};

// ── State ─────────────────────────────────────────────────────
let sidebarRoot: HTMLElement | null = null;

const ACCENT = '#f43f5e'; // Depop brand pink

// ── Message listener ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FILL_FORM') {
    const item = message.item as QueueItem;
    fillDepopForm(item)
      .then((status) => sendResponse({ success: true, status }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }
});

// ── Form filling ──────────────────────────────────────────────
async function fillDepopForm(item: QueueItem): Promise<Record<string, boolean>> {
  const status: Record<string, boolean> = {};

  // Wait up to 8s for the form to appear
  await waitForAny(SELECTORS.title, 8000);

  if (item.title) {
    const el = findFirst(SELECTORS.title) as HTMLInputElement | null;
    status.title = !!el;
    if (el) setNativeValue(el, item.title);
    else console.warn('[LA] Depop: Title field not found — tried:', SELECTORS.title);
  }

  if (item.description) {
    const el = findFirst(SELECTORS.description) as HTMLTextAreaElement | null;
    status.description = !!el;
    if (el) setNativeValue(el, item.description);
    else console.warn('[LA] Depop: Description field not found — tried:', SELECTORS.description);
  }

  const priceToUse = item.platform_prices?.depop ?? item.price;
  if (priceToUse != null) {
    const el = findFirst(SELECTORS.price) as HTMLInputElement | null;
    status.price = !!el;
    if (el) setNativeValue(el, String(priceToUse));
    else console.warn('[LA] Depop: Price field not found — tried:', SELECTORS.price);
  }

  // Brand may appear after category selection
  if (item.brand) {
    const el = findFirst(SELECTORS.brand) as HTMLInputElement | null;
    status.brand = !!el;
    if (el) setNativeValue(el, item.brand);
  }

  injectSidebar(item, status);

  console.log('[LA] Depop fill complete. Status:', status);
  return status;
}

// ── Sidebar ───────────────────────────────────────────────────
function injectSidebar(item: QueueItem, status: Record<string, boolean>) {
  sidebarRoot?.remove();

  const host = document.createElement('div');
  host.id = 'la-sidebar-host-depop';
  Object.assign(host.style, {
    position: 'fixed', top: '0', right: '0', width: '0', height: '0',
    zIndex: '2147483647', fontFamily: 'inherit',
  });

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = buildSidebarHTML(item, status);

  // Download all photos
  shadow.getElementById('la-download-all')?.addEventListener('click', async () => {
    const btn = shadow.getElementById('la-download-all') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Downloading…';
    for (let i = 0; i < item.images.length; i++) {
      const img = item.images[i];
      const a = document.createElement('a');
      a.href = img.url;
      a.download = `${item.item_number}-${i + 1}.jpg`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (i < item.images.length - 1) await sleep(400);
    }
    btn.textContent = `✓ ${item.images.length} downloaded`;
    btn.style.background = '#16a34a';
    setTimeout(() => {
      btn.textContent = 'Download all photos';
      btn.style.background = '';
      btn.disabled = false;
    }, 3000);
  });

  // Individual photo downloads
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

  // Re-try brand field (appears after category is selected on Depop)
  shadow.getElementById('la-fill-remaining')?.addEventListener('click', () => {
    const fields = [
      { key: 'brand' as const, label: 'Brand', value: item.brand ?? undefined },
    ];
    let filled = 0;
    for (const field of fields) {
      if (!field.value) continue;
      const el = findFirst(SELECTORS[field.key]) as HTMLInputElement | null;
      const row = shadow.getElementById(`la-deferred-${field.key}`);
      if (el) {
        setNativeValue(el, field.value);
        filled++;
        if (row) row.innerHTML = `<span class="field-label">${field.label}</span><span class="field-status" style="color:#4ade80">✓ Filled</span>`;
      } else {
        if (row) row.innerHTML = `<span class="field-label">${field.label}</span><span class="field-status" style="color:#94a3b8">— not visible yet</span>`;
      }
    }
    const btn = shadow.getElementById('la-fill-remaining') as HTMLButtonElement;
    btn.textContent = filled > 0 ? `↻ Filled ${filled} — click again for more` : '↻ No new fields found yet';
    setTimeout(() => { btn.textContent = 'Fill remaining fields'; }, 2500);
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
  const immediateFields = [
    { key: 'title',       label: 'Title' },
    { key: 'description', label: 'Description' },
    { key: 'price',       label: 'Price' },
    { key: 'brand',       label: 'Brand' },
  ];

  const fieldRows = immediateFields
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

  // If brand wasn't filled immediately, offer a retry button
  const brandPending = item.brand && !status.brand;
  const deferredSection = brandPending ? `
    <div class="deferred-note">Select a Category first, then:</div>
    <button class="btn-fill-remaining" id="la-fill-remaining">Fill remaining fields</button>
    <div class="field-row" id="la-deferred-brand">
      <span class="field-label">Brand</span>
      <span class="field-status" style="color:#475569">— pending</span>
    </div>` : '';

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
    .header-title { font-size: 11px; color: ${ACCENT}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .item-num { font-size: 10px; color: #64748b; margin-top: 2px; }
    .scroll-body { flex: 1; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
    .section { display: flex; flex-direction: column; gap: 6px; }
    .section-title { font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; }
    .field-row { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; }
    .field-label { color: #94a3b8; }
    .field-status { font-size: 12px; font-weight: 500; }
    .deferred-note { font-size: 11px; color: #64748b; padding: 2px 0; }
    .btn-fill-remaining {
      width: 100%; padding: 6px 10px;
      background: #1e293b; color: #f1f5f9;
      border: 1px solid #334155; border-radius: 6px;
      font-size: 12px; cursor: pointer;
    }
    .btn-fill-remaining:hover { background: #334155; }
    .photos-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
    .photo-item { position: relative; aspect-ratio: 1; border-radius: 6px; overflow: hidden; background: #1e293b; }
    .photo-item img { width: 100%; height: 100%; object-fit: cover; }
    .photo-num { position: absolute; top: 3px; left: 4px; font-size: 10px; color: #fff; font-weight: 700; text-shadow: 0 1px 2px rgba(0,0,0,.8); }
    .photo-dl { position: absolute; bottom: 3px; right: 3px; color: #fff; font-size: 13px; text-decoration: none; text-shadow: 0 1px 2px rgba(0,0,0,.8); }
    .btn-download-all {
      width: 100%; padding: 7px 10px;
      background: #1e293b; color: #f1f5f9;
      border: 1px solid #334155; border-radius: 6px;
      font-size: 12px; cursor: pointer;
    }
    .btn-download-all:hover { background: #334155; }
    .btn-download-all:disabled { opacity: 0.45; cursor: not-allowed; }
    .btn-mark-listed {
      width: 100%; padding: 8px 10px;
      background: ${ACCENT}; color: #fff;
      border: none; border-radius: 6px;
      font-size: 13px; font-weight: 600; cursor: pointer;
    }
    .btn-mark-listed:hover { opacity: 0.9; }
    .btn-mark-listed:disabled { opacity: 0.45; cursor: not-allowed; }
  </style>
  <div id="la-panel">
    <button id="la-toggle">☰</button>
    <div class="header">
      <div class="header-title">Listings Assistant · Depop</div>
      <div class="item-num">#${item.item_number} · ${item.title ?? ''}</div>
    </div>
    <div class="scroll-body">
      <div class="section">
        <div class="section-title">Form fields</div>
        ${fieldRows}
        ${deferredSection}
      </div>
      ${item.images.length > 0 ? `
      <div class="section">
        <div class="section-title">Photos (${item.images.length})</div>
        <button class="btn-download-all" id="la-download-all">Download all photos</button>
        <div class="photos-grid">${photoItems}</div>
      </div>` : ''}
      <div class="section">
        <button class="btn-mark-listed" id="la-mark-listed">✓ Mark as listed on Depop</button>
      </div>
    </div>
  </div>`;
}

// ── Utilities ─────────────────────────────────────────────────
function findFirst(selectors: string[]): Element | null {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) return el;
    } catch { /* invalid selector */ }
  }
  return null;
}

function waitForAny(selectors: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (findFirst(selectors)) { resolve(); return; }
      if (Date.now() > deadline) { resolve(); return; }
      setTimeout(check, 200);
    };
    check();
  });
}

/**
 * Set a value on an input/textarea in a way that React's synthetic event
 * system detects as a real user change, triggering state updates.
 */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const nativeInputSetter = Object.getOwnPropertyDescriptor(
    el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value'
  )?.set;
  if (nativeInputSetter) {
    nativeInputSetter.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
