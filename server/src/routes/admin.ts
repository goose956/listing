import { Router } from 'express';
import { requireAdmin, resolveUser, isAdminEmail } from '../lib/adminAuth.js';
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';

export const adminRouter = Router();

// ── Auth check (used by frontend to determine if current user is admin) ──────
adminRouter.get('/me', async (req, res) => {
  const user = await resolveUser(req.headers.authorization);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ isAdmin: isAdminEmail(user.email) });
});

// All routes below require admin
adminRouter.use(requireAdmin);

// ── Platform-wide stats ───────────────────────────────────────────────────────
adminRouter.get('/stats', async (_req, res) => {
  try {
    const db = getSupabaseAdmin();

    const [
      { count: totalUsers },
      { count: totalItems },
      { count: listedItems },
      { count: soldItems },
      { count: queueEntries },
    ] = await Promise.all([
      db.from('profiles').select('*', { count: 'exact', head: true }),
      db.from('items').select('*', { count: 'exact', head: true }),
      db.from('items').select('*', { count: 'exact', head: true }).eq('status', 'listed'),
      db.from('items').select('*', { count: 'exact', head: true }).eq('status', 'sold'),
      db.from('listing_queue').select('*', { count: 'exact', head: true }).in('status', ['scheduled', 'due']),
    ]);

    res.json({
      totalUsers: totalUsers ?? 0,
      totalItems: totalItems ?? 0,
      listedItems: listedItems ?? 0,
      soldItems: soldItems ?? 0,
      activeQueueEntries: queueEntries ?? 0,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── User list with per-user stats ────────────────────────────────────────────
adminRouter.get('/users', async (_req, res) => {
  try {
    const db = getSupabaseAdmin();

    // Fetch all auth users via Supabase admin API
    const { data: authData, error: authErr } = await db.auth.admin.listUsers({ perPage: 1000 });
    if (authErr) return res.status(500).json({ error: authErr.message });

    // Fetch item counts per user
    const { data: itemCounts } = await db
      .from('items')
      .select('user_id')
      .neq('status', 'archived');

    // Fetch AI usage proxy: items with ai_analysis filled
    const { data: aiCounts } = await db
      .from('items')
      .select('user_id')
      .not('ai_analysis', 'is', null);

    // Build lookup maps
    const itemsPerUser: Record<string, number> = {};
    for (const row of (itemCounts ?? [])) {
      itemsPerUser[row.user_id] = (itemsPerUser[row.user_id] ?? 0) + 1;
    }

    const aiCallsPerUser: Record<string, number> = {};
    for (const row of (aiCounts ?? [])) {
      aiCallsPerUser[row.user_id] = (aiCallsPerUser[row.user_id] ?? 0) + 1;
    }

    const users = authData.users.map(u => ({
      id: u.id,
      email: u.email,
      createdAt: u.created_at,
      lastSignIn: u.last_sign_in_at,
      itemCount: itemsPerUser[u.id] ?? 0,
      aiCalls: aiCallsPerUser[u.id] ?? 0,
    }));

    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Delete a user and all their data ─────────────────────────────────────────
adminRouter.delete('/users/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const { error } = await getSupabaseAdmin().auth.admin.deleteUser(userId);
    if (error) return res.status(500).json({ error: error.message });
    // Cascade deletes handle items/images/queue via FK ON DELETE CASCADE
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Config / API key status ───────────────────────────────────────────────────
// Shows which keys are configured WITHOUT exposing their values.
// Add new keys here as the app grows.
adminRouter.get('/config', (_req, res) => {
  const keys = [
    { key: 'OPENAI_API_KEY',        label: 'OpenAI',        configured: !!process.env.OPENAI_API_KEY },
    { key: 'SUPABASE_URL',          label: 'Supabase URL',  configured: !!process.env.SUPABASE_URL },
    { key: 'SUPABASE_SERVICE_ROLE_KEY', label: 'Supabase Service Key', configured: !!process.env.SUPABASE_SERVICE_ROLE_KEY },
    { key: 'RESEND_API_KEY',        label: 'Resend (email)', configured: !!process.env.RESEND_API_KEY },
    { key: 'ADMIN_EMAIL',           label: 'Admin email(s)', configured: !!process.env.ADMIN_EMAIL },
  ];
  res.json({ keys });
});

// ── Error log ─────────────────────────────────────────────────────────────────
adminRouter.get('/errors', async (req, res) => {
  try {
    const showResolved = req.query.resolved === 'true';
    let query = getSupabaseAdmin()
      .from('error_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (!showResolved) query = query.eq('resolved', false);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ errors: data ?? [] });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

adminRouter.patch('/errors/:id/resolve', async (req, res) => {
  try {
    const { error } = await getSupabaseAdmin()
      .from('error_logs')
      .update({ resolved: true })
      .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
