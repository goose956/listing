import { supabase } from './supabase';
import type { Item, SaleInboxEvent } from '../types';

export interface SaleInboxEventView extends SaleInboxEvent {
  matched_item?: Pick<Item, 'id' | 'item_number' | 'title' | 'status' | 'sale_price' | 'sold_date'>;
}

export async function fetchSaleInboxEvents(): Promise<SaleInboxEventView[]> {
  const { data, error } = await supabase
    .from('sale_inbox_events')
    .select('*')
    .order('received_at', { ascending: false })
    .limit(100);

  if (error) throw error;

  const events = (data ?? []) as SaleInboxEvent[];
  const matchedIds = Array.from(new Set(events.map((event) => event.matched_item_id).filter(Boolean))) as string[];

  if (matchedIds.length === 0) {
    return events;
  }

  const { data: matchedItems, error: itemsError } = await supabase
    .from('items')
    .select('id, item_number, title, status, sale_price, sold_date')
    .in('id', matchedIds);

  if (itemsError) throw itemsError;

  const itemMap = new Map((matchedItems ?? []).map((item) => [item.id as string, item]));

  return events.map((event) => ({
    ...event,
    matched_item: event.matched_item_id
      ? itemMap.get(event.matched_item_id) as SaleInboxEventView['matched_item']
      : undefined,
  }));
}