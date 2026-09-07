-- migrate:up

CREATE TABLE IF NOT EXISTS public.end_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_end_users_email UNIQUE (email),
    CONSTRAINT uk_end_users_phone UNIQUE (phone)
);

CREATE INDEX IF NOT EXISTS idx_end_users_is_active
    ON public.end_users (is_active);

-- Assign end users to buyer entities (many buyers per end user; same buyer can be shared across end users)
CREATE TABLE IF NOT EXISTS public.buyer_end_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    end_user_id UUID NOT NULL REFERENCES public.end_users(id),
    buyer_id UUID NOT NULL REFERENCES public.new_buyer_details(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_buyer_end_users_end_user_buyer UNIQUE (end_user_id, buyer_id)
);

CREATE INDEX IF NOT EXISTS idx_buyer_end_users_end_user_id
    ON public.buyer_end_users (end_user_id);

CREATE INDEX IF NOT EXISTS idx_buyer_end_users_buyer_id
    ON public.buyer_end_users (buyer_id);

-- Assign end users to seller entities (many sellers per end user; same seller can be shared across end users)
CREATE TABLE IF NOT EXISTS public.seller_end_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    end_user_id UUID NOT NULL REFERENCES public.end_users(id),
    seller_id UUID NOT NULL REFERENCES public.new_seller_details(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_seller_end_users_end_user_seller UNIQUE (end_user_id, seller_id)
);

CREATE INDEX IF NOT EXISTS idx_seller_end_users_end_user_id
    ON public.seller_end_users (end_user_id);

CREATE INDEX IF NOT EXISTS idx_seller_end_users_seller_id
    ON public.seller_end_users (seller_id);

-- migrate:down

DROP INDEX IF EXISTS idx_seller_end_users_seller_id;
DROP INDEX IF EXISTS idx_seller_end_users_end_user_id;
DROP TABLE IF EXISTS public.seller_end_users;

DROP INDEX IF EXISTS idx_buyer_end_users_buyer_id;
DROP INDEX IF EXISTS idx_buyer_end_users_end_user_id;
DROP TABLE IF EXISTS public.buyer_end_users;

DROP INDEX IF EXISTS idx_end_users_is_active;
DROP TABLE IF EXISTS public.end_users;
