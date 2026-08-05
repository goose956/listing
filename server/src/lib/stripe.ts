import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
  if (!_stripe) {
    _stripe = new Stripe(key, { apiVersion: '2026-07-29.dahlia' });
  }
  return _stripe;
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export const FREE_AI_CREDITS = 5;
export const FREE_ITEM_LIMIT = 10;
