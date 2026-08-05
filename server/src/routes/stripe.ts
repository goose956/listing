import { Router, type Request, type Response } from 'express';
import { getStripe, isStripeConfigured, FREE_AI_CREDITS } from '../lib/stripe.js';
import { getSupabaseAdmin, isSupabaseAdminConfigured } from '../lib/supabaseAdmin.js';

export const stripeRouter = Router();

async function resolveUserId(authHeader?: string): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length);
  if (!token || !isSupabaseAdminConfigured()) return null;
  try {
    const { data: { user }, error } = await getSupabaseAdmin().auth.getUser(token);
    if (error || !user) return null;
    return user.id;
  } catch { return null; }
}

async function getProfile(userId: string) {
  const { data } = await getSupabaseAdmin()
    .from('profiles')
    .select('id, email, stripe_customer_id, stripe_subscription_id, subscription_status, subscription_period_end, ai_credits_used')
    .eq('id', userId)
    .single();
  return data as {
    id: string;
    email: string | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    subscription_status: string;
    subscription_period_end: string | null;
    ai_credits_used: number;
  } | null;
}

// GET /api/stripe/status
stripeRouter.get('/status', async (req, res) => {
  const userId = await resolveUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const profile = await getProfile(userId);
  const status = profile?.subscription_status ?? 'free';
  const isPro = status === 'active' || status === 'trialing';

  return res.json({
    status,
    isPro,
    creditsUsed: profile?.ai_credits_used ?? 0,
    creditsLimit: isPro ? null : FREE_AI_CREDITS,
    periodEnd: profile?.subscription_period_end ?? null,
    stripeConfigured: isStripeConfigured(),
  });
});

// POST /api/stripe/checkout — creates a Stripe Checkout Session and returns its URL
stripeRouter.post('/checkout', async (req, res) => {
  const userId = await resolveUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!isStripeConfigured()) return res.status(503).json({ error: 'Billing not configured' });

  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) return res.status(503).json({ error: 'STRIPE_PRICE_ID not set' });

  try {
    const profile = await getProfile(userId);
    const appUrl = (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');
    const stripe = getStripe();

    let customerId = profile?.stripe_customer_id ?? undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile?.email ?? undefined,
        metadata: { supabase_user_id: userId },
      });
      customerId = customer.id;
      await getSupabaseAdmin()
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', userId);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/billing?success=1`,
      cancel_url: `${appUrl}/billing?cancelled=1`,
      allow_promotion_codes: true,
    });

    return res.json({ url: session.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Checkout failed';
    console.error('Stripe checkout error:', msg);
    return res.status(500).json({ error: msg });
  }
});

// POST /api/stripe/portal — creates a Stripe Billing Portal session and returns its URL
stripeRouter.post('/portal', async (req, res) => {
  const userId = await resolveUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!isStripeConfigured()) return res.status(503).json({ error: 'Billing not configured' });

  const profile = await getProfile(userId);
  if (!profile?.stripe_customer_id) {
    return res.status(400).json({ error: 'No active subscription found' });
  }

  try {
    const appUrl = (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');
    const session = await getStripe().billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${appUrl}/billing`,
    });
    return res.json({ url: session.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Portal failed';
    return res.status(500).json({ error: msg });
  }
});

// POST /api/stripe/webhook — must be mounted with express.raw() before express.json()
export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    res.status(503).json({ error: 'Webhook secret not configured' });
    return;
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body as Buffer, sig as string, secret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Webhook signature invalid';
    console.error('Stripe webhook signature error:', msg);
    res.status(400).json({ error: msg });
    return;
  }

  try {
    await handleWebhookEvent(event);
    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook handler error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

async function handleWebhookEvent(event: { type: string; data: { object: any } }) {
  const obj = event.data.object;
  const db = getSupabaseAdmin();

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const userId = await userIdFromCustomer(obj.customer as string);
      if (!userId) break;
      await db.from('profiles').update({
        stripe_subscription_id: obj.id,
        subscription_status: obj.status,
        subscription_period_end: new Date((obj.current_period_end as number) * 1000).toISOString(),
      }).eq('id', userId);
      break;
    }

    case 'customer.subscription.deleted': {
      const userId = await userIdFromCustomer(obj.customer as string);
      if (!userId) break;
      await db.from('profiles').update({
        subscription_status: 'cancelled',
        stripe_subscription_id: null,
        subscription_period_end: null,
      }).eq('id', userId);
      break;
    }

    case 'invoice.payment_failed': {
      const userId = await userIdFromCustomer(obj.customer as string);
      if (!userId) break;
      await db.from('profiles').update({ subscription_status: 'past_due' }).eq('id', userId);
      break;
    }
  }
}

async function userIdFromCustomer(customerId: string): Promise<string | null> {
  const { data } = await getSupabaseAdmin()
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  return data?.id ?? null;
}
