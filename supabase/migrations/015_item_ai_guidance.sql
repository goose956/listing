-- ============================================================
-- ITEM AI GUIDANCE
-- Stores seller-written guidance used to steer AI listing generation.
-- ============================================================

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS ai_guidance TEXT;