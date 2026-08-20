-- migrate:up

UPDATE total_counts
SET
  new_contracts_with_bid_number = (
    SELECT COUNT(*)::bigint
    FROM new_contracts
    WHERE contract_bid_number_present(bid_number)
  ),
  updated_at = CURRENT_TIMESTAMP
WHERE id = 1;

-- migrate:down

UPDATE total_counts
SET new_contracts_with_bid_number = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1;
