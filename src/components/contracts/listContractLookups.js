const Joi = require('joi');
const Schema = require('@/config/validationSchema');

const LOOKUP_TABLES = {
  organizations: 'organizations',
  'organization-types': 'organization_types',
  departments: 'departments',
  'buying-modes': 'buying_modes',
};

exports.validationSchema = {
  params: Joi.object({
    kind: Joi.string().valid(...Object.keys(LOOKUP_TABLES)).required(),
  }),
  query: Joi.object({
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(50).default(10),
    q: Schema.search(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const kind = req.params.kind;
  const table = LOOKUP_TABLES[kind];
  const page = req.customQuery.page || 1;
  const limit = req.customQuery.limit || 10;
  const offset = (page - 1) * limit;
  const q = req.customQuery.q || '';

  const params = [];
  const clauses = [];

  if (q) {
    params.push(`%${String(q).replace(/[%_\\]/g, '')}%`);
    if (kind === 'buying-modes') {
      clauses.push(`normalize_buying_mode(t.name) ILIKE $${params.length}`);
    } else {
      clauses.push(`t.name ILIKE $${params.length}`);
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  if (kind === 'buying-modes') {
    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT normalize_buying_mode(t.name) AS name
        FROM buying_modes t
        ${where}
        GROUP BY normalize_buying_mode(t.name)
      ) grouped
    `;
    const dataSql = `
      SELECT
        (MIN(t.id::text))::uuid AS id,
        normalize_buying_mode(t.name) AS name,
        SUM(COALESCE(t.total_contract, 0))::int AS contract_count
      FROM buying_modes t
      ${where}
      GROUP BY normalize_buying_mode(t.name)
      ORDER BY contract_count DESC, name ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const [countRes, dataRes] = await Promise.all([
      db.query(countSql, params),
      db.query(dataSql, [...params, limit, offset]),
    ]);

    return res.status(200).json({
      data: dataRes.rows,
      total: countRes.rows[0]?.total || 0,
      page,
      limit,
    });
  }

  const countSql = `SELECT COUNT(*)::int AS total FROM ${table} t ${where}`;
  const dataSql = `
    SELECT t.id, t.name, COALESCE(t.total_contract, 0)::int AS contract_count
    FROM ${table} t
    ${where}
    ORDER BY COALESCE(t.total_contract, 0) DESC, t.name ASC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  const [countRes, dataRes] = await Promise.all([
    db.query(countSql, params),
    db.query(dataSql, [...params, limit, offset]),
  ]);

  return res.status(200).json({
    data: dataRes.rows,
    total: countRes.rows[0]?.total || 0,
    page,
    limit,
  });
};
