-- ============================================================
-- SOLD EMAIL FORWARDING + INBOX EVENTS
-- Gives each user a unique forwarding token and stores inbound
-- sold-notification emails for review and automation.
-- ============================================================

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS sold_forwarding_token TEXT;

UPDATE user_settings
SET sold_forwarding_token = substring(replace(uuid_generate_v4()::text, '-', '') from 1 for 20)
WHERE sold_forwarding_token IS NULL OR sold_forwarding_token = '';

ALTER TABLE user_settings
  ALTER COLUMN sold_forwarding_token SET DEFAULT substring(replace(uuid_generate_v4()::text, '-', '') from 1 for 20);

CREATE TABLE IF NOT EXISTS sale_inbox_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id TEXT,
  source_platform TEXT,
  from_address TEXT,
  to_address TEXT NOT NULL,
  subject TEXT,
  body_excerpt TEXT,
  detected_item_number TEXT,
  detected_listing_title TEXT,
  detected_sale_price NUMERIC(10,2),
  detected_currency TEXT,
  buyer_name TEXT,
  buyer_address_lines TEXT[],
  buyer_postcode TEXT,
  buyer_country TEXT,
  matched_item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  auto_marked_sold BOOLEAN NOT NULL DEFAULT FALSE,
  processing_status TEXT NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'matched', 'auto_marked_sold', 'manually_marked_sold', 'needs_review', 'ignored', 'error')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sale_inbox_events
  ADD COLUMN IF NOT EXISTS buyer_name TEXT,
  ADD COLUMN IF NOT EXISTS buyer_address_lines TEXT[],
  ADD COLUMN IF NOT EXISTS buyer_postcode TEXT,
  ADD COLUMN IF NOT EXISTS buyer_country TEXT;

ALTER TABLE sale_inbox_events
  DROP CONSTRAINT IF EXISTS sale_inbox_events_processing_status_check;

ALTER TABLE sale_inbox_events
  ADD CONSTRAINT sale_inbox_events_processing_status_check
  CHECK (processing_status IN ('received', 'matched', 'auto_marked_sold', 'manually_marked_sold', 'needs_review', 'ignored', 'error'));

DROP TRIGGER IF EXISTS trg_sale_inbox_events_updated_at ON sale_inbox_events;

CREATE TRIGGER trg_sale_inbox_events_updated_at
  BEFORE UPDATE ON sale_inbox_events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS idx_sale_inbox_events_user_received_at
  ON sale_inbox_events (user_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_sale_inbox_events_status
  ON sale_inbox_events (user_id, processing_status);

ALTER TABLE sale_inbox_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own sale inbox events" ON sale_inbox_events;

CREATE POLICY "Users can view own sale inbox events"
  ON sale_inbox_events FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own sale inbox events" ON sale_inbox_events;

CREATE POLICY "Users can update own sale inbox events"
  ON sale_inbox_events FOR UPDATE
  USING (auth.uid() = user_id);