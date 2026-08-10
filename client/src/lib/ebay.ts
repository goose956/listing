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
