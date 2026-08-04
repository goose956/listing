import type { QueueItem } from '../shared/types';

// ── Message listener ──────────────────────────────────────────
// Receives FILL_FORM messages from the popup and fills Vinted's listing form.
// Phase 4: inspect Vinted's /items/new page and implement fillVintedForm().
// All selectors should be defined in the SELECTORS object below for easy updates.

const SELECTORS = {
  // TODO (Phase 4): populate by inspecting Vinted's sell form
  // Use data-testid, name, placeholder, or aria-label attributes where possible
  title: '',
  description: '',
  price: '',
  brand: '',
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FILL_FORM') {
    const item = message.item as QueueItem;
    fillVintedForm(item)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true; // async response
  }
});

async function fillVintedForm(item: QueueItem): Promise<void> {
  // Phase 4: implement form filling using setReactInputValue below
  // For now just log so we can verify the message arrives
  console.log('[Listings Assistant] FILL_FORM received:', item);
}

// Sets a value on a React-controlled input or textarea.
// Standard .value = ... won't trigger React's synthetic event system.
function setReactInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// Exported for Phase 4 use
export { setReactInputValue };
