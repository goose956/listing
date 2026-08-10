import { getSupabaseAdmin } from './supabaseAdmin.js';

export async function logError(opts: {
  userId?: string | null;
  type: string;
  message: string;
  detail?: unknown;
}): Promise<void> {
  try {
    await getSupabaseAdmin().from('error_logs').insert({
      user_id: opts.userId ?? null,
      error_type: opts.type,
      message: opts.message,
      detail: opts.detail ?? null,
    });
  } catch {
    // Never throw from error logging
  }
}
