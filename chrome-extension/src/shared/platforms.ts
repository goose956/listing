// Add new marketplaces here — everything else adapts automatically.
export interface Platform {
  id: string;
  label: string;
  color: string;        // accent colour for tab + buttons
  sellPageUrl: string;  // default URL to open the sell page
  urlPattern: RegExp;   // matches any sell/upload page for this platform
}

export const PLATFORMS: Platform[] = [
  {
    id: 'vinted',
    label: 'Vinted',
    color: '#0d9488',
    sellPageUrl: 'https://www.vinted.co.uk/items/new',
    urlPattern: /vinted\.[^/]+\/items\/new/,
  },
  {
    id: 'depop',
    label: 'Depop',
    color: '#f43f5e',
    sellPageUrl: 'https://www.depop.com/products/create/',
    urlPattern: /depop\.com\/(products\/create|products\/edit|sell)/,
  },
  {
    id: 'ebay',
    label: 'eBay',
    color: '#3b82f6',
    sellPageUrl: 'https://www.ebay.co.uk/sell',
    urlPattern: /ebay\.[^/]+\/(sell\/format|lst\/sell|sell\b)/,
  },
];

export function detectPlatform(url: string): Platform | null {
  return PLATFORMS.find(p => p.urlPattern.test(url)) ?? null;
}
