export type ItemStatus = 'new' | 'ready_for_listing' | 'listed' | 'sold' | 'archived';

export type ItemCondition =
  | 'new_with_tags'
  | 'new_without_tags'
  | 'very_good'
  | 'good'
  | 'satisfactory'
  | 'fair';

export type QueueStatus = 'scheduled' | 'due' | 'completed' | 'skipped' | 'cancelled';

export interface ItemImage {
  id: string;
  item_id: string;
  user_id: string;
  storage_path: string;
  public_url: string;
  is_primary: boolean;
  sort_order: number;
  is_enhanced: boolean;
  original_path: string | null;
  created_at: string;
}

export interface Item {
  id: string;
  user_id: string;
  item_number: string;
  status: ItemStatus;
  category: string | null;
  brand: string | null;
  product_type: string | null;
  size: string | null;
  colour: string | null;
  condition: ItemCondition | null;
  purchase_price: number | null;
  suggested_price: number | null;
  list_price: number | null;
  sale_price: number | null;
  accept_offers_above: number | null;
  cost_is_gifted: boolean;
  platform_fee: number | null;
  shipping_cost: number | null;
  packaging_cost: number | null;
  other_costs: number | null;
  storage_container: string | null;
  storage_shelf: string | null;
  storage_box: string | null;
  storage_notes: string | null;
  title: string | null;
  description: string | null;
  tags: string[] | null;
  ai_analysis: Record<string, unknown> | null;
  ai_guidance: string | null;
  sold_date: string | null;
  listed_date: string | null;
  marketplace: string | null;
  notes: string | null;
  measurements: string | null;
  date_added: string;
  payout_received_at: string | null;
  created_at: string;
  updated_at: string;
  platform_prices: Record<string, number>;
  posted_marketplaces: string[];
  // eBay listing fields
  ebay_listing_id?: string | null;
  ebay_offer_id?: string | null;
  ebay_listing_url?: string | null;
  ebay_marketplace?: string | null;
  // from view / joins
  profit?: number | null;
  gross_profit?: number | null;
  total_costs?: number | null;
  net_profit?: number | null;
  primary_image_url?: string | null;
  image_count?: number;
  item_images?: ItemImage[];
}

export interface ListingQueueEntry {
  id: string;
  user_id: string;
  item_id: string;
  scheduled_at: string;
  platform: string;
  status: QueueStatus;
  completed_at: string | null;
  notes: string | null;
  reminder_sent: boolean;
  created_at: string;
  updated_at: string;
  items?: Item;
}

export interface DashboardStats {
  total_items: number;
  new_items: number;
  ready_for_listing: number;
  listed: number;
  sold: number;
  archived: number;
  total_profit: number;
  total_net_profit?: number;
  total_purchase_cost: number;
  total_inventory_value: number;
  average_sale_price: number;
  average_profit: number;
  average_net_profit?: number;
  queue_pending: number;
}

export interface SaleInboxEvent {
  id: string;
  user_id: string;
  message_id: string | null;
  source_platform: string | null;
  from_address: string | null;
  to_address: string;
  subject: string | null;
  body_excerpt: string | null;
  detected_item_number: string | null;
  detected_listing_title: string | null;
  detected_sale_price: number | null;
  detected_currency: string | null;
  buyer_name: string | null;
  buyer_address_lines: string[] | null;
  buyer_postcode: string | null;
  buyer_country: string | null;
  matched_item_id: string | null;
  auto_marked_sold: boolean;
  processing_status: 'received' | 'matched' | 'auto_marked_sold' | 'manually_marked_sold' | 'needs_review' | 'ignored' | 'error';
  received_at: string;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiAnalysis {
  brand?: string | null;
  product_type?: string | null;
  category?: string | null;
  colour?: string | null;
  size?: string | null;
  condition?: ItemCondition | null;
  condition_notes?: string | null;
  suggested_price?: number | null;
  accept_offers_above?: number | null;
  confidence?: number;
  tags?: string[];
  measurements_visible?: string | null;
  notes?: string | null;
}

export interface AiListing {
  title?: string;
  description?: string;
  list_price?: number;
  accept_offers_above?: number;
  tags?: string[];
  price_rationale?: string;
}

export type PriceCheckBasis = 'barcode_match' | 'visual_match' | 'brand_model_match' | 'category_estimate';

export interface PriceCheckResult {
  barcode?: string | null;
  product_name?: string | null;
  brand?: string | null;
  product_type?: string | null;
  category?: string | null;
  model_number?: string | null;
  colour?: string | null;
  size?: string | null;
  condition_summary?: string | null;
  pricing_basis?: PriceCheckBasis | null;
  estimated_retail_price?: number | null;
  estimated_resale_listing_low?: number | null;
  estimated_resale_listing_high?: number | null;
  estimated_sold_price_low?: number | null;
  estimated_sold_price_high?: number | null;
  recommended_max_buy_price?: number | null;
  confidence?: number | null;
  summary?: string | null;
  evidence?: string[] | null;
  search_keywords?: string[] | null;
  disclaimer?: string | null;
}

export interface ItemFormData {
  category: string;
  brand: string;
  product_type: string;
  size: string;
  colour: string;
  condition: ItemCondition | '';
  purchase_price: string;
  suggested_price: string;
  list_price: string;
  accept_offers_above: string;
  cost_is_gifted: boolean;
  platform_fee: string;
  shipping_cost: string;
  packaging_cost: string;
  other_costs: string;
  storage_container: string;
  storage_shelf: string;
  storage_box: string;
  storage_notes: string;
  title: string;
  description: string;
  tags: string;
  ai_guidance: string;
  notes: string;
  measurements: string;
  status: ItemStatus;
  sale_price: string;
  payout_received_at: string;
}

export const STATUS_LABELS: Record<ItemStatus, string> = {
  new: 'New',
  ready_for_listing: 'Ready to List',
  listed: 'Listed',
  sold: 'Sold',
  archived: 'Archived',
};

export const CONDITION_LABELS: Record<ItemCondition, string> = {
  new_with_tags: 'New with tags',
  new_without_tags: 'New without tags',
  very_good: 'Very good',
  good: 'Good',
  satisfactory: 'Satisfactory',
  fair: 'Fair',
};

export const CATEGORIES = [
  'Women',
  'Men',
  'Kids',
  'Home',
  'Electronics',
  'Entertainment',
  'Hobbies',
  'Other',
] as const;

export const EMPTY_ITEM_FORM: ItemFormData = {
  category: '',
  brand: '',
  product_type: '',
  size: '',
  colour: '',
  condition: '',
  purchase_price: '',
  suggested_price: '',
  list_price: '',
  accept_offers_above: '',
  cost_is_gifted: false,
  platform_fee: '',
  shipping_cost: '',
  packaging_cost: '',
  other_costs: '',
  storage_container: '',
  storage_shelf: '',
  storage_box: '',
  storage_notes: '',
  title: '',
  description: '',
  tags: '',
  ai_guidance: '',
  notes: '',
  measurements: '',
  status: 'new',
  sale_price: '',
  payout_received_at: '',
};
