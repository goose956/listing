-- Vinted Resale Inventory Assistant - Initial Schema
-- Run this in your Supabase SQL Editor

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- PROFILES (extends Supabase auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- ITEM ID SEQUENCE
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS item_id_seq START 1;

-- ============================================================
-- ITEMS
-- ============================================================
CREATE TYPE item_status AS ENUM (
  'new',
  'ready_for_listing',
  'listed',
  'sold',
  'archived'
);

CREATE TYPE item_condition AS ENUM (
  'new_with_tags',
  'new_without_tags',
  'very_good',
  'good',
  'satisfactory',
  'fair'
);

CREATE TABLE IF NOT EXISTS items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_number TEXT NOT NULL UNIQUE, -- e.g. V-000001
  status item_status NOT NULL DEFAULT 'new',
  
  -- Product details
  category TEXT,
  brand TEXT,
  product_type TEXT,
  size TEXT,
  colour TEXT,
  condition item_condition,
  
  -- Pricing
  purchase_price DECIMAL(10, 2) DEFAULT 0,
  suggested_price DECIMAL(10, 2),
  list_price DECIMAL(10, 2),
  sale_price DECIMAL(10, 2),
  accept_offers_above DECIMAL(10, 2),
  
  -- Storage
  storage_container TEXT,
  storage_shelf TEXT,
  storage_box TEXT,
  storage_notes TEXT,
  
  -- Listing content
  title TEXT,
  description TEXT,
  tags TEXT[], -- search tags
  
  -- AI analysis raw data
  ai_analysis JSONB,
  
  -- Sales
  sold_date TIMESTAMPTZ,
  listed_date TIMESTAMPTZ,
  marketplace TEXT DEFAULT 'vinted',
  
  -- Notes
  notes TEXT,
  measurements TEXT,
  
  -- Timestamps
  date_added TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_items_user_id ON items(user_id);
CREATE INDEX idx_items_status ON items(status);
CREATE INDEX idx_items_item_number ON items(item_number);
CREATE INDEX idx_items_brand ON items(brand);
CREATE INDEX idx_items_category ON items(category);
CREATE INDEX idx_items_storage_container ON items(storage_container);
CREATE INDEX idx_items_date_added ON items(date_added DESC);

-- Full text search
CREATE INDEX idx_items_search ON items USING gin(
  to_tsvector('english',
    coalesce(item_number, '') || ' ' ||
    coalesce(brand, '') || ' ' ||
    coalesce(product_type, '') || ' ' ||
    coalesce(category, '') || ' ' ||
    coalesce(colour, '') || ' ' ||
    coalesce(title, '') || ' ' ||
    coalesce(storage_container, '') || ' ' ||
    coalesce(storage_box, '') || ' ' ||
    coalesce(notes, '')
  )
);

-- ============================================================
-- ITEM IMAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS item_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT FALSE,
  sort_order INT DEFAULT 0,
  is_enhanced BOOLEAN DEFAULT FALSE,
  original_path TEXT, -- path to original before enhancement
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_item_images_item_id ON item_images(item_id);

-- ============================================================
-- LISTING QUEUE
-- ============================================================
CREATE TYPE queue_status AS ENUM (
  'scheduled',
  'due',
  'completed',
  'skipped',
  'cancelled'
);

CREATE TABLE IF NOT EXISTS listing_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status queue_status NOT NULL DEFAULT 'scheduled',
  completed_at TIMESTAMPTZ,
  notes TEXT,
  reminder_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(item_id) -- one queue entry per item
);

CREATE INDEX idx_listing_queue_user_id ON listing_queue(user_id);
CREATE INDEX idx_listing_queue_scheduled_at ON listing_queue(scheduled_at);
CREATE INDEX idx_listing_queue_status ON listing_queue(status);

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Generate next item number: V-000001
CREATE OR REPLACE FUNCTION generate_item_number()
RETURNS TEXT AS $$
DECLARE
  next_val INT;
BEGIN
  next_val := nextval('item_id_seq');
  RETURN 'V-' || lpad(next_val::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- Auto-set item_number on insert
CREATE OR REPLACE FUNCTION set_item_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.item_number IS NULL OR NEW.item_number = '' THEN
    NEW.item_number := generate_item_number();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_item_number
  BEFORE INSERT ON items
  FOR EACH ROW
  EXECUTE FUNCTION set_item_number();

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_items_updated_at
  BEFORE UPDATE ON items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_listing_queue_updated_at
  BEFORE UPDATE ON listing_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- Calculate profit (computed via view)
CREATE OR REPLACE VIEW items_with_profit AS
SELECT
  i.*,
  CASE
    WHEN i.sale_price IS NOT NULL AND i.purchase_price IS NOT NULL
    THEN i.sale_price - i.purchase_price
    ELSE NULL
  END AS profit,
  (
    SELECT public_url FROM item_images
    WHERE item_id = i.id AND is_primary = TRUE
    LIMIT 1
  ) AS primary_image_url,
  (
    SELECT COUNT(*) FROM item_images WHERE item_id = i.id
  ) AS image_count
FROM items i;

-- Dashboard stats function
CREATE OR REPLACE FUNCTION get_dashboard_stats(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'total_items', COUNT(*) FILTER (WHERE status != 'archived'),
    'new_items', COUNT(*) FILTER (WHERE status = 'new'),
    'ready_for_listing', COUNT(*) FILTER (WHERE status = 'ready_for_listing'),
    'listed', COUNT(*) FILTER (WHERE status = 'listed'),
    'sold', COUNT(*) FILTER (WHERE status = 'sold'),
    'archived', COUNT(*) FILTER (WHERE status = 'archived'),
    'total_profit', COALESCE(SUM(sale_price - purchase_price) FILTER (WHERE status = 'sold' AND sale_price IS NOT NULL), 0),
    'total_purchase_cost', COALESCE(SUM(purchase_price) FILTER (WHERE status != 'archived'), 0),
    'total_inventory_value', COALESCE(SUM(COALESCE(list_price, suggested_price, 0)) FILTER (WHERE status IN ('new', 'ready_for_listing', 'listed')), 0),
    'average_sale_price', COALESCE(AVG(sale_price) FILTER (WHERE status = 'sold' AND sale_price IS NOT NULL), 0),
    'average_profit', COALESCE(AVG(sale_price - purchase_price) FILTER (WHERE status = 'sold' AND sale_price IS NOT NULL), 0),
    'queue_pending', (
      SELECT COUNT(*) FROM listing_queue
      WHERE user_id = p_user_id AND status IN ('scheduled', 'due')
    )
  ) INTO result
  FROM items
  WHERE user_id = p_user_id;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_queue ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

-- Items policies
CREATE POLICY "Users can view own items"
  ON items FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own items"
  ON items FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own items"
  ON items FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own items"
  ON items FOR DELETE USING (auth.uid() = user_id);

-- Item images policies
CREATE POLICY "Users can view own images"
  ON item_images FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own images"
  ON item_images FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own images"
  ON item_images FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own images"
  ON item_images FOR DELETE USING (auth.uid() = user_id);

-- Listing queue policies
CREATE POLICY "Users can view own queue"
  ON listing_queue FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own queue"
  ON listing_queue FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own queue"
  ON listing_queue FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own queue"
  ON listing_queue FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- STORAGE BUCKET (run in Supabase dashboard or via API)
-- ============================================================
-- Create a public bucket named 'item-images'
-- Policies:
-- INSERT: authenticated users can upload to their own folder
-- SELECT: public read
-- DELETE: authenticated users can delete their own files

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'item-images',
  'item-images',
  true,
  10485760, -- 10MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'item-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Anyone can view images"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'item-images');

CREATE POLICY "Users can update own images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'item-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete own images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'item-images' AND (storage.foldername(name))[1] = auth.uid()::text);
