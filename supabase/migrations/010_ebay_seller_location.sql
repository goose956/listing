ALTER TABLE user_ebay_connections
  ADD COLUMN IF NOT EXISTS seller_country TEXT;
