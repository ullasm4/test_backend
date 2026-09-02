const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const constant = require('@/config/constant');

exports.validationSchema = {
  query: Joi.object({
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(constant.pagination.maxLimit).default(10),
    q: Schema.search(),
    level: Joi.number().integer().min(1).max(4).optional(),
    prefix: Joi.string().trim().max(20).allow('').optional(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const page = req.customQuery.page || 1;
  const limit = req.customQuery.limit || 10;
  const offset = (page - 1) * limit;
  const q = req.customQuery.q || '';
  const level = req.customQuery.level;
  const prefix = String(req.customQuery.prefix || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  if (prefix && level && prefix.length !== level) {
    return res.status(400).json({
      error: `Prefix "${prefix}" must be ${level} character(s) for the selected level`,
      code: 'INVALID_PREFIX_LEVEL',
    });
  }

  const params = [];
  const clauses = [];

  if (q) {
    params.push(`%${q}%`);
    clauses.push(`be.name ILIKE $${params.length}`);
  }

  if (level) {
    params.push(level);
    clauses.push(`bep.level = $${params.length}`);
  }

  if (prefix) {
    params.push(prefix);
    clauses.push(`bep.prefix = $${params.length}`);
    if (!level) {
      params.push(prefix.length);
      clauses.push(`bep.level = $${params.length}`);
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const fromJoin = `
    FROM buyer_entities be
    JOIN buyer_entity_prefixes bep ON bep.id = be.prefix_id
  `;

  const countSql = `SELECT COUNT(*)::int AS total ${fromJoin} ${where}`;
  const dataSql = `
    SELECT
      be.id,
      be.name,
      be.created_at,
      bep.id AS prefix_id,
      bep.prefix,
      bep.level
    ${fromJoin}
    ${where}
    ORDER BY be.name ASC
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
