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
    const api = ebayApi(accessToken);

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
    const currency = marketplace === 'EBAY_GB' ? 'GBP' : 'USD';
    const sku = `LA-${itemId}`;

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
        paymentPolicyId: conn.payment_policy_id,
        returnPolicyId: conn.return_policy_id,
      },
      merchantLocationKey: conn.merchant_location_key ?? undefined,
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

    const offerData = await api.post('/sell/inventory/v1/offer', offerBody);
    const offerId: string = offerData.offerId;

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
    const api = ebayApi(accessToken);

    // Find the offer ID from our DB
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
