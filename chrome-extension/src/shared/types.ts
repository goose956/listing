export interface QueueItem {
  queue_id: string;
  scheduled_at: string;
  item_id: string;
  item_number: string;
  platform: string;
  title: string | null;
  description: string | null;
  price: number | null;
  platform_prices: Record<string, number>;
  brand: string | null;
  size: string | null;
  colour: string | null;
  condition: string | null;
  category: string | null;
  tags: string[] | null;
  images: Array<{ url: string; is_primary: boolean }>;
}

export interface AuthState {
  jwt: string;
  refreshToken: string;
  email: string;
  expiresAt: number; // unix ms
}
