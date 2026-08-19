-- migrate:up

CREATE OR REPLACE FUNCTION refresh_new_table_counts()
RETURNS void AS $$
BEGIN
  UPDATE new_seller_details
  SET total_contracts = 0, total_value = 0;

  UPDATE new_seller_details nsd
  SET total_contracts = sub.cnt,
      total_value = sub.val
  FROM (
    SELECT seller_id,
           COUNT(*)::bigint AS cnt,
           COALESCE(SUM(total_value), 0) AS val
    FROM new_contracts
    GROUP BY seller_id
  ) sub
  WHERE nsd.id = sub.seller_id;

  UPDATE new_buyer_details
  SET total_contracts = 0, total_value = 0;

  UPDATE new_buyer_details nbd
  SET total_contracts = sub.cnt,
      total_value = sub.val
  FROM (
    SELECT buyer_id,
           COUNT(*)::bigint AS cnt,
           COALESCE(SUM(total_value), 0) AS val
    FROM new_contracts
    GROUP BY buyer_id
  ) sub
  WHERE nbd.id = sub.buyer_id;
END;
$$ LANGUAGE plpgsql;

SELECT refresh_new_table_counts();

-- migrate:down

DROP FUNCTION IF EXISTS refresh_new_table_counts();
