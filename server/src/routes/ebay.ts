import { Router, Request, Response } from 'express';
import { getSupabaseAdmin, isSupabaseAdminConfigured } from '../lib/supabaseAdmin.js';
import {
  buildAuthUrl,
  exchangeCodeForTokens,
  getValidAccessToken,
  saveEbayConnection,
  getCategoryId,
  CONDITION_MAP,
  getFulfillmentPolicies,
  getPaymentPolicies,
  getReturnPolicies,
  getMerchantLocations,
  ebayApi,
  EBAY_CONFIG,
} from '../lib/ebay.js';
import crypto from 'crypto';

export const ebayRouter = Router();

// ── Auth helper ───────────────────────────────────────────────────────────────

async function resolveUserId(authHeader?: string): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length);
  if (!token || !isSupabaseAdminConfigured()) return null;
  try {
    const { data: { user }, error } = await getSupabaseAdmin().auth.getUser(token);
    if (error || !user) return null;
    return user.id;
  } catch {
    return null;
  }
}

// In-memory state store for OAuth CSRF (keyed by state → userId)
// For multi-instance deployments, move this to Redis/DB
const pendingStates = new Map<string, { userId: string; marketplace: string; expiresAt: number }>();

// Clean up expired states every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingStates.entries()) {
    if (val.expiresAt < now) pendingStates.delete(key);
  }
}, 10 * 60 * 1000);

// ── GET /api/ebay/connect ─────────────────────────────────────────────────────
// Starts the eBay OAuth flow. Returns redirect URL.
ebayRouter.get('/connect', async (req: Request, res: Response) => {
  const userId = await resolveUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  if (!EBAY_CONFIG.clientId || !EBAY_CONFIG.redirectUri) {
    return res.status(503).json({ error: 'eBay integration not configured on server' });
  }

  const marketplace = (req.query.marketplace as string) || 'EBAY_GB';
  const state = crypto.randomBytes(16).toString('hex');

  // Store state with 15-minute expiry
  pendingStates.set(state, { userId, marketplace, expiresAt: Date.now() + 15 * 60 * 1000 });

  const authUrl = buildAuthUrl(state);
  res.json({ authUrl });
});

// ── GET /api/ebay/callback ────────────────────────────────────────────────────
// eBay redirects here after user authorises. Stores tokens in DB.
ebayRouter.get('/callback', async (req: Request, res: Response) => {
  const { code, state, error: ebayError } = req.query as Record<string, string>;

  const appUrl = process.env.APP_URL || 'http://localhost:5173';

  if (ebayError) {
    return res.redirect(`${appUrl}/settings?ebay=error&reason=${encodeURIComponent(ebayError)}`);
  }

  if (!code || !state) {
    return res.redirect(`${appUrl}/settings?ebay=error&reason=missing_params`);
  }

  const pending = pendingStates.get(state);
  if (!pending || pending.expiresAt < Date.now()) {
    return res.redirect(`${appUrl}/settings?ebay=error&reason=invalid_state`);
  }
  pendingStates.delete(state);

  try {
    const tokens = await exchangeCodeForTokens(code);
    await saveEbayConnection(pending.userId, tokens, pending.marketplace);
    res.redirect(`${appUrl}/settings?ebay=connected`);
  } catch (err: any) {
    console.error('[eBay callback] error:', err?.response?.data ?? err);
    res.redirect(`${appUrl}/settings?ebay=error&reason=token_exchange`);
  }
});

// ── GET /api/ebay/status ──────────────────────────────────────────────────────
// Returns whether the user has a connected eBay account and its details.
ebayRouter.get('/status', async (req: Request, res: Response) => {
  const userId = await resolveUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { data: conn } = await getSupabaseAdmin()
    .from('user_ebay_connections')
    .select('ebay_marketplace, access_token_expires_at, fulfillment_policy_id, payment_policy_id, return_policy_id, merchant_location_key')
    .eq('user_id', userId)
    .maybeSingle();

  if (!conn) return res.json({ connected: false });

  res.json({
    connected: true,
    marketplace: conn.ebay_marketplace,
    tokenExpiresAt: conn.access_token_expires_at,
    fulfillmentPolicyId: conn.fulfillment_policy_id,
    paymentPolicyId: conn.payment_policy_id,
    returnPolicyId: conn.return_policy_id,
    merchantLocationKey: conn.merchant_location_key,
  });
});

// ── GET /api/ebay/policies ────────────────────────────────────────────────────
// Fetches the user's eBay fulfillment / payment / return policies.
ebayRouter.get('/policies', async (req: Request, res: Response) => {
  const userId = await resolveUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const accessToken = await getValidAccessToken(userId);

    const { data: conn } = await getSupabaseAdmin()
      .from('user_ebay_connections')
      .select('ebay_marketplace')
      .eq('user_id', userId)
      .single();

    const marketplace = conn?.ebay_marketplace ?? 'EBAY_GB';

    const [fulfillment, payment, returns, locations] = await Promise.all([
      getFulfillmentPolicies(accessToken, marketplace),
      getPaymentPolicies(accessToken, marketplace),
      getReturnPolicies(accessToken, marketplace),
      getMerchantLocations(accessToken),
    ]);

    res.json({ fulfillment, payment, returns, locations });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── POST /api/ebay/save-settings ──────────────────────────────────────────────
// Saves the user's chosen eBay policies and marketplace.
ebayRouter.post('/save-settings', async (req: Request, res: Response) => {
  const userId = await resolveUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { fulfillmentPolicyId, paymentPolicyId, returnPolicyId, merchantLocationKey, marketplace } = req.body as {
    fulfillmentPolicyId?: string;
    paymentPolicyId?: string;
    returnPolicyId?: string;
    merchantLocationKey?: string;
    marketplace?: string;
  };

  const { error } = await getSupabaseAdmin()
    .from('user_ebay_connections')
    .update({
      fulfillment_policy_id: fulfillmentPolicyId ?? null,
      payment_policy_id: paymentPolicyId ?? null,
      return_policy_id: returnPolicyId ?? null,
      merchant_location_key: merchantLocationKey ?? null,
      ebay_marketplace: marketplace ?? 'EBAY_GB',
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── POST /api/ebay/create-default-policies ────────────────────────────────────
// Creates default fulfillment, payment, and return policies for the user.
ebayRouter.post('/create-default-policies', async (req: Request, res: Response) => {
  const userId = await resolveUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const accessToken = await getValidAccessToken(userId);

    const { data: conn } = await getSupabaseAdmin()
      .from('user_ebay_connections')
      .select('ebay_marketplace')
      .eq('user_id', userId)
      .single();

    const marketplace = conn?.ebay_marketplace ?? 'EBAY_GB';
    const api = ebayApi(accessToken, marketplace);
    const isUK = marketplace === 'EBAY_GB';
    const currency = isUK ? 'GBP' : 'USD';
    const shippingService = isUK
      ? 'UK_RoyalMailSecondClassStandard'
      : 'US_USPSFirstClass';
    const shippingCost = isUK ? '3.99' : '4.99';

    const categoryTypes = [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }];

    const results: Record<string, string> = {};
    const errors: string[] = [];

    // Fulfillment / shipping policy
    try {
      const fp = await api.post('/sell/account/v1/fulfillment_policy', {
        name: 'Default Shipping',
        marketplaceId: marketplace,
        categoryTypes,
        handlingTime: { value: 3, unit: 'DAY' },
        shippingOptions: [{
          optionType: 'DOMESTIC',
          costType: 'FLAT_RATE',
          shippingServices: [{
            shippingServiceCode: shippingService,
            buyerResponsibleForShipping: false,
            shippingCost: { value: shippingCost, currency },
            freeShipping: false,
          }],
        }],
      });
      results.fulfillmentPolicyId = fp.fulfillmentPolicyId;
    } catch (e: any) {
      const detail = e?.response?.data ?? e?.message ?? String(e);
      console.error('[eBay] fulfillment policy error:', detail);
      // If policy already exists, extract and reuse its ID
      const parsed = typeof detail === 'string' ? JSON.parse(detail) : detail;
      const dupId = parsed?.errors?.[0]?.parameters?.find((p: any) => p.name === 'Shipping Profile Id')?.value;
      if (dupId) {
        results.fulfillmentPolicyId = dupId;
      } else {
        errors.push(`Shipping: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
      }
    }

    // Payment policy
    try {
      const pp = await api.post('/sell/account/v1/payment_policy', {
        name: 'Default Payment',
        marketplaceId: marketplace,
        categoryTypes,
        immediatePay: true,
      });
      results.paymentPolicyId = pp.paymentPolicyId;
    } catch (e: any) {
      const detail = e?.response?.data ?? e?.message ?? String(e);
      console.error('[eBay] payment policy error:', detail);
      // Silently skip sandbox "not opted in to business policies" errors
      const parsed = typeof detail === 'string' ? (() => { try { return JSON.parse(detail); } catch { return {}; } })() : detail;
      if (parsed?.errors?.[0]?.errorId !== 20403) {
        errors.push(`Payment: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
      }
    }

    // Return policy
    try {
      const rp = await api.post('/sell/account/v1/return_policy', {
        name: 'Default Returns',
        marketplaceId: marketplace,
        categoryTypes,
        returnsAccepted: true,
        returnPeriod: { value: 30, unit: 'DAY' },
        returnShippingCostPayer: 'BUYER',
        refundMethod: 'MONEY_BACK',
      });
      results.returnPolicyId = rp.returnPolicyId;
      console.log('[eBay] return policy created:', rp.returnPolicyId);
    } catch (e: any) {
      const detail = e?.response?.data ?? e?.message ?? String(e);
      const parsed = typeof detail === 'string' ? (() => { try { return JSON.parse(detail); } catch { return {}; } })() : detail;
      // Silently skip sandbox "not opted in to business policies" errors
      if (parsed?.errors?.[0]?.errorId !== 20403) {
        errors.push(`Returns: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
      }
    }

    // Merchant location (required for Item.Country)
    const locationKey = 'la-default-location';
    try {
      await api.post(`/sell/inventory/v1/location/${locationKey}`, {
        location: {
          address: {
            addressLine1: '1 Default Street',
            city: isUK ? 'London' : 'New York',
            stateOrProvince: isUK ? 'England' : 'NY',
            postalCode: isUK ? 'SW1A 1AA' : '10001',
            country: isUK ? 'GB' : 'US',
          },
        },
        merchantLocationStatus: 'ENABLED',
        name: 'Default Location',
        locationType: 'WAREHOUSE',
      });
      results.merchantLocationKey = locationKey;
    } catch (e: any) {
      // Location might already exist — that's fine
      results.merchantLocationKey = locationKey;
    }

    // Save whatever succeeded
    if (Object.keys(results).length > 0) {
      await getSupabaseAdmin()
        .from('user_ebay_connections')
        .update({
          ...(results.fulfillmentPolicyId ? { fulfillment_policy_id: results.fulfillmentPolicyId } : {}),
          ...(results.paymentPolicyId ? { payment_policy_id: results.paymentPolicyId } : {}),
          ...(results.returnPolicyId ? { return_policy_id: results.returnPolicyId } : {}),
          ...(results.merchantLocationKey ? { merchant_location_key: results.merchantLocationKey } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
    }

    res.json({ ok: true, results, errors });
  } catch (err: any) {
    const detail = err?.response?.data ?? err?.message;
    console.error('[eBay create-default-policies] error:', detail);
    res.status(500).json({ error: 'Failed to create policies', detail });
  }
});

// ── DELETE /api/ebay/disconnect ───────────────────────────────────────────────
ebayRouter.delete('/disconnect', async (req: Request, res: Response) => {
  const userId = await resolveUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  await getSupabaseAdmin()
    .from('user_ebay_connections')
    .delete()
    .eq('user_id', userId);

  res.json({ ok: true });
});

// ── POST /api/ebay/list ───────────────────────────────────────────────────────
// Creates an eBay listing from an item in the user's inventory.
// Body: { itemId, listingType: 'FIXED_PRICE' | 'AUCTION', startPrice, buyItNowPrice?, auctionDurationDays? }
ebayRouter.post('/list', async (req: Request, res: Response) => {
  const userId = await resolveUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const {
    itemId,
    listingType = 'FIXED_PRICE',
    startPrice,
    buyItNowPrice,
    auctionDurationDays = 7,
  } = req.body as {
    itemId: string;
    listingType?: 'FIXED_PRICE' | 'AUCTION';
    startPrice: number;
    buyItNowPrice?: number;
    auctionDurationDays?: number;
  };

  if (!itemId || startPrice == null) {
    return res.status(400).json({ error: 'itemId and startPrice are required' });
  }

  try {
    const accessToken = await getValidAccessToken(userId);

    // Load item + connection
    const [{ data: item }, { data: conn }] = await Promise.all([
      getSupabaseAdmin()
        .from('items')
        .select('*, images:item_images(public_url, is_primary, sort_order)')
        .eq('id', itemId)
        .eq('user_id', userId)
        .single(),
      getSupabaseAdmin()
        .from('user_ebay_connections')
        .select('*')
        .eq('user_id', userId)
        .single(),
    ]);

    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (!conn) return res.status(400).json({ error: 'eBay account not connected' });

    const marketplace = conn.ebay_marketplace ?? 'EBAY_GB';
    const api = ebayApi(accessToken, marketplace);
    const currency = marketplace === 'EBAY_GB' ? 'GBP' : 'USD';
    const sku = `LA-${itemId}`;

    // Auto-create merchant location if not yet set (required for Item.Country)
    let merchantLocationKey = conn.merchant_location_key ?? null;
    if (!merchantLocationKey) {
      const isUK = marketplace === 'EBAY_GB';
      const locationKey = 'la-default-location';
      try {
        await api.post(`/sell/inventory/v1/location/${locationKey}`, {
          location: {
            address: {
              city: isUK ? 'London' : 'New York',
              postalCode: isUK ? 'SW1A 1AA' : '10001',
              country: isUK ? 'GB' : 'US',
              ...(isUK ? {} : { stateOrProvince: 'NY' }),
            },
          },
          merchantLocationStatus: 'ENABLED',
          name: 'Default Location',
          locationType: 'WAREHOUSE',
        });
      } catch {
        // Already exists — reuse
      }
      merchantLocationKey = locationKey;
      await getSupabaseAdmin()
        .from('user_ebay_connections')
        .update({ merchant_location_key: locationKey, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
    }

    // Sort images — primary first
    const images: { public_url: string; is_primary: boolean; sort_order: number }[] = (item.images ?? []);
    images.sort((a, b) => {
      if (a.is_primary) return -1;
      if (b.is_primary) return 1;
      return a.sort_order - b.sort_order;
    });
    const imageUrls = images.map((img) => img.public_url).filter(Boolean).slice(0, 12);

    const conditionId = CONDITION_MAP[item.condition ?? 'good'] ?? 4000;
    const categoryId = getCategoryId(item.category, marketplace);

    // ── Step 1: Create/update inventory item ──────────────────────────────────
    await api.put(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
      condition: conditionIdToEnum(conditionId),
      conditionDescription: item.condition_notes ?? undefined,
      product: {
        title: item.title,
        description: item.description ?? item.title,
        imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
        aspects: buildAspects(item),
      },
      availability: {
        shipToLocationAvailability: {
          quantity: 1,
        },
      },
    });

    // ── Step 2: Create offer ──────────────────────────────────────────────────
    const offerBody: Record<string, unknown> = {
      sku,
      marketplaceId: marketplace,
      format: listingType,
      availableQuantity: 1,
      categoryId,
      listingDescription: item.description ?? item.title,
      listingPolicies: {
        fulfillmentPolicyId: conn.fulfillment_policy_id,
        ...(conn.payment_policy_id ? { paymentPolicyId: conn.payment_policy_id } : {}),
        ...(conn.return_policy_id ? { returnPolicyId: conn.return_policy_id } : {}),
      },
      merchantLocationKey: merchantLocationKey ?? undefined,
      pricingSummary:
        listingType === 'FIXED_PRICE'
          ? {
              price: { value: String(startPrice.toFixed(2)), currency },
            }
          : {
              auctionStartPrice: { value: String(startPrice.toFixed(2)), currency },
              ...(buyItNowPrice
                ? { auctionReservePrice: { value: String(buyItNowPrice.toFixed(2)), currency } }
                : {}),
            },
      ...(listingType === 'FIXED_PRICE'
        ? { listingDuration: 'GTC' }
        : { listingDuration: `DAYS_${auctionDurationDays}` }),
    };

    // ── Step 2: Create or reuse offer ────────────────────────────────────────
    let offerId: string;
    try {
      const offerData = await api.post('/sell/inventory/v1/offer', offerBody);
      offerId = offerData.offerId;
    } catch (offerErr: any) {
      const offerDetail = offerErr?.response?.data ?? '';
      const offerParsed = typeof offerDetail === 'string'
        ? (() => { try { return JSON.parse(offerDetail); } catch { return {}; } })()
        : offerDetail;
      // If offer already exists, extract its ID and reuse
      const existingId = offerParsed?.errors?.[0]?.parameters?.find(
        (p: any) => p.name === 'offerId'
      )?.value;
      if (existingId) {
        offerId = existingId;
      } else {
        throw offerErr;
      }
    }

    // ── Step 3: Publish offer → creates active listing ────────────────────────
    const publishData = await api.post(
      `/sell/inventory/v1/offer/${offerId}/publish`,
      {}
    );
    const listingId: string = publishData.listingId;

    // Build listing URL
    const baseUrl = EBAY_CONFIG.isSandbox
      ? `https://www.sandbox.ebay.${marketplace === 'EBAY_GB' ? 'co.uk' : 'com'}`
      : `https://www.ebay.${marketplace === 'EBAY_GB' ? 'co.uk' : 'com'}`;
    const listingUrl = `${baseUrl}/itm/${listingId}`;

    // ── Step 4: Save listing ID to item ───────────────────────────────────────
    await getSupabaseAdmin()
      .from('items')
      .update({
        ebay_listing_id: listingId,
        ebay_offer_id: offerId,
        ebay_listing_url: listingUrl,
        ebay_marketplace: marketplace,
        status: 'listed',
      })
      .eq('id', itemId)
      .eq('user_id', userId);

    res.json({ ok: true, listingId, offerId, listingUrl });
  } catch (err: any) {
    const detail = err?.response?.data ?? err?.message ?? 'Unknown error';
    console.error('[eBay list] error:', detail);
    res.status(500).json({ error: 'Failed to create eBay listing', detail });
  }
});

// ── DELETE /api/ebay/list/:listingId ─────────────────────────────────────────
// Ends an active eBay listing (delist).
ebayRouter.delete('/list/:listingId', async (req: Request, res: Response) => {
  const userId = await resolveUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { listingId } = req.params;

  try {
    const accessToken = await getValidAccessToken(userId);
    const api = ebayApi(accessToken, 'EBAY_GB'); // marketplace not critical for delist
    const { data: item } = await getSupabaseAdmin()
      .from('items')
      .select('ebay_offer_id')
      .eq('ebay_listing_id', listingId)
      .eq('user_id', userId)
      .maybeSingle();

    if (item?.ebay_offer_id) {
      // Withdraw the offer (ends the listing)
      await api.delete(`/sell/inventory/v1/offer/${item.ebay_offer_id}`);
    } else {
      // Fallback: try Trading API end-item call if we have a listing ID
      // Not all eBay REST listings can be ended via the Inventory API withdraw
      return res.status(400).json({ error: 'Offer ID not found; cannot delist' });
    }

    // Clear listing fields on item
    await getSupabaseAdmin()
      .from('items')
      .update({
        ebay_listing_id: null,
        ebay_offer_id: null,
        ebay_listing_url: null,
        ebay_marketplace: null,
      })
      .eq('ebay_listing_id', listingId)
      .eq('user_id', userId);

    res.json({ ok: true });
  } catch (err: any) {
    const detail = err?.response?.data ?? err?.message;
    console.error('[eBay delist] error:', detail);
    res.status(500).json({ error: 'Failed to end eBay listing', detail });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function conditionIdToEnum(conditionId: number): string {
  const map: Record<number, string> = {
    1000: 'NEW',
    1500: 'LIKE_NEW',
    2000: 'LIKE_NEW',
    2500: 'LIKE_NEW',
    3000: 'USED_EXCELLENT',
    4000: 'USED_GOOD',
    5000: 'USED_ACCEPTABLE',
    6000: 'FOR_PARTS_OR_NOT_WORKING',
  };
  return map[conditionId] ?? 'USED_GOOD';
}

function buildAspects(item: Record<string, any>): Record<string, string[]> {
  const aspects: Record<string, string[]> = {};
  if (item.brand) aspects['Brand'] = [item.brand];
  if (item.size) aspects['Size'] = [item.size];
  if (item.colour) aspects['Colour'] = [item.colour];
  return aspects;
}
