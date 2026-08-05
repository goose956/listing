-- Per-user item numbering
-- Replaces the global item_id_seq with a per-user counter on profiles.
-- Existing item numbers are preserved; the counter is backfilled from them.

-- 1. Add per-user counter column
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS item_number_seq INTEGER NOT NULL DEFAULT 0;

-- 2. Backfill: set each user's counter to their highest existing item number
UPDATE profiles p
SET item_number_seq = COALESCE((
  SELECT MAX(CAST(regexp_replace(i.item_number, '[^0-9]', '', 'g') AS INTEGER))
  FROM items i
  WHERE i.user_id = p.id
    AND i.item_number ~ '^V-[0-9]+$'
), 0);

-- 3. Replace trigger function to use per-user counter (atomic UPDATE...RETURNING)
CREATE OR REPLACE FUNCTION set_item_number()
RETURNS TRIGGER AS $$
DECLARE
  next_seq INTEGER;
BEGIN
  IF NEW.item_number IS NULL OR NEW.item_number = '' THEN
    UPDATE profiles
    SET item_number_seq = item_number_seq + 1
    WHERE id = NEW.user_id
    RETURNING item_number_seq INTO next_seq;

    NEW.item_number := 'V-' || lpad(next_seq::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
