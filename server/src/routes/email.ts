import { Router } from 'express';
import { Resend } from 'resend';
import { getSupabaseAdmin, isSupabaseAdminConfigured } from '../lib/supabaseAdmin.js';
import { logError } from '../lib/errorLog.js';

export const emailRouter = Router();

/** Resolve the user id from a Supabase JWT via the service role. */
async function resolveUserId(authHeader?: string): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length);
  if (!token || !isSupabaseAdminConfigured()) return null;

  try {
    const {
      data: { user },
      error,
    } = await getSupabaseAdmin().auth.getUser(token);
    if (error || !user) return null;
    return user.id;
  } catch {
    return null;
  }
}

/** Get the user's stored email address (for sending listings to). */
async function resolveEmailAddress(userId: string | null): Promise<string | null> {
  if (!userId || !isSupabaseAdminConfigured()) return null;
  try {
    const { data } = await getSupabaseAdmin()
      .from('user_settings')
      .select('email_address')
      .eq('user_id', userId)
      .maybeSingle();
    if (data?.email_address) return String(data.email_address);
  } catch {
    // ignore
  }
  return null;
}

function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error('RESEND_API_KEY is not configured. Add it to server/.env');
  }
  return new Resend(key);
}

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Listings Assistant <onboarding@resend.dev>';
const SOLD_FORWARDING_LOCAL_PART = 'sold';

interface SoldForwardingAddressResponse {
  configured: boolean;
  address: string | null;
  token: string;
}

interface ParsedBuyerAddress {
  buyerName: string | null;
  addressLines: string[];
  postcode: string | null;
  country: string | null;
}

type ReviewProcessingStatus = 'received' | 'matched' | 'auto_marked_sold' | 'manually_marked_sold' | 'needs_review' | 'ignored' | 'error';

function getSoldInboxDomain(): string | null {
  const domain = process.env.SOLD_INBOX_DOMAIN?.trim().toLowerCase();
  return domain || null;
}

async function ensureSoldForwardingToken(userId: string): Promise<string> {
  const db = getSupabaseAdmin();
  const { data: existing } = await db
    .from('user_settings')
    .select('sold_forwarding_token')
    .eq('user_id', userId)
    .maybeSingle();

  const currentToken = typeof existing?.sold_forwarding_token === 'string'
    ? existing.sold_forwarding_token.trim()
    : '';
  if (currentToken) return currentToken;

  const { data: inserted, error } = await db
    .from('user_settings')
    .upsert({ user_id: userId }, { onConflict: 'user_id' })
    .select('sold_forwarding_token')
    .single();

  if (error || !inserted?.sold_forwarding_token) {
    throw new Error(error?.message || 'Failed to create sold forwarding token');
  }

  return String(inserted.sold_forwarding_token);
}

function buildSoldForwardingAddress(token: string): SoldForwardingAddressResponse {
  const domain = getSoldInboxDomain();
  return {
    configured: Boolean(domain),
    address: domain ? `${SOLD_FORWARDING_LOCAL_PART}+${token}@${domain}` : null,
    token,
  };
}

function readString(payload: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function extractEmailAddresses(value: string): string[] {
  return Array.from(value.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)).map((match) => match[0].toLowerCase());
}

function extractForwardingToken(addresses: string[]): string | null {
  for (const address of addresses) {
    const localPart = address.split('@')[0] || '';
    if (localPart.startsWith(`${SOLD_FORWARDING_LOCAL_PART}+`)) {
      const token = localPart.slice(SOLD_FORWARDING_LOCAL_PART.length + 1).trim();
      if (token) return token;
    }
  }
  return null;
}

function detectPlatform(fromAddress: string, subject: string, body: string): string | null {
  const haystack = `${fromAddress}\n${subject}\n${body}`.toLowerCase();
  if (haystack.includes('vinted')) return 'vinted';
  if (haystack.includes('ebay')) return 'ebay';
  if (haystack.includes('depop')) return 'depop';
  if (haystack.includes('etsy')) return 'etsy';
  return null;
}

function detectItemNumber(subject: string, body: string): string | null {
  const match = `${subject}\n${body}`.match(/\b[A-Z]{1,3}-\d{4,}\b/);
  return match ? match[0].toUpperCase() : null;
}

function detectSalePrice(subject: string, body: string): { amount: number | null; currency: string | null } {
  const haystack = `${subject}\n${body}`;
  const patterns: Array<{ regex: RegExp; currency: string }> = [
    { regex: /£\s?(\d+(?:[.,]\d{1,2})?)/, currency: 'GBP' },
    { regex: /GBP\s?(\d+(?:[.,]\d{1,2})?)/i, currency: 'GBP' },
    { regex: /\$\s?(\d+(?:[.,]\d{1,2})?)/, currency: 'USD' },
    { regex: /USD\s?(\d+(?:[.,]\d{1,2})?)/i, currency: 'USD' },
    { regex: /EUR\s?(\d+(?:[.,]\d{1,2})?)/i, currency: 'EUR' },
    { regex: /€\s?(\d+(?:[.,]\d{1,2})?)/, currency: 'EUR' },
  ];

  for (const pattern of patterns) {
    const match = haystack.match(pattern.regex);
    if (match) {
      const amount = Number(match[1].replace(',', '.'));
      if (Number.isFinite(amount)) {
        return { amount, currency: pattern.currency };
      }
    }
  }

  return { amount: null, currency: null };
}

function normalizeMultilineText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function cleanAddressLine(value: string): string {
  return value
    .replace(/^[\s>*\-:|]+/, '')
    .replace(/^(name|buyer|recipient|address|delivery address|shipping address)\s*:\s*/i, '')
    .trim();
}

function looksLikeCountry(value: string): boolean {
  return /^(united kingdom|great britain|england|scotland|wales|northern ireland|uk|usa|united states|france|germany|italy|spain|ireland|netherlands|belgium|australia|canada)$/i.test(value.trim());
}

function detectPostcode(lines: string[]): string | null {
  const text = lines.join(' ');
  const uk = text.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i);
  if (uk) return uk[0].toUpperCase();
  const us = text.match(/\b\d{5}(?:-\d{4})?\b/);
  if (us) return us[0];
  return null;
}

function extractAddressBlock(body: string): string | null {
  const normalized = normalizeMultilineText(body);
  const explicitBlockPatterns = [
    /(?:shipping|delivery|postal)\s+address\s*:?\s*\n([\s\S]{0,600})/i,
    /(?:ship to|send to|deliver to|post to)\s*:?\s*\n([\s\S]{0,600})/i,
    /buyer(?:'s)?\s+address\s*:?\s*\n([\s\S]{0,600})/i,
  ];

  for (const pattern of explicitBlockPatterns) {
    const match = normalized.match(pattern);
    if (match?.[1]?.trim()) return match[1];
  }

  const lines = normalized.split('\n');
  const startIndex = lines.findIndex((line) => /(?:shipping|delivery|postal)\s+address|buyer(?:'s)?\s+address|ship to|send to|deliver to|post to/i.test(line));
  if (startIndex >= 0) {
    return lines.slice(startIndex + 1, startIndex + 9).join('\n');
  }

  return null;
}

function parseBuyerAddress(payload: Record<string, unknown>, body: string): ParsedBuyerAddress | null {
  const directAddress = readString(payload, ['buyer_address', 'shipping_address', 'delivery_address', 'recipient_address']);
  const rawBlock = directAddress || extractAddressBlock(body);
  if (!rawBlock) return null;

  const stopLinePattern = /^(order|order number|item|item number|tracking|dispatch|ship by|send by|post by|view|thanks|thank you|payment|price|sold|message|contact|support|download|qr code|reference)\b/i;
  const rawLines = normalizeMultilineText(rawBlock)
    .split('\n')
    .map(cleanAddressLine)
    .filter(Boolean);

  const addressLines: string[] = [];
  for (const line of rawLines) {
    if (stopLinePattern.test(line) && addressLines.length > 0) break;
    if (/@/.test(line) || /^https?:\/\//i.test(line)) continue;
    if (line.length < 3) continue;
    addressLines.push(line);
    if (addressLines.length >= 6) break;
  }

  if (addressLines.length === 0) return null;

  let buyerName = readString(payload, ['buyer_name', 'recipient_name', 'shipping_name', 'delivery_name']) || null;
  let linesForLabel = [...addressLines];
  if (!buyerName && addressLines.length > 1 && !/\d/.test(addressLines[0])) {
    buyerName = addressLines[0];
    linesForLabel = addressLines.slice(1);
  }

  if (linesForLabel.length === 0) {
    linesForLabel = buyerName ? [buyerName] : [];
    buyerName = null;
  }

  const lastLine = linesForLabel[linesForLabel.length - 1] ?? '';
  const country = looksLikeCountry(lastLine) ? lastLine : null;
  const postcode = detectPostcode(linesForLabel);

  return {
    buyerName,
    addressLines: linesForLabel,
    postcode,
    country,
  };
}

function buildBodyExcerpt(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, 2000);
}

function getInboundSecret(req: { headers: Record<string, unknown>; query: Record<string, unknown> }) {
  const headerSecret = typeof req.headers['x-starsella-inbound-secret'] === 'string'
    ? req.headers['x-starsella-inbound-secret']
    : '';
  const querySecret = typeof req.query.secret === 'string' ? req.query.secret : '';
  return headerSecret || querySecret;
}

function getReceivedAt(payload: Record<string, unknown>): string {
  const source = readString(payload, ['date', 'Date', 'received_at', 'timestamp']);
  if (!source) return new Date().toISOString();
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

async function requireAuthedUserId(authHeader?: string): Promise<string> {
  const userId = await resolveUserId(authHeader);
  if (!userId) throw new Error('Unauthorized');
  return userId;
}

async function resolveOwnedItem(userId: string, itemId: string) {
  const { data: item, error } = await getSupabaseAdmin()
    .from('items')
    .select('id, user_id, status')
    .eq('id', itemId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!item?.id) throw new Error('Item not found');
  return item;
}

emailRouter.get('/sold-forwarding', async (req, res) => {
  try {
    const userId = await resolveUserId(req.headers.authorization);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const token = await ensureSoldForwardingToken(userId);
    res.json(buildSoldForwardingAddress(token));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load sold forwarding address' });
  }
});

emailRouter.post('/inbound/sold', async (req, res) => {
  const expectedSecret = process.env.INBOUND_EMAIL_SECRET?.trim();
  if (expectedSecret && getInboundSecret(req) !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized inbound request' });
  }

  try {
    const payload = (req.body ?? {}) as Record<string, unknown>;
    const toValue = readString(payload, ['to', 'recipient', 'To', 'Delivered-To', 'X-Original-To']);
    const fromAddress = readString(payload, ['from', 'sender', 'From']);
    const subject = readString(payload, ['subject', 'Subject']);
    const body = readString(payload, ['text', 'stripped-text', 'body-plain', 'TextBody', 'body']);
    const messageId = readString(payload, ['message_id', 'MessageID', 'Message-Id']);
    const toAddresses = extractEmailAddresses(toValue);
    const token = extractForwardingToken(toAddresses);

    if (!token) {
      await logError({ type: 'sold_inbound_missing_token', message: 'Inbound sold email missing forwarding token', detail: { toValue, subject } });
      return res.status(400).json({ error: 'Sold forwarding token not found in recipient address' });
    }

    const db = getSupabaseAdmin();
    const { data: settings } = await db
      .from('user_settings')
      .select('user_id')
      .eq('sold_forwarding_token', token)
      .maybeSingle();

    if (!settings?.user_id) {
      await logError({ type: 'sold_inbound_unknown_token', message: 'Inbound sold email token did not match a user', detail: { token, subject } });
      return res.status(404).json({ error: 'Unknown sold forwarding token' });
    }

    const platform = detectPlatform(fromAddress, subject, body);
    const detectedItemNumber = detectItemNumber(subject, body);
    const { amount, currency } = detectSalePrice(subject, body);
    const receivedAt = getReceivedAt(payload);
    const bodyExcerpt = buildBodyExcerpt(body);
    const buyerAddress = parseBuyerAddress(payload, body);

    let matchedItemId: string | null = null;
    let autoMarkedSold = false;
    let processingStatus: ReviewProcessingStatus = detectedItemNumber ? 'matched' : 'needs_review';

    if (detectedItemNumber) {
      const { data: item } = await db
        .from('items')
        .select('id, status')
        .eq('user_id', settings.user_id)
        .eq('item_number', detectedItemNumber)
        .maybeSingle();

      if (item?.id) {
        matchedItemId = item.id as string;
        if (item.status !== 'sold') {
          const updatePayload: Record<string, unknown> = {
            status: 'sold',
            sold_date: receivedAt,
          };
          if (amount != null) updatePayload.sale_price = amount;

          await db
            .from('items')
            .update(updatePayload)
            .eq('id', item.id)
            .eq('user_id', settings.user_id);

          autoMarkedSold = true;
          processingStatus = 'auto_marked_sold';
        }
      } else {
        processingStatus = 'needs_review';
      }
    }

    const { data: inserted, error } = await db
      .from('sale_inbox_events')
      .insert({
        user_id: settings.user_id,
        message_id: messageId || null,
        source_platform: platform,
        from_address: fromAddress || null,
        to_address: toAddresses[0] || toValue || `${SOLD_FORWARDING_LOCAL_PART}+${token}`,
        subject: subject || null,
        body_excerpt: bodyExcerpt || null,
        detected_item_number: detectedItemNumber,
        detected_listing_title: subject || null,
        detected_sale_price: amount,
        detected_currency: currency,
        buyer_name: buyerAddress?.buyerName ?? null,
        buyer_address_lines: buyerAddress?.addressLines?.length ? buyerAddress.addressLines : null,
        buyer_postcode: buyerAddress?.postcode ?? null,
        buyer_country: buyerAddress?.country ?? null,
        matched_item_id: matchedItemId,
        auto_marked_sold: autoMarkedSold,
        processing_status: processingStatus,
        received_at: receivedAt,
        processed_at: autoMarkedSold || matchedItemId ? new Date().toISOString() : null,
      })
      .select('id, processing_status, matched_item_id, auto_marked_sold')
      .single();

    if (error) throw error;

    res.json({
      ok: true,
      eventId: inserted?.id,
      processingStatus: inserted?.processing_status,
      matchedItemId: inserted?.matched_item_id,
      autoMarkedSold: inserted?.auto_marked_sold,
    });
  } catch (err) {
    await logError({ type: 'sold_inbound_failed', message: err instanceof Error ? err.message : 'Inbound sold email processing failed', detail: req.body });
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to process inbound sold email' });
  }
});

emailRouter.post('/sold-events/:eventId/review', async (req, res) => {
  try {
    const userId = await requireAuthedUserId(req.headers.authorization);
    const eventId = String(req.params.eventId || '').trim();
    const action = String((req.body as Record<string, unknown>)?.action || '').trim();
    const providedItemId = typeof (req.body as Record<string, unknown>)?.matchedItemId === 'string'
      ? String((req.body as Record<string, unknown>).matchedItemId).trim()
      : '';

    if (!eventId) return res.status(400).json({ error: 'Event id is required' });

    const db = getSupabaseAdmin();
    const { data: event, error: eventError } = await db
      .from('sale_inbox_events')
      .select('id, user_id, received_at, detected_sale_price, matched_item_id')
      .eq('id', eventId)
      .eq('user_id', userId)
      .maybeSingle();

    if (eventError) throw eventError;
    if (!event?.id) return res.status(404).json({ error: 'Sale inbox event not found' });

    const resolvedItemId = providedItemId || (typeof event.matched_item_id === 'string' ? event.matched_item_id : '');
    const processedAt = new Date().toISOString();

    if (action === 'ignore') {
      const { error } = await db
        .from('sale_inbox_events')
        .update({ processing_status: 'ignored', processed_at: processedAt, auto_marked_sold: false })
        .eq('id', eventId)
        .eq('user_id', userId);
      if (error) throw error;
      return res.json({ ok: true, processingStatus: 'ignored' });
    }

    if (action === 'reopen') {
      const { error } = await db
        .from('sale_inbox_events')
        .update({ processing_status: 'needs_review', processed_at: null, matched_item_id: null, auto_marked_sold: false })
        .eq('id', eventId)
        .eq('user_id', userId);
      if (error) throw error;
      return res.json({ ok: true, processingStatus: 'needs_review' });
    }

    if (!resolvedItemId) {
      return res.status(400).json({ error: 'Select a matching item first' });
    }

    const item = await resolveOwnedItem(userId, resolvedItemId);

    if (action === 'match_item') {
      const { error } = await db
        .from('sale_inbox_events')
        .update({ matched_item_id: item.id, processing_status: 'matched', processed_at: processedAt, auto_marked_sold: false })
        .eq('id', eventId)
        .eq('user_id', userId);
      if (error) throw error;
      return res.json({ ok: true, processingStatus: 'matched', matchedItemId: item.id });
    }

    if (action === 'match_and_mark_sold') {
      const detectedSalePrice = event.detected_sale_price == null ? null : Number(event.detected_sale_price);
      const itemUpdate: Record<string, unknown> = {
        status: 'sold',
        sold_date: event.received_at || processedAt,
      };
      if (detectedSalePrice != null && Number.isFinite(detectedSalePrice)) {
        itemUpdate.sale_price = detectedSalePrice;
      }

      if (item.status !== 'sold') {
        const { error: itemError } = await db
          .from('items')
          .update(itemUpdate)
          .eq('id', item.id)
          .eq('user_id', userId);
        if (itemError) throw itemError;
      }

      const { error } = await db
        .from('sale_inbox_events')
        .update({ matched_item_id: item.id, processing_status: 'manually_marked_sold', processed_at: processedAt, auto_marked_sold: false })
        .eq('id', eventId)
        .eq('user_id', userId);
      if (error) throw error;
      return res.json({ ok: true, processingStatus: 'manually_marked_sold', matchedItemId: item.id });
    }

    return res.status(400).json({ error: 'Unsupported review action' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to review sale inbox event';
    if (message === 'Unauthorized') {
      return res.status(401).json({ error: message });
    }
    await logError({ type: 'sold_review_failed', message, detail: { params: req.params, body: req.body } });
    return res.status(500).json({ error: message });
  }
});

/**
 * Email one or more listings to the user's saved email address.
 * Body: { items: Array<{ item_number, title, description, list_price, size, colour, brand, tags, image_urls }> }
 */
emailRouter.post('/send', async (req, res) => {
  try {
    const { items } = req.body as {
      items?: Array<{
        item_number?: string;
        title?: string;
        description?: string;
        list_price?: number | null;
        size?: string | null;
        colour?: string | null;
        brand?: string | null;
        tags?: string[] | null;
        image_urls?: string[];
      }>;
    };

    if (!items?.length) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    const userId = await resolveUserId(req.headers.authorization);
    const toEmail = await resolveEmailAddress(userId);
    if (!toEmail) {
      return res.status(400).json({
        error: 'No email address saved. Add one in Settings first.',
      });
    }

    const resend = getResend();

    // Build a clean text + HTML body for the email
    const sections = items.map((item) => {
      const title = item.title || [item.brand, item.colour, item.size].filter(Boolean).join(' ') || 'Untitled';
      const price = item.list_price != null ? `£${item.list_price}` : 'Price not set';
      const tags = item.tags?.length ? `Tags: ${item.tags.join(', ')}` : '';
      const images = item.image_urls?.length
        ? item.image_urls.map((u) => `<img src="${u}" alt="" style="max-width:200px;border-radius:8px;margin:4px;" />`).join('')
        : '';

      return {
        text: `\n\n=== ${item.item_number || 'Item'} ===\n${title}\n${price}\n${item.size ? `Size: ${item.size}\n` : ''}${item.colour ? `Colour: ${item.colour}\n` : ''}${tags}\n\n${item.description || ''}\n`,
        html: `
          <div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:16px;font-family:Arial,sans-serif;">
            <h2 style="margin:0 0 4px;color:#0f766e;">${item.item_number || 'Item'} — ${title}</h2>
            <p style="margin:0 0 8px;color:#334155;"><strong>${price}</strong>${item.size ? ` · Size ${item.size}` : ''}${item.colour ? ` · ${item.colour}` : ''}</p>
            ${tags ? `<p style="margin:0 0 8px;color:#64748b;font-size:13px;">${tags}</p>` : ''}
            <p style="margin:0 0 8px;color:#475569;white-space:pre-wrap;">${item.description || ''}</p>
            <div>${images}</div>
          </div>
        `,
      };
    });

    const subject =
      items.length === 1
        ? `Listing: ${items[0].item_number || 'Item'} — ${items[0].title || 'Ready to post'}`
        : `${items.length} listings ready to post`;

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [toEmail],
      subject,
      text: sections.map((s) => s.text).join('\n'),
      html: `<div style="background:#f8fafc;padding:24px;">${sections.map((s) => s.html).join('')}</div>`,
    });

    if (error) {
      console.error('Resend error:', error);
      return res.status(500).json({ error: error.message || 'Failed to send email' });
    }

    res.json({ ok: true, id: data?.id, to: toEmail, count: items.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Email send failed';
    console.error('Email error:', message);
    res.status(500).json({ error: message });
  }
});