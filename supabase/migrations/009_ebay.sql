-- eBay integration: per-user OAuth token storage + listing tracking

-- Table for storing each user's eBay OAuth tokens and settings
CREATE TABLE IF NOT EXISTS user_ebay_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ebay_user_id TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMPTZ NOT NULL,
  ebay_marketplace TEXT NOT NULL DEFAULT 'EBAY_GB', -- EBAY_GB | EBAY_US
  fulfillment_policy_id TEXT,
  payment_policy_id TEXT,
  return_policy_id TEXT,
  merchant_location_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

ALTER TABLE user_ebay_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own eBay connection" ON user_ebay_connections
  FOR ALL USING (auth.uid() = user_id);

-- Track eBay listing IDs and offer IDs on items
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS ebay_listing_id TEXT,
  ADD COLUMN IF NOT EXISTS ebay_offer_id TEXT,
  ADD COLUMN IF NOT EXISTS ebay_listing_url TEXT,
  ADD COLUMN IF NOT EXISTS ebay_marketplace TEXT;

-- Index for quick lookup
CREATE INDEX IF NOT EXISTS idx_user_ebay_connections_user_id
  ON user_ebay_connections (user_id);
