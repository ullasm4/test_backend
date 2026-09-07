-- migrate:up

-- Allow the same seller/buyer to be assigned to multiple end users.
-- Keep uniqueness per (end_user, seller/buyer) pair only.
ALTER TABLE public.seller_end_users
  DROP CONSTRAINT IF EXISTS uk_seller_end_users_seller;

ALTER TABLE public.buyer_end_users
  DROP CONSTRAINT IF EXISTS uk_buyer_end_users_buyer;

-- migrate:down

ALTER TABLE public.seller_end_users
  ADD CONSTRAINT uk_seller_end_users_seller UNIQUE (seller_id);

ALTER TABLE public.buyer_end_users
  ADD CONSTRAINT uk_buyer_end_users_buyer UNIQUE (buyer_id);
