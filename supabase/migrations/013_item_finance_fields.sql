-- ============================================================
-- ITEM FINANCE FIELDS
-- Adds basic accounting fields so gross and net profit can be
-- tracked per item and exported in reports.
-- ============================================================

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS platform_fee DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS shipping_cost DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS packaging_cost DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS other_costs DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS payout_received_at TIMESTAMPTZ;
