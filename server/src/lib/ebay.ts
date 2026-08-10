import { getSupabaseAdmin } from './supabaseAdmin.js';

// ── Environment ──────────────────────────────────────────────────────────────

const isSandbox = process.env.EBAY_SANDBOX !== 'false'; // default sandbox until prod

export const EBAY_CONFIG = {
  clientId: process.env.EBAY_CLIENT_ID || '',
  clientSecret: process.env.EBAY_CLIENT_SECRET || '',
  devId: process.env.EBAY_DEV_ID || '',
  redirectUri: process.env.EBAY_REDIRECT_URI || '', // RuName registered in eBay developer portal
  isSandbox,
  authBaseUrl: isSandbox
    ? 'https://auth.sandbox.ebay.com'
    : 'https://auth.ebay.com',
  apiBaseUrl: isSandbox
    ? 'https://api.sandbox.ebay.com'
    : 'https://api.ebay.com',
};

// ── OAuth scopes ─────────────────────────────────────────────────────────────

export const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
].join(' ');

// ── Category / condition maps ─────────────────────────────────────────────────

// eBay condition IDs — used by both UK and US
export const CONDITION_MAP: Record<string, number> = {
  new_with_tags: 1000,    // New with tags
  new_without_tags: 1500, // New without tags
  very_good: 3000,        // Used — Very Good
  good: 4000,             // Used — Good
  satisfactory: 5000,     // Used — Acceptable
  fair: 5000,             // Used — Acceptable (fallback)
};

// eBay category IDs for clothing/fashion by marketplace
// Format: { [appCategory]: { EBAY_GB: id, EBAY_US: id } }
export const CATEGORY_MAP: Record<string, { EBAY_GB: string; EBAY_US: string }> = {
  "Women's Clothing": { EBAY_GB: '15724', EBAY_US: '15724' },
  "Men's Clothing":   { EBAY_GB: '1059',  EBAY_US: '1059'  },
  "Women's Shoes":    { EBAY_GB: '3034',  EBAY_US: '63889' },
  "Men's Shoes":      { EBAY_GB: '3035',  EBAY_US: '93427' },
  "Women's Bags":     { EBAY_GB: '169291','EBAY_US': '169291' },
  "Accessories":      { EBAY_GB: '4251',  EBAY_US: '4251'  },
  "Clothing":         { EBAY_GB: '11450', EBAY_US: '11450' }, // catch-all
};

// Default category if no match
const DEFAULT_CATEGORY = { EBAY_GB: '11450', EBAY_US: '11450' };

export function getCategoryId(category: string | undefined, marketplace: string): string {
  if (!category) return DEFAULT_CATEGORY[marketplace as keyof typeof DEFAULT_CATEGORY] ?? '11450';
  const entry = CATEGORY_MAP[category] ?? DEFAULT_CATEGORY;
  return entry[marketplace as keyof typeof DEFAULT_CATEGORY] ?? '11450';
}

// ── OAuth URL builder ─────────────────────────────────────────────────────────

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: EBAY_CONFIG.clientId,
    response_type: 'code',
    redirect_uri: EBAY_CONFIG.redirectUri,
    scope: EBAY_SCOPES,
    state,
  });
  return `${EBAY_CONFIG.authBaseUrl}/oauth2/authorize?${params.toString()}`;
}

// ── Token exchange ────────────────────────────────────────────────────────────

export interface EbayTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
}

export async function exchangeCodeForTokens(code: string): Promise<EbayTokens> {
  const credentials = Buffer.from(
    `${EBAY_CONFIG.clientId}:${EBAY_CONFIG.clientSecret}`
  ).toString('base64');

  const res = await fetch(`${EBAY_CONFIG.apiBaseUrl}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: EBAY_CONFIG.redirectUri,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay token exchange failed (${res.status}): ${text}`);
  }

  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
  return data;
}

// ── Token refresh ─────────────────────────────────────────────────────────────

export async function refreshAccessToken(refreshToken: string): Promise<EbayTokens> {
  const credentials = Buffer.from(
    `${EBAY_CONFIG.clientId}:${EBAY_CONFIG.clientSecret}`
  ).toString('base64');

  const res = await fetch(`${EBAY_CONFIG.apiBaseUrl}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: EBAY_SCOPES,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshToken,
    expires_in: data.expires_in,
  };
}

// ── Load & auto-refresh user token ───────────────────────────────────────────

export async function getValidAccessToken(userId: string): Promise<string> {
  const { data: conn, error } = await getSupabaseAdmin()
    .from('user_ebay_connections')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error || !conn) throw new Error('eBay account not connected');

  const expiresAt = new Date(conn.access_token_expires_at).getTime();
  const nowPlusBuffer = Date.now() + 5 * 60 * 1000; // refresh 5 min before expiry

  if (expiresAt > nowPlusBuffer) {
    return conn.access_token;
  }

  // Refresh the token
  const tokens = await refreshAccessToken(conn.refresh_token);
  const newExpiry = new Date(Date.now() + tokens.expires_in * 1000);

  await getSupabaseAdmin()
    .from('user_ebay_connections')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      access_token_expires_at: newExpiry.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  return tokens.access_token;
}

// ── eBay API client ───────────────────────────────────────────────────────────

export interface EbayApiClient {
  get(path: string, params?: Record<string, string>): Promise<any>;
  post(path: string, body: unknown): Promise<any>;
  put(path: string, body: unknown): Promise<any>;
  delete(path: string): Promise<any>;
}

export function ebayApi(accessToken: string, marketplace = 'EBAY_GB'): EbayApiClient {
  const baseUrl = EBAY_CONFIG.apiBaseUrl;
  const lang = marketplace === 'EBAY_GB' ? 'en-GB' : 'en-US';
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Accept-Language': lang,
    'Content-Language': lang,
  };

  async function request(method: string, path: string, body?: unknown, params?: Record<string, string>): Promise<any> {
    let url = `${baseUrl}${path}`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`eBay API ${method} ${path} failed (${res.status}): ${text}`) as any;
      err.response = { status: res.status, data: text };
      throw err;
    }
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  return {
    get: (path, params) => request('GET', path, undefined, params),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    delete: (path) => request('DELETE', path),
  };
}

// ── App-level OAuth token (client_credentials) ────────────────────────────────
// Used for metadata APIs that don't require user context

let _appTokenCache: { token: string; expiresAt: number } | null = null;

async function getAppToken(): Promise<string> {
  if (_appTokenCache && _appTokenCache.expiresAt > Date.now() + 60_000) {
    return _appTokenCache.token;
  }
  const creds = Buffer.from(`${EBAY_CONFIG.clientId}:${EBAY_CONFIG.clientSecret}`).toString('base64');
  const res = await fetch(`${EBAY_CONFIG.apiBaseUrl}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
  });
  if (!res.ok) throw new Error(`App token fetch failed: ${await res.text()}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  _appTokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

// ── Valid conditions for a category (from eBay Metadata API) ─────────────────
// Cached in-process; condition policies rarely change.

const _conditionPolicyCache = new Map<string, number[]>();

export async function getValidConditionIds(marketplace: string, categoryId: string): Promise<number[]> {
  const cacheKey = `${marketplace}:${categoryId}`;
  if (_conditionPolicyCache.has(cacheKey)) return _conditionPolicyCache.get(cacheKey)!;

  try {
    const appToken = await getAppToken();
    const url = `${EBAY_CONFIG.apiBaseUrl}/sell/metadata/v1/marketplace/${marketplace}/get_item_condition_policies?category_ids=${categoryId}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${appToken}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      console.warn(`[eBay] getItemConditionPolicies ${res.status} for ${marketplace}/${categoryId}`);
      return [];
    }
    const data = await res.json() as { itemConditionPolicies?: Array<{ itemConditions?: Array<{ conditionId: string }> }> };
    const ids = (data.itemConditionPolicies?.[0]?.itemConditions ?? [])
      .map((c) => parseInt(c.conditionId, 10))
      .filter((n) => !isNaN(n));
    console.log(`[eBay] valid condition IDs for ${marketplace}/${categoryId}:`, ids);
    _conditionPolicyCache.set(cacheKey, ids);
    return ids;
  } catch (e) {
    console.warn('[eBay] getItemConditionPolicies failed:', e);
    return [];
  }
}

// Maps condition ID → Inventory API ConditionEnum string
// Note: 1500 (New without tags) intentionally omitted — LIKE_NEW resolves to condition 2750
// which is rejected by clothing categories. Use NEW (1000) instead.
export const CONDITION_ID_TO_ENUM: Record<number, string> = {
  1000: 'NEW',
  2000: 'NEW_OTHER',
  2500: 'NEW_WITH_DEFECTS',
  3000: 'USED_EXCELLENT',
  4000: 'USED_VERY_GOOD',
  5000: 'USED_GOOD',
  6000: 'USED_ACCEPTABLE',
  7000: 'FOR_PARTS_OR_NOT_WORKING',
};

// ── Save connection to DB ─────────────────────────────────────────────────────

export async function saveEbayConnection(
  userId: string,
  tokens: EbayTokens,
  marketplace: string
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await getSupabaseAdmin().from('user_ebay_connections').upsert(
    {
      user_id: userId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      access_token_expires_at: expiresAt.toISOString(),
      ebay_marketplace: marketplace,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );
}

// ── Fetch user's eBay policies ────────────────────────────────────────────────

export interface EbayPolicy {
  policyId: string;
  name: string;
  marketplaceId: string;
}

export async function getFulfillmentPolicies(
  accessToken: string,
  marketplace: string
): Promise<EbayPolicy[]> {
  try {
    const api = ebayApi(accessToken, marketplace);
    const data = await api.get('/sell/account/v1/fulfillment_policy', { marketplace_id: marketplace });
    return (data.fulfillmentPolicies ?? []).map((p: any) => ({
      policyId: p.fulfillmentPolicyId,
      name: p.name,
      marketplaceId: p.marketplaceId,
    }));
  } catch {
    return [];
  }
}

export async function getPaymentPolicies(
  accessToken: string,
  marketplace: string
): Promise<EbayPolicy[]> {
  try {
    const api = ebayApi(accessToken, marketplace);
    const data = await api.get('/sell/account/v1/payment_policy', { marketplace_id: marketplace });
    return (data.paymentPolicies ?? []).map((p: any) => ({
      policyId: p.paymentPolicyId,
      name: p.name,
      marketplaceId: p.marketplaceId,
    }));
  } catch {
    return [];
  }
}

export async function getReturnPolicies(
  accessToken: string,
  marketplace: string
): Promise<EbayPolicy[]> {
  try {
    const api = ebayApi(accessToken, marketplace);
    const data = await api.get('/sell/account/v1/return_policy', { marketplace_id: marketplace });
    return (data.returnPolicies ?? []).map((p: any) => ({
      policyId: p.returnPolicyId,
      name: p.name,
      marketplaceId: p.marketplaceId,
    }));
  } catch {
    return [];
  }
}

// ── Merchant location ─────────────────────────────────────────────────────────

export async function getMerchantLocations(accessToken: string): Promise<
  { merchantLocationKey: string; name: string }[]
> {
  try {
    const api = ebayApi(accessToken, 'EBAY_GB');
    const data = await api.get('/sell/inventory/v1/location');
    return (data.locations ?? []).map((l: any) => ({
      merchantLocationKey: l.merchantLocationKey,
      name: l.name ?? l.merchantLocationKey,
    }));
  } catch {
    return [];
  }
}
