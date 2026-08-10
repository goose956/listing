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

export interface EbayCategoryAspect {
  name: string;
  required: boolean;
  mode: 'FREE_TEXT' | 'SELECTION_ONLY';
  maxValues: number;
  values: string[];
}

export class EbayListingError extends Error {
  missingAspects: string[];
  requiredAspects: EbayCategoryAspect[];

  constructor(message: string, data?: { missingAspects?: string[]; requiredAspects?: EbayCategoryAspect[] }) {
    super(message);
    this.name = 'EbayListingError';
    this.missingAspects = data?.missingAspects ?? [];
    this.requiredAspects = data?.requiredAspects ?? [];
  }
}

// ── eBay category list (GB leaf categories from Taxonomy API) ─────────────────
// IDs verified via GET /commerce/taxonomy/v1/category_tree/{id}/get_category_subtree
export const EBAY_GB_CATEGORIES = [
  // Women's Clothing
  { label: "Women's Tops & Shirts",               id: '53159' },
  { label: "Women's Dresses",                     id: '63861' },
  { label: "Women's Jeans",                       id: '11554' },
  { label: "Women's Trousers",                    id: '63863' },
  { label: "Women's Leggings",                    id: '169001'},
  { label: "Women's Skirts",                      id: '63864' },
  { label: "Women's Coats, Jackets & Waistcoats", id: '63862' },
  { label: "Women's Jumpers & Cardigans",         id: '63866' },
  { label: "Women's Hoodies & Sweatshirts",       id: '155226'},
  { label: "Women's Shorts",                      id: '11555' },
  { label: "Women's Suits & Tailoring",           id: '63865' },
  { label: "Women's Swimwear",                    id: '63867' },
  { label: "Women's Jumpsuits & Playsuits",       id: '3009'  },
  { label: "Women's Activewear Tops",             id: '185082'},
  { label: "Women's Activewear Trousers",         id: '260954'},
  { label: "Women's Tracksuits & Sets",           id: '185084'},
  { label: "Women's Outfits & Sets",              id: '260011'},
  // Women's Shoes
  { label: "Women's Boots",                       id: '53557' },
  { label: "Women's Heels",                       id: '55793' },
  { label: "Women's Trainers",                    id: '95672' },
  { label: "Women's Flats",                       id: '45333' },
  { label: "Women's Sandals",                     id: '62107' },
  // Women's Bags & Accessories
  { label: "Women's Bags & Handbags",             id: '169291'},
  { label: "Scarves & Shawls",                    id: '45238' },
  { label: "Sunglasses",                          id: '45246' },
  { label: "Hats",                                id: '45230' },
  { label: "Belts",                               id: '3003'  },
  // Fragrance & Beauty
  { label: "Women's Fragrances",                  id: '11848' },
  { label: "Men's Fragrances & Aftershaves",      id: '29585' },
  { label: "Unisex Fragrances",                   id: '112661'},
  { label: "Home Fragrance",                      id: '20552' },
  { label: "Essential Oils & Fragrances",         id: '41268' },
  // Men's Clothing
  { label: "Men's T-Shirts",                      id: '15687' },
  { label: "Men's Casual Shirts",                 id: '57990' },
  { label: "Men's Formal Shirts",                 id: '57991' },
  { label: "Men's Jeans",                         id: '11483' },
  { label: "Men's Trousers",                      id: '57989' },
  { label: "Men's Coats, Jackets & Waistcoats",   id: '57988' },
  { label: "Men's Jumpers & Cardigans",           id: '11484' },
  { label: "Men's Hoodies & Sweatshirts",         id: '155183'},
  { label: "Men's Shorts",                        id: '15689' },
  { label: "Men's Suits & Tailoring",             id: '3001'  },
  { label: "Men's Tracksuits & Sets",             id: '185708'},
  // Jewellery & Watches
  { label: "Necklaces & Pendants",                id: '261993'},
  { label: "Earrings",                            id: '261990'},
  { label: "Rings",                               id: '261994'},
  { label: "Bracelets & Charms",                  id: '261988'},
  { label: "Wristwatches",                        id: '31387' },
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

export async function getEbayCategoryAspects(categoryId: string): Promise<EbayCategoryAspect[]> {
  const res = await fetch(`${API_BASE}/api/ebay/aspects/${encodeURIComponent(categoryId)}`, {
    headers: await authedHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch eBay category specifics');
  const data = await res.json() as { requiredAspects?: EbayCategoryAspect[] };
  return data.requiredAspects ?? [];
}

export async function createEbayListing(params: {
  itemId: string;
  listingType: 'FIXED_PRICE' | 'AUCTION';
  startPrice: number;
  buyItNowPrice?: number;
  auctionDurationDays?: number;
  ebayCategoryId?: string;
  ebayAspects?: Record<string, string>;
}): Promise<EbayListingResult> {
  const res = await fetch(`${API_BASE}/api/ebay/list`, {
    method: 'POST',
    headers: await authedHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (err?.missingAspects || err?.requiredAspects) {
      const missing = Array.isArray(err.missingAspects) ? err.missingAspects : [];
      const suffix = missing.length > 0 ? `: ${missing.join(', ')}` : '';
      throw new EbayListingError(`${err.error || 'Missing required eBay item specifics'}${suffix}`, err);
    }
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
