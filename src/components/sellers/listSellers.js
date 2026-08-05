const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const constant = require('@/config/constant');

exports.validationSchema = {
  query: Joi.object({
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(constant.pagination.maxLimit),
    q: Schema.search(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const page = req.customQuery.page || 1;
  const limit = req.customQuery.limit || 20;
  const offset = (page - 1) * limit;
  const q = req.customQuery.q || '';

  const params = [];
  let where = '';
  if (q) {
    params.push(`%${q}%`);
    where = `WHERE (
      s.company_name ILIKE $1 OR
      s.email ILIKE $1 OR
      s.phone ILIKE $1 OR
      s.gst_number ILIKE $1 OR
      s.seller_id ILIKE $1 OR
      c.contract_number ILIKE $1
    )`;
  }

  const countRes = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM sellers s
     LEFT JOIN contracts c ON c.id = s.contract_id
     ${where}`,
    params
  );

  params.push(limit, offset);
  const limIdx = params.length - 1;
  const offIdx = params.length;

  const { rows } = await db.query(
    `SELECT s.*, c.contract_number
     FROM sellers s
     LEFT JOIN contracts c ON c.id = s.contract_id
     ${where}
     ORDER BY s.created_at DESC
     LIMIT $${limIdx} OFFSET $${offIdx}`,
    params
  );

  return res.status(200).json({ data: rows, total: countRes.rows[0].total, page, limit });
};
