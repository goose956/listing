import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? '';

async function authFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error ?? `HTTP ${res.status}`);
  return body as T;
}

export interface SubscriptionStatus {
  status: 'free' | 'active' | 'trialing' | 'cancelled' | 'past_due';
  isPro: boolean;
  creditsUsed: number;
  creditsLimit: number | null;
  itemCount: number;
  itemLimit: number | null;
  periodEnd: string | null;
  stripeConfigured: boolean;
}

export function fetchSubscriptionStatus(): Promise<SubscriptionStatus> {
  return authFetch<SubscriptionStatus>('/api/stripe/status');
}

export async function startCheckout(): Promise<void> {
  const { url } = await authFetch<{ url: string }>('/api/stripe/checkout', { method: 'POST' });
  window.location.href = url;
}

export async function openBillingPortal(): Promise<void> {
  const { url } = await authFetch<{ url: string }>('/api/stripe/portal', { method: 'POST' });
  window.location.href = url;
}
