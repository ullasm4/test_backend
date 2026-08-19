-- migrate:up

CREATE UNIQUE INDEX IF NOT EXISTS uk_new_contracts_contract_number
  ON new_contracts (contract_number)
  WHERE contract_number IS NOT NULL AND BTRIM(contract_number) <> '';

-- migrate:down

DROP INDEX IF EXISTS uk_new_contracts_contract_number;
