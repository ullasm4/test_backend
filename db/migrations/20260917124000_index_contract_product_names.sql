-- migrate:up

CREATE OR REPLACE FUNCTION public.contract_product_names(p jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p IS NULL THEN ''
    WHEN jsonb_typeof(p) = 'array' THEN COALESCE((
      SELECT string_agg(elem->>'product_name', ' ')
      FROM jsonb_array_elements(p) AS elem
      WHERE COALESCE(elem->>'product_name', '') <> ''
    ), '')
    WHEN jsonb_typeof(p) = 'object' THEN COALESCE(p->>'product_name', '')
    ELSE ''
  END
$$;

CREATE INDEX IF NOT EXISTS idx_gin_new_contracts_product_names_trgm
ON public.new_contracts
USING gin (public.contract_product_names(products) public.gin_trgm_ops);

-- migrate:down

DROP INDEX IF EXISTS public.idx_gin_new_contracts_product_names_trgm;
DROP FUNCTION IF EXISTS public.contract_product_names(jsonb);
