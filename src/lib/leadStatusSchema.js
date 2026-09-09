/**
 * Detect lead-status schema so list/detail APIs stay up before/during migration.
 * Cached briefly to avoid hitting information_schema on every request.
 */
let cache = {
  sellerStatus: null,
  buyerStatus: null,
  sellerHistory: null,
  buyerHistory: null,
  checkedAt: 0,
};

const TTL_MS = 15_000;

async function getLeadStatusSchema(db) {
  const now = Date.now();
  if (cache.checkedAt && now - cache.checkedAt < TTL_MS && cache.sellerStatus !== null) {
    return cache;
  }

  const { rows } = await db.query(`
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'new_seller_details'
          AND column_name = 'status'
      ) AS seller_status,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'new_buyer_details'
          AND column_name = 'status'
      ) AS buyer_status,
      (to_regclass('public.seller_status_history') IS NOT NULL) AS seller_history,
      (to_regclass('public.buyer_status_history') IS NOT NULL) AS buyer_history
  `);

  cache = {
    sellerStatus: Boolean(rows[0]?.seller_status),
    buyerStatus: Boolean(rows[0]?.buyer_status),
    sellerHistory: Boolean(rows[0]?.seller_history),
    buyerHistory: Boolean(rows[0]?.buyer_history),
    checkedAt: now,
  };
  return cache;
}

function invalidateLeadStatusSchemaCache() {
  cache = {
    sellerStatus: null,
    buyerStatus: null,
    sellerHistory: null,
    buyerHistory: null,
    checkedAt: 0,
  };
}

function sellerStatusSelectSql(hasColumn) {
  return hasColumn ? `COALESCE(sd.status, 'new') AS status` : `'new'::varchar AS status`;
}

function buyerStatusSelectSql(hasColumn) {
  return hasColumn ? `COALESCE(b.status, 'new') AS status` : `'new'::varchar AS status`;
}

module.exports = {
  getLeadStatusSchema,
  invalidateLeadStatusSchemaCache,
  sellerStatusSelectSql,
  buyerStatusSelectSql,
};
