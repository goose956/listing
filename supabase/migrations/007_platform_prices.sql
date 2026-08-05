-- Per-platform pricing: store separate prices per marketplace
-- and record which platform each queue entry is intended for.

-- items: JSONB column stores {"vinted": 20.00, "depop": 25.00, "ebay": 30.00}
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS platform_prices JSONB DEFAULT '{}' NOT NULL;

-- listing_queue: which marketplace this scheduled post is for
ALTER TABLE listing_queue
  ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'vinted' NOT NULL;
