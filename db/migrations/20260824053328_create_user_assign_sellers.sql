-- migrate:up

CREATE TABLE IF NOT EXISTS public.user_assign_sellers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id),
    seller_id UUID NOT NULL REFERENCES public.new_seller_details(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_user_assign_sellers_user_seller UNIQUE (user_id, seller_id),
    CONSTRAINT uk_user_assign_sellers_seller UNIQUE (seller_id)
);

CREATE INDEX IF NOT EXISTS idx_user_assign_sellers_user_id
    ON public.user_assign_sellers (user_id);

CREATE INDEX IF NOT EXISTS idx_user_assign_sellers_seller_id
    ON public.user_assign_sellers (seller_id);

-- migrate:down

DROP INDEX IF EXISTS idx_user_assign_sellers_seller_id;
DROP INDEX IF EXISTS idx_user_assign_sellers_user_id;
DROP TABLE IF EXISTS public.user_assign_sellers;
