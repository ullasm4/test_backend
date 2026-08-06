-- migrate:up

CREATE TABLE IF NOT EXISTS seller_total_value (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id VARCHAR(255) NOT NULL,
  total_value NUMERIC(18,2) DEFAULT 0.00,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT seller_total_value_seller_id_key UNIQUE (seller_id)
);

CREATE INDEX IF NOT EXISTS idx_seller_total_value_seller_id ON seller_total_value (seller_id);
CREATE INDEX IF NOT EXISTS idx_seller_total_value_total_value ON seller_total_value (total_value DESC);

CREATE TABLE IF NOT EXISTS seller_category (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id VARCHAR(255) NOT NULL,
  category TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT seller_category_seller_id_category_key UNIQUE (seller_id, category)
);

CREATE INDEX IF NOT EXISTS idx_seller_category_seller_id ON seller_category (seller_id);
CREATE INDEX IF NOT EXISTS idx_seller_category_category ON seller_category (category);

-- Trigger function to update seller_total_value and seller_category on contracts insert/update/delete
CREATE OR REPLACE FUNCTION sync_seller_analysis()
RETURNS TRIGGER AS $$
DECLARE
  v_seller_id VARCHAR(255);
  v_old_seller_id VARCHAR(255);
BEGIN
  IF (TG_OP = 'UPDATE' OR TG_OP = 'DELETE') THEN
    v_old_seller_id := OLD.seller_id;
  END IF;

  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    v_seller_id := NEW.seller_id;
  END IF;

  -- Process NEW.seller_id
  IF v_seller_id IS NOT NULL AND TRIM(v_seller_id) <> '' THEN
    -- Update or Insert into seller_total_value
    INSERT INTO seller_total_value (seller_id, total_value, updated_at)
    VALUES (
      v_seller_id,
      (SELECT COALESCE(SUM(total_value), 0) FROM contracts WHERE seller_id = v_seller_id),
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (seller_id) DO UPDATE
      SET total_value = EXCLUDED.total_value,
          updated_at = CURRENT_TIMESTAMP;

    -- Extract categories from contracts products JSONB for this seller_id and insert into seller_category
    INSERT INTO seller_category (seller_id, category, updated_at)
    SELECT DISTINCT
      v_seller_id,
      clean_cat,
      CURRENT_TIMESTAMP
    FROM (
      SELECT TRIM(REGEXP_REPLACE(elem->>'category', '^Category Name\s*(&\s*Quadrant)?\s*:\s*', '', 'i')) AS clean_cat
      FROM contracts c,
           jsonb_array_elements(c.products) AS elem
      WHERE c.seller_id = v_seller_id
        AND jsonb_typeof(c.products) = 'array'
        AND elem->>'category' IS NOT NULL
        AND TRIM(elem->>'category') <> ''
    ) sub
    WHERE clean_cat <> ''
      AND LOWER(clean_cat) NOT IN ('category name & quadrant', 'category name', 'category')
    ON CONFLICT (seller_id, category) DO NOTHING;
  END IF;

  -- Process OLD.seller_id if changed on UPDATE or DELETE
  IF v_old_seller_id IS NOT NULL AND TRIM(v_old_seller_id) <> '' AND (v_seller_id IS NULL OR v_seller_id <> v_old_seller_id) THEN
    INSERT INTO seller_total_value (seller_id, total_value, updated_at)
    VALUES (
      v_old_seller_id,
      (SELECT COALESCE(SUM(total_value), 0) FROM contracts WHERE seller_id = v_old_seller_id),
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (seller_id) DO UPDATE
      SET total_value = EXCLUDED.total_value,
          updated_at = CURRENT_TIMESTAMP;
  END IF;

  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_seller_analysis ON contracts;
CREATE TRIGGER trigger_sync_seller_analysis
  AFTER INSERT OR UPDATE OF seller_id, total_value, products OR DELETE ON contracts
  FOR EACH ROW
  EXECUTE FUNCTION sync_seller_analysis();

-- Backfill seller_total_value for existing contracts
INSERT INTO seller_total_value (seller_id, total_value)
SELECT
  seller_id,
  COALESCE(SUM(total_value), 0) AS total_value
FROM contracts
WHERE seller_id IS NOT NULL AND TRIM(seller_id) <> ''
GROUP BY seller_id
ON CONFLICT (seller_id) DO UPDATE
  SET total_value = EXCLUDED.total_value,
      updated_at = CURRENT_TIMESTAMP;

-- Backfill seller_category for existing contracts
INSERT INTO seller_category (seller_id, category)
SELECT DISTINCT
  c.seller_id,
  sub.clean_cat
FROM contracts c,
     LATERAL (
       SELECT TRIM(REGEXP_REPLACE(elem->>'category', '^Category Name\s*(&\s*Quadrant)?\s*:\s*', '', 'i')) AS clean_cat
       FROM jsonb_array_elements(c.products) AS elem
       WHERE jsonb_typeof(c.products) = 'array'
         AND elem->>'category' IS NOT NULL
         AND TRIM(elem->>'category') <> ''
     ) sub
WHERE c.seller_id IS NOT NULL AND TRIM(c.seller_id) <> ''
  AND sub.clean_cat <> ''
  AND LOWER(sub.clean_cat) NOT IN ('category name & quadrant', 'category name', 'category')
ON CONFLICT (seller_id, category) DO NOTHING;

-- migrate:down

DROP TRIGGER IF EXISTS trigger_sync_seller_analysis ON contracts;
DROP FUNCTION IF EXISTS sync_seller_analysis();

DROP TABLE IF EXISTS seller_category;
DROP TABLE IF EXISTS seller_total_value;