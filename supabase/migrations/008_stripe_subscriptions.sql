-- Stripe subscription fields on profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id       TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id   TEXT,
  -- free | active | cancelled | past_due | trialing
  ADD COLUMN IF NOT EXISTS subscription_status      TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_period_end  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_credits_used          INTEGER NOT NULL DEFAULT 0;

-- Atomic increment used by the server after a successful AI call
CREATE OR REPLACE FUNCTION increment_ai_credits(user_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE profiles SET ai_credits_used = ai_credits_used + 1 WHERE id = user_id;
$$;
