import { supabase } from './supabase';

const API_BASE = import.meta.env.VITE_API_URL || '';

async function authedHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EbayStatus {
  connected: boolean;
  marketplace?: string;
  tokenExpiresAt?: string;
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
  merchantLocationKey?: string;
  sellerCountry?: string;
}

export interface EbayPolicy {
  policyId: string;
  name: string;
  marketplaceId: string;
}

export interface EbayPolicies {
  fulfillment: EbayPolicy[];
  payment: EbayPolicy[];
  returns: EbayPolicy[];
  locations: { merchantLocationKey: string; name: string }[];
}

export interface EbayListingResult {
  listingId: string;
  offerId: string;
  listingUrl: string;
}

// ── eBay category list (GB/US leaf categories) ────────────────────────────────
// IDs are eBay GB; used directly as categoryId in the offer.
export const EBAY_GB_CATEGORIES = [
  { label: "Women's Clothing",       id: '15724' },
  { label: "Men's Clothing",         id: '1059'  },
  { label: "Women's Shoes",          id: '3034'  },
  { label: "Men's Shoes",            id: '3035'  },
  { label: "Kids' Clothing",         id: '3087'  },
  { label: "Kids' Shoes",            id: '57988' },
  { label: "Women's Bags",           id: '169291'},
  { label: "Men's Bags",             id: '169285'},
  { label: "Women's Accessories",    id: '4251'  },
  { label: "Men's Accessories",      id: '15273' },
  { label: "Jewellery",              id: '281'   },
  { label: "Watches",                id: '31387' },
  { label: "Sporting Goods",         id: '888'   },
  { label: "Home & Garden",          id: '11700' },
  { label: "Kitchen & Dining",       id: '20625' },
  { label: "Books",                  id: '267'   },
  { label: "DVDs & Films",           id: '617'   },
  { label: "CDs & Vinyl",            id: '11233' },
  { label: "Video Games",            id: '139973'},
  { label: "Mobile Phones",          id: '9355'  },
  { label: "Computers & Tablets",    id: '58058' },
  { label: "Cameras",                id: '625'   },
  { label: "Toys & Games",           id: '220'   },
  { label: "Collectibles",           id: '1'     },
  { label: "Health & Beauty",        id: '26395' },
  { label: "Other",                  id: '99'    },
] as const;

// ── API calls ─────────────────────────────────────────────────────────────────

export async function getEbayStatus(): Promise<EbayStatus> {
  const res = await fetch(`${API_BASE}/api/ebay/status`, {
    headers: await authedHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch eBay status');
  return res.json();
}

export async function startEbayConnect(marketplace: 'EBAY_GB' | 'EBAY_US'): Promise<void> {
  const res = await fetch(`${API_BASE}/api/ebay/connect?marketplace=${marketplace}`, {
    headers: await authedHeaders(),
  });
  if (!res.ok) throw new Error('Failed to initiate eBay connection');
  const { authUrl } = await res.json();
  window.location.href = authUrl;
}

export async function disconnectEbay(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/ebay/disconnect`, {
    method: 'DELETE',
    headers: await authedHeaders(),
  });
  if (!res.ok) throw new Error('Failed to disconnect eBay');
}

export async function getEbayPolicies(): Promise<EbayPolicies> {
  const res = await fetch(`${API_BASE}/api/ebay/policies`, {
    headers: await authedHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch eBay policies');
  return res.json();
}

export async function saveEbaySettings(settings: {
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
  merchantLocationKey?: string;
  marketplace?: string;
  sellerCountry?: string;
}): Promise<void> {
  const res = await fetch(`${API_BASE}/api/ebay/save-settings`, {
    method: 'POST',
    headers: await authedHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error('Failed to save eBay settings');
}

export async function createEbayListing(params: {
  itemId: string;
  listingType: 'FIXED_PRICE' | 'AUCTION';
  startPrice: number;
  buyItNowPrice?: number;
  auctionDurationDays?: number;
  ebayCategoryId?: string;
}): Promise<EbayListingResult> {
  const res = await fetch(`${API_BASE}/api/ebay/list`, {
    method: 'POST',
    headers: await authedHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create eBay listing');
  }
  return res.json();
}

export async function delistEbayItem(listingId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/ebay/list/${encodeURIComponent(listingId)}`, {
    method: 'DELETE',
    headers: await authedHeaders(),
  });
  if (!res.ok) throw new Error('Failed to delist eBay item');
}

export async function createDefaultEbayPolicies(): Promise<{ results: Record<string, string>; errors: string[] }> {
  const res = await fetch(`${API_BASE}/api/ebay/create-default-policies`, {
    method: 'POST',
    headers: await authedHeaders(),
  });
  if (!res.ok) throw new Error('Failed to create default policies');
  return res.json();
}

export async function resetEbayItem(itemId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/ebay/reset/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
    headers: await authedHeaders(),
  });
  if (!res.ok) throw new Error('Failed to reset eBay data');
}
