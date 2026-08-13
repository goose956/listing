import { Router } from 'express';
import { getSupabaseAdmin, isSupabaseAdminConfigured } from '../lib/supabaseAdmin.js';

export const extensionRouter = Router();

function mergePostedMarketplaces(existing: unknown, platform: string): string[] {
  const current = Array.isArray(existing)
    ? existing.filter((value): value is string => typeof value === 'string')
    : [];
  const normalizedPlatform = platform.trim().toLowerCase();
  if (!normalizedPlatform) return current;
  return [...new Set([...current, normalizedPlatform])];
}

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

// Returns scheduled/due queue items with item details and image URLs
extensionRouter.get('/queue', async (req, res) => {
  const userId = await resolveUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { data, error } = await getSupabaseAdmin()
    .from('listing_queue')
    .select(`
      id,
      scheduled_at,
      item_id,
      status,
      platform,
      items (
        id,
        item_number,
        title,
        description,
        list_price,
        suggested_price,
        platform_prices,
        brand,
        size,
        colour,
        condition,
        category,
        tags,
        item_images (
          public_url,
          is_primary,
          sort_order
        )
      )
    `)
    .eq('user_id', userId)
    .in('status', ['scheduled', 'due'])
    .order('scheduled_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const items = (data ?? []).map((entry: any) => {
    const item = entry.items;
    const images = ((item?.item_images ?? []) as any[])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((img) => ({ url: img.public_url as string, is_primary: img.is_primary as boolean }));

    return {
      queue_id: entry.id as string,
      scheduled_at: entry.scheduled_at as string,
      item_id: entry.item_id as string,
      platform: (entry.platform as string) ?? 'vinted',
      item_number: item?.item_number ?? '',
      title: item?.title ?? null,
      description: item?.description ?? null,
      price: item?.list_price ?? item?.suggested_price ?? null,
      platform_prices: (item?.platform_prices as Record<string, number>) ?? {},
      brand: item?.brand ?? null,
      size: item?.size ?? null,
      colour: item?.colour ?? null,
      condition: item?.condition ?? null,
      category: item?.category ?? null,
      tags: item?.tags ?? null,
      images,
    };
  });

  return res.json({ items });
});

// Marks a queue entry as completed and sets item status to listed
extensionRouter.post('/queue/:queueId/complete', async (req, res) => {
  const userId = await resolveUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { queueId } = req.params;

  const { data: entry, error: fetchError } = await getSupabaseAdmin()
    .from('listing_queue')
    .select('id, item_id, user_id, platform')
    .eq('id', queueId)
    .eq('user_id', userId)
    .maybeSingle();

  if (fetchError || !entry) return res.status(404).json({ error: 'Queue entry not found' });

  const now = new Date().toISOString();

  await getSupabaseAdmin()
    .from('listing_queue')
    .update({ status: 'completed', completed_at: now })
    .eq('id', queueId);

  const { data: item } = await getSupabaseAdmin()
    .from('items')
    .select('posted_marketplaces')
    .eq('id', (entry as any).item_id)
    .eq('user_id', userId)
    .maybeSingle();

  const postedMarketplaces = mergePostedMarketplaces(item?.posted_marketplaces, (entry as any).platform ?? 'vinted');

  await getSupabaseAdmin()
    .from('items')
    .update({ status: 'listed', listed_date: now, posted_marketplaces: postedMarketplaces })
    .eq('id', (entry as any).item_id)
    .eq('user_id', userId);

  return res.json({ success: true });
});
