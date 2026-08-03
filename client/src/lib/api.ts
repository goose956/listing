import { supabase } from './supabase';

// In dev, Vite proxies /api to the local Express server (see vite.config.ts).
// In production set VITE_API_URL to the hosted API (or serve from the same origin).
const API_BASE = import.meta.env.VITE_API_URL || '';

/** Attach the user's Supabase session token so the server can identify them. */
async function authedHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function analyseImages(
  imageUrls: string[],
  purchasePrice?: number
): Promise<{ analysis: import('../types').AiAnalysis; model: string }> {
  const res = await fetch(`${API_BASE}/api/ai/analyse`, {
    method: 'POST',
    headers: await authedHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ imageUrls, purchasePrice }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `AI analysis failed (${res.status})`);
  }
  return res.json();
}

export async function generateListing(
  item: Record<string, unknown>
): Promise<{ listing: import('../types').AiListing; model: string }> {
  const res = await fetch(`${API_BASE}/api/ai/listing`, {
    method: 'POST',
    headers: await authedHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(item),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Listing generation failed (${res.status})`);
  }
  return res.json();
}

export async function enhanceImage(file: File | Blob): Promise<Blob> {
  const form = new FormData();
  form.append('image', file);
  const res = await fetch(`${API_BASE}/api/images/enhance`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Image enhance failed (${res.status})`);
  }
  return res.blob();
}

export async function checkApiHealth(): Promise<{
  status: string;
  aiConfigured: boolean;
}> {
  const res = await fetch(`${API_BASE}/api/health`);
  if (!res.ok) throw new Error('API unreachable');
  return res.json();
}