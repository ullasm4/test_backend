-- Migration to create category_summary table and optimization indexes

CREATE TABLE IF NOT EXISTS public.category_summary (
    category text NOT NULL PRIMARY KEY,
    seller_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_category_summary_seller_count ON public.category_summary USING btree (seller_count DESC);

CREATE INDEX IF NOT EXISTS idx_category_summary_trgm ON public.category_summary USING gin (category gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_seller_category_cat_seller ON public.seller_category USING btree (category, seller_id);

CREATE INDEX IF NOT EXISTS idx_seller_category_seller_cat ON public.seller_category USING btree (seller_id, category);
