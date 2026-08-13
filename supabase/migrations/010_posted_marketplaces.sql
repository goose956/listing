-- Track which marketplaces an item is currently posted to.

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS posted_marketplaces TEXT[] NOT NULL DEFAULT '{}';

WITH queue_marketplaces AS (
  SELECT
    item_id,
    array_agg(DISTINCT lower(platform)) FILTER (WHERE platform IS NOT NULL AND platform <> '') AS platforms
  FROM listing_queue
  WHERE status = 'completed'
  GROUP BY item_id
),
merged_marketplaces AS (
  SELECT
    i.id,
    array_remove(
      ARRAY(
        SELECT DISTINCT platform_name
        FROM unnest(
          coalesce(q.platforms, ARRAY[]::TEXT[])
          || CASE
            WHEN i.ebay_listing_id IS NOT NULL OR i.ebay_offer_id IS NOT NULL OR i.ebay_marketplace IS NOT NULL
              THEN ARRAY['ebay']::TEXT[]
            ELSE ARRAY[]::TEXT[]
          END
        ) AS platform_name
      ),
      NULL
    ) AS platforms
  FROM items i
  LEFT JOIN queue_marketplaces q ON q.item_id = i.id
)
UPDATE items i
SET posted_marketplaces = m.platforms
FROM merged_marketplaces m
WHERE i.id = m.id
  AND coalesce(array_length(m.platforms, 1), 0) > 0;

CREATE INDEX IF NOT EXISTS idx_items_posted_marketplaces ON items USING GIN (posted_marketplaces);
