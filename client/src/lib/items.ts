import { supabase } from './supabase';
import type {
  DashboardStats,
  Item,
  ItemFormData,
  ItemImage,
  ItemStatus,
  ListingQueueEntry,
} from '../types';
import { parseMoneyInput } from './format';

function formToDb(form: Partial<ItemFormData>, userId: string) {
  return {
    user_id: userId,
    category: form.category || null,
    brand: form.brand || null,
    product_type: form.product_type || null,
    size: form.size || null,
    colour: form.colour || null,
    condition: form.condition || null,
    purchase_price: parseMoneyInput(form.purchase_price || ''),
    suggested_price: parseMoneyInput(form.suggested_price || ''),
    list_price: parseMoneyInput(form.list_price || ''),
    accept_offers_above: parseMoneyInput(form.accept_offers_above || ''),
    sale_price: parseMoneyInput(form.sale_price || ''),
    storage_container: form.storage_container || null,
    storage_shelf: form.storage_shelf || null,
    storage_box: form.storage_box || null,
    storage_notes: form.storage_notes || null,
    title: form.title || null,
    description: form.description || null,
    tags: form.tags
      ? form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : null,
    notes: form.notes || null,
    measurements: form.measurements || null,
    status: (form.status as ItemStatus) || 'new',
  };
}

export function itemToForm(item: Item): ItemFormData {
  return {
    category: item.category || '',
    brand: item.brand || '',
    product_type: item.product_type || '',
    size: item.size || '',
    colour: item.colour || '',
    condition: item.condition || '',
    purchase_price: item.purchase_price != null ? String(item.purchase_price) : '',
    suggested_price: item.suggested_price != null ? String(item.suggested_price) : '',
    list_price: item.list_price != null ? String(item.list_price) : '',
    accept_offers_above:
      item.accept_offers_above != null ? String(item.accept_offers_above) : '',
    storage_container: item.storage_container || '',
    storage_shelf: item.storage_shelf || '',
    storage_box: item.storage_box || '',
    storage_notes: item.storage_notes || '',
    title: item.title || '',
    description: item.description || '',
    tags: item.tags?.join(', ') || '',
    notes: item.notes || '',
    measurements: item.measurements || '',
    status: item.status,
    sale_price: item.sale_price != null ? String(item.sale_price) : '',
  };
}

export async function fetchItems(opts?: {
  status?: ItemStatus | ItemStatus[];
  search?: string;
  limit?: number;
}): Promise<Item[]> {
  let query = supabase
    .from('items')
    .select('*, item_images(*)')
    .order('date_added', { ascending: false });

  if (opts?.status) {
    if (Array.isArray(opts.status)) {
      query = query.in('status', opts.status);
    } else {
      query = query.eq('status', opts.status);
    }
  }

  if (opts?.search?.trim()) {
    const q = opts.search.trim();
    // Simple ilike across key fields
    query = query.or(
      `item_number.ilike.%${q}%,brand.ilike.%${q}%,product_type.ilike.%${q}%,title.ilike.%${q}%,category.ilike.%${q}%,colour.ilike.%${q}%,storage_container.ilike.%${q}%,storage_box.ilike.%${q}%,notes.ilike.%${q}%`
    );
  }

  if (opts?.limit) {
    query = query.limit(opts.limit);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map(normalizeItem);
}

export async function fetchItem(id: string): Promise<Item | null> {
  const { data, error } = await supabase
    .from('items')
    .select('*, item_images(*)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeItem(data) : null;
}

function normalizeItem(row: Record<string, unknown>): Item {
  const images = (row.item_images as ItemImage[] | undefined) || [];
  const sorted = [...images].sort((a, b) => a.sort_order - b.sort_order);
  const primary =
    sorted.find((i) => i.is_primary)?.public_url || sorted[0]?.public_url || null;
  const purchase = Number(row.purchase_price) || 0;
  const sale = row.sale_price != null ? Number(row.sale_price) : null;
  const postedMarketplaces = Array.isArray(row.posted_marketplaces)
    ? row.posted_marketplaces.filter((value): value is string => typeof value === 'string')
    : [];

  return {
    ...(row as unknown as Item),
    posted_marketplaces: postedMarketplaces,
    item_images: sorted,
    primary_image_url: primary,
    image_count: sorted.length,
    profit: sale != null ? sale - purchase : null,
  };
}

function mergePostedMarketplaces(existing: unknown, platform: string): string[] {
  const current = Array.isArray(existing)
    ? existing.filter((value): value is string => typeof value === 'string')
    : [];
  const normalizedPlatform = platform.trim().toLowerCase();
  if (!normalizedPlatform) return current;
  return [...new Set([...current, normalizedPlatform])];
}

async function loadPostedMarketplaces(itemId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('items')
    .select('posted_marketplaces')
    .eq('id', itemId)
    .single();

  if (error) throw error;
  return Array.isArray(data?.posted_marketplaces)
    ? data.posted_marketplaces.filter((value): value is string => typeof value === 'string')
    : [];
}

export async function createItem(
  userId: string,
  form: Partial<ItemFormData>,
  extras?: { ai_analysis?: Record<string, unknown> | null }
): Promise<Item> {
  const payload = {
    ...formToDb(form, userId),
    ai_analysis: extras?.ai_analysis ?? null,
  };

  const { data, error } = await supabase
    .from('items')
    .insert(payload)
    .select('*, item_images(*)')
    .single();

  if (error) throw error;
  return normalizeItem(data);
}

export async function updateItem(
  id: string,
  form: Partial<ItemFormData>,
  extras?: Record<string, unknown>
): Promise<Item> {
  // Build update without forcing user_id
  const base = formToDb({ ...form }, '');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { user_id: _u, ...rest } = base;

  const payload: Record<string, unknown> = { ...rest, ...extras };

  // Handle sold status side effects
  if (form.status === 'sold' && !extras?.sold_date) {
    payload.sold_date = new Date().toISOString();
  }
  if (form.status === 'listed' && !extras?.listed_date) {
    payload.listed_date = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('items')
    .update(payload)
    .eq('id', id)
    .select('*, item_images(*)')
    .single();

  if (error) throw error;
  return normalizeItem(data);
}

export async function clearItemImages(itemId: string): Promise<void> {
  // Delete storage files first, then rows
  const { data: images } = await supabase
    .from('item_images')
    .select('storage_path, original_path')
    .eq('item_id', itemId);

  if (images?.length) {
    const paths = images
      .flatMap((i) => [i.storage_path, i.original_path])
      .filter(Boolean) as string[];
    if (paths.length) {
      await supabase.storage.from('item-images').remove(paths);
    }
  }

  const { error } = await supabase.from('item_images').delete().eq('item_id', itemId);
  if (error) throw error;
}

export async function deleteItem(id: string): Promise<void> {
  // Remove associated images (storage + rows), then the item
  await clearItemImages(id);
  const { error } = await supabase.from('items').delete().eq('id', id);
  if (error) throw error;
}

export async function uploadItemImage(
  userId: string,
  itemId: string,
  file: Blob,
  opts?: { isPrimary?: boolean; sortOrder?: number; isEnhanced?: boolean }
): Promise<ItemImage> {
  const ext = 'jpg';
  const fileName = `${crypto.randomUUID()}.${ext}`;
  const path = `${userId}/${itemId}/${fileName}`;

  const { error: upErr } = await supabase.storage
    .from('item-images')
    .upload(path, file, { contentType: 'image/jpeg', upsert: false });

  if (upErr) throw upErr;

  const { data: urlData } = supabase.storage.from('item-images').getPublicUrl(path);

  const { data, error } = await supabase
    .from('item_images')
    .insert({
      item_id: itemId,
      user_id: userId,
      storage_path: path,
      public_url: urlData.publicUrl,
      is_primary: opts?.isPrimary ?? false,
      sort_order: opts?.sortOrder ?? 0,
      is_enhanced: opts?.isEnhanced ?? false,
    })
    .select()
    .single();

  if (error) throw error;
  return data as ItemImage;
}

export async function fetchDashboardStats(userId: string): Promise<DashboardStats> {
  const { data, error } = await supabase.rpc('get_dashboard_stats', {
    p_user_id: userId,
  });
  if (error) throw error;
  return data as DashboardStats;
}

// ---- Listing queue ----

export async function fetchQueue(): Promise<ListingQueueEntry[]> {
  const { data, error } = await supabase
    .from('listing_queue')
    .select('*, items(*, item_images(*))')
    .in('status', ['scheduled', 'due'])
    .order('scheduled_at', { ascending: true });

  if (error) throw error;

  return (data || []).map((row) => ({
    ...row,
    items: row.items ? normalizeItem(row.items as unknown as Record<string, unknown>) : undefined,
  })) as ListingQueueEntry[];
}

/** Count queue entries that are due now (scheduled_at <= now, not completed). */
export async function fetchDueQueueCount(): Promise<number> {
  const now = new Date().toISOString();
  const { count, error } = await supabase
    .from('listing_queue')
    .select('id', { count: 'exact', head: true })
    .in('status', ['scheduled', 'due'])
    .lte('scheduled_at', now);

  if (error) throw error;
  return count ?? 0;
}

export async function scheduleListing(
  userId: string,
  itemId: string,
  scheduledAt: string,
  notes?: string,
  platform = 'vinted'
): Promise<ListingQueueEntry> {
  const { data, error } = await supabase
    .from('listing_queue')
    .upsert(
      {
        user_id: userId,
        item_id: itemId,
        scheduled_at: scheduledAt,
        platform,
        status: 'scheduled',
        notes: notes || null,
        completed_at: null,
        reminder_sent: false,
      },
      { onConflict: 'item_id' }
    )
    .select()
    .single();

  if (error) throw error;

  // Mark item ready if still new
  await supabase
    .from('items')
    .update({ status: 'ready_for_listing' })
    .eq('id', itemId)
    .eq('status', 'new');

  return data as ListingQueueEntry;
}

export async function completeQueueEntry(
  queueId: string,
  itemId: string,
  platform = 'vinted'
): Promise<void> {
  const now = new Date().toISOString();
  const postedMarketplaces = mergePostedMarketplaces(await loadPostedMarketplaces(itemId), platform);
  const { error: qErr } = await supabase
    .from('listing_queue')
    .update({ status: 'completed', completed_at: now })
    .eq('id', queueId);
  if (qErr) throw qErr;

  const { error: iErr } = await supabase
    .from('items')
    .update({ status: 'listed', listed_date: now, posted_marketplaces: postedMarketplaces })
    .eq('id', itemId);
  if (iErr) throw iErr;
}

export async function skipQueueEntry(queueId: string): Promise<void> {
  const { error } = await supabase
    .from('listing_queue')
    .update({ status: 'skipped' })
    .eq('id', queueId);
  if (error) throw error;
}

export async function cancelQueueEntry(queueId: string): Promise<void> {
  const { error } = await supabase
    .from('listing_queue')
    .update({ status: 'cancelled' })
    .eq('id', queueId);
  if (error) throw error;
}

export async function markItemListed(itemId: string, platform = 'vinted'): Promise<Item> {
  const postedMarketplaces = mergePostedMarketplaces(await loadPostedMarketplaces(itemId), platform);
  const { data, error } = await supabase
    .from('items')
    .update({
      status: 'listed',
      listed_date: new Date().toISOString(),
      posted_marketplaces: postedMarketplaces,
    })
    .eq('id', itemId)
    .select('*, item_images(*)')
    .single();
  if (error) throw error;
  return normalizeItem(data);
}

export async function markItemSold(
  itemId: string,
  salePrice: number
): Promise<Item> {
  const { data, error } = await supabase
    .from('items')
    .update({
      status: 'sold',
      sale_price: salePrice,
      sold_date: new Date().toISOString(),
    })
    .eq('id', itemId)
    .select('*, item_images(*)')
    .single();
  if (error) throw error;
  return normalizeItem(data);
}

export async function updatePlatformPrices(
  itemId: string,
  prices: Record<string, number | null>
): Promise<void> {
  const cleaned: Record<string, number> = {};
  for (const [k, v] of Object.entries(prices)) {
    if (v != null && !isNaN(v)) cleaned[k] = v;
  }
  const { error } = await supabase
    .from('items')
    .update({ platform_prices: cleaned })
    .eq('id', itemId);
  if (error) throw error;
}
