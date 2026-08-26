let cachedData = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

exports.validationSchema = {};

async function fetchStateContractCounts(db) {
  const { rows } = await db.query(`
    WITH sc AS (
      SELECT
        state_id,
        COUNT(*)::int AS total_count,
        COUNT(*) FILTER (
          WHERE contract_pdf_url IS NULL AND (seller_id IS NULL OR buyer_id IS NULL)
        )::int AS remaining_count,
        COUNT(*) FILTER (
          WHERE contract_pdf_url IS NULL
        )::int AS null_pdf_count
      FROM new_contracts
      GROUP BY state_id
    )
    SELECT
      sc.state_id,
      s.name AS state_name,
      sc.total_count,
      sc.remaining_count,
      ROUND(sc.null_pdf_count * 100.0 / sc.total_count, 2)::float AS remaining_percentage
    FROM sc
    LEFT JOIN states s ON s.id = sc.state_id
    ORDER BY sc.total_count DESC;
  `);

  return rows.map((row) => ({
    state_id: row.state_id,
    state_name: row.state_name || 'Unassigned',
    total_count: Number(row.total_count) || 0,
    remaining_count: Number(row.remaining_count) || 0,
    remaining_percentage: Number(row.remaining_percentage) || 0,
  }));
}

exports.controller = async (req, res, _next, db) => {
  const forceRefresh = req.customQuery?.refresh === 'true' || req.query?.refresh === 'true';
  const now = Date.now();

  if (!forceRefresh && cachedData && now - lastFetchTime < CACHE_TTL_MS) {
    return res.status(200).json({
      data: cachedData,
      cached: true,
      updated_at: new Date(lastFetchTime).toISOString(),
    });
  }

  const data = await fetchStateContractCounts(db);
  cachedData = data;
  lastFetchTime = now;

  return res.status(200).json({
    data,
    cached: false,
    updated_at: new Date(lastFetchTime).toISOString(),
  });
};
