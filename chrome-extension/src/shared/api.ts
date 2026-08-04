import type { QueueItem } from './types';

const API_URL = (import.meta.env.VITE_API_URL as string).replace(/\/$/, '');

async function request<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error ?? `HTTP ${res.status}`);
  return body as T;
}

export async function fetchQueue(token: string): Promise<QueueItem[]> {
  const data = await request<{ items: QueueItem[] }>('/api/extension/queue', token);
  return data.items;
}

export async function completeQueueItem(queueId: string, token: string): Promise<void> {
  await request(`/api/extension/queue/${queueId}/complete`, token, { method: 'POST' });
}
