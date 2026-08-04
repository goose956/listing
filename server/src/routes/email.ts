import { Router } from 'express';
import { Resend } from 'resend';
import { getSupabaseAdmin, isSupabaseAdminConfigured } from '../lib/supabaseAdmin.js';

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