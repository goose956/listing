import { supabase } from './supabase';

const API_BASE = import.meta.env.VITE_API_URL || '';

async function adminFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Admin request failed (${res.status})`);
  }
  return res.json();
}

export interface AdminStats {
  totalUsers: number;
  totalItems: number;
  listedItems: number;
  soldItems: number;
  activeQueueEntries: number;
}

export interface AdminUser {
  id: string;
  email: string;
  createdAt: string;
  lastSignIn: string | null;
  itemCount: number;
  aiCalls: number;
}

export interface ConfigKey {
  key: string;
  label: string;
  configured: boolean;
}

export async function fetchAdminCheck(): Promise<boolean> {
  try {
    const data = await adminFetch<{ isAdmin: boolean }>('/api/admin/me');
    return data.isAdmin;
  } catch {
    return false;
  }
}

export async function fetchAdminStats(): Promise<AdminStats> {
  return adminFetch<AdminStats>('/api/admin/stats');
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const data = await adminFetch<{ users: AdminUser[] }>('/api/admin/users');
  return data.users;
}

export async function deleteAdminUser(userId: string): Promise<void> {
  await adminFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
}

export async function fetchAdminConfig(): Promise<ConfigKey[]> {
  const data = await adminFetch<{ keys: ConfigKey[] }>('/api/admin/config');
  return data.keys;
}

export interface ErrorLog {
  id: string;
  user_id: string | null;
  error_type: string;
  message: string;
  detail: unknown;
  resolved: boolean;
  created_at: string;
}

export async function fetchAdminErrors(showResolved = false): Promise<ErrorLog[]> {
  const data = await adminFetch<{ errors: ErrorLog[] }>(`/api/admin/errors?resolved=${showResolved}`);
  return data.errors;
}

export async function resolveAdminError(id: string): Promise<void> {
  await adminFetch(`/api/admin/errors/${id}/resolve`, { method: 'PATCH' });
}
