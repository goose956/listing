-- ============================================================
-- ITEM COST BASIS FLAG
-- Distinguishes gifted or free stock from genuinely missing
-- purchase cost data in finance reporting.
-- ============================================================

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS cost_is_gifted BOOLEAN NOT NULL DEFAULT FALSE;
