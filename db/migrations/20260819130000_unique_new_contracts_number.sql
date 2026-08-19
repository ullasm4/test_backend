-- migrate:up transaction:false

-- Legacy contracts + bulk seeding created multiple new_contracts rows per contract_number.
-- Keep the canonical row (aligned with contracts.id when present), then create uniqueness.
ALTER TABLE new_contracts DISABLE TRIGGER trigger_update_new_party_counts;

WITH canon AS (
  SELECT DISTINCT ON (BTRIM(contract_number))
    BTRIM(contract_number) AS cn,
    id AS contract_id
  FROM contracts
  WHERE contract_number IS NOT NULL AND BTRIM(contract_number) <> ''
  ORDER BY BTRIM(contract_number), id ASC
),
ranked AS (
  SELECT nc.id,
         ROW_NUMBER() OVER (
           PARTITION BY BTRIM(nc.contract_number)
           ORDER BY
             (canon.contract_id IS NOT NULL AND nc.id = canon.contract_id) DESC,
             (nc.contract_pdf_url IS NOT NULL AND BTRIM(nc.contract_pdf_url) <> '') DESC,
             (nc.order_id IS NOT NULL AND BTRIM(nc.order_id) <> '') DESC,
             nc.created_at DESC NULLS LAST,
             nc.id DESC
         ) AS rn
  FROM new_contracts nc
  LEFT JOIN canon ON canon.cn = BTRIM(nc.contract_number)
  WHERE nc.contract_number IS NOT NULL AND BTRIM(nc.contract_number) <> ''
)
DELETE FROM new_contracts nc
USING ranked r
WHERE nc.id = r.id
  AND r.rn > 1;

ALTER TABLE new_contracts ENABLE TRIGGER trigger_update_new_party_counts;

SELECT refresh_new_table_counts();

CREATE UNIQUE INDEX IF NOT EXISTS uk_new_contracts_contract_number
  ON new_contracts (contract_number)
  WHERE contract_number IS NOT NULL AND BTRIM(contract_number) <> '';

-- migrate:down transaction:false

DROP INDEX IF EXISTS uk_new_contracts_contract_number;
