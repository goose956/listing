import { supabase } from './supabase';
import type { AuthState } from './types';

const AUTH_KEY = 'la_auth';

export async function getAuth(): Promise<AuthState | null> {
  const result = await chrome.storage.local.get(AUTH_KEY);
  return (result[AUTH_KEY] as AuthState) ?? null;
}

export async function saveAuth(state: AuthState): Promise<void> {
  await chrome.storage.local.set({ [AUTH_KEY]: state });
}

export async function clearAuth(): Promise<void> {
  await chrome.storage.local.remove(AUTH_KEY);
}

export async function getValidToken(): Promise<string | null> {
  const auth = await getAuth();
  if (!auth) return null;

  // Still valid (60s buffer before expiry)
  if (Date.now() < auth.expiresAt - 60_000) return auth.jwt;

  // Attempt refresh
  try {
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: auth.refreshToken });
    if (error || !data.session) {
      await clearAuth();
      return null;
    }
    const refreshed: AuthState = {
      jwt: data.session.access_token,
      refreshToken: data.session.refresh_token,
      email: auth.email,
      expiresAt: data.session.expires_at! * 1000,
    };
    await saveAuth(refreshed);
    return refreshed.jwt;
  } catch {
    await clearAuth();
    return null;
  }
}
