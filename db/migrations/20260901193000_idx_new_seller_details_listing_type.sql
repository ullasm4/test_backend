-- migrate:up

CREATE INDEX IF NOT EXISTS idx_new_seller_details_type
  ON public.new_seller_details (type);

CREATE INDEX IF NOT EXISTS idx_new_seller_details_type_contracts_value
  ON public.new_seller_details (
    type,
    total_contracts DESC NULLS LAST,
    total_value DESC NULLS LAST,
    company_name
  );

CREATE INDEX IF NOT EXISTS idx_new_seller_details_type_total_value
  ON public.new_seller_details (
    type,
    total_value DESC NULLS LAST,
    company_name
  );

-- migrate:down

DROP INDEX IF EXISTS idx_new_seller_details_type_total_value;
DROP INDEX IF EXISTS idx_new_seller_details_type_contracts_value;
DROP INDEX IF EXISTS idx_new_seller_details_type;
