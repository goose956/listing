import type { Request, Response, NextFunction } from 'express';
import { getSupabaseAdmin, isSupabaseAdminConfigured } from './supabaseAdmin.js';

/** Resolve the Supabase user from a Bearer JWT. */
export async function resolveUser(authHeader?: string) {
  if (!authHeader?.startsWith('Bearer ') || !isSupabaseAdminConfigured()) return null;
  const token = authHeader.slice('Bearer '.length);
  try {
    const { data: { user }, error } = await getSupabaseAdmin().auth.getUser(token);
    if (error || !user) return null;
    return user;
  } catch {
    return null;
  }
}

/** Returns true if the email belongs to an admin. */
export function isAdminEmail(email: string | undefined): boolean {
  if (!email || !process.env.ADMIN_EMAIL) return false;
  const adminEmails = process.env.ADMIN_EMAIL.split(',').map(e => e.trim().toLowerCase());
  return adminEmails.includes(email.toLowerCase());
}

/** Express middleware — rejects non-admin requests with 403. */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = await resolveUser(req.headers.authorization);
  if (!user || !isAdminEmail(user.email)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  (req as any).adminUser = user;
  next();
}
