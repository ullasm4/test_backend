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
      b.company_name ILIKE $1 OR
      b.email ILIKE $1 OR
      b.phone ILIKE $1 OR
      b.gst_number ILIKE $1 OR
      c.contract_number ILIKE $1
    )`;
  }

  const countRes = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM buyers b
     LEFT JOIN contracts c ON c.id = b.contract_id
     ${where}`,
    params
  );

  params.push(limit, offset);
  const limIdx = params.length - 1;
  const offIdx = params.length;

  const { rows } = await db.query(
    `SELECT b.*, c.contract_number
     FROM buyers b
     LEFT JOIN contracts c ON c.id = b.contract_id
     ${where}
     ORDER BY b.created_at DESC
     LIMIT $${limIdx} OFFSET $${offIdx}`,
    params
  );

  return res.status(200).json({ data: rows, total: countRes.rows[0].total, page, limit });
};
