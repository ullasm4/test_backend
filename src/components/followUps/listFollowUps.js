const Joi = require('joi');
const constant = require('@/config/constant');
const Schema = require('@/config/validationSchema');
const { isEndUser } = require('@/middleware/auth');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

exports.validationSchema = {
  query: Joi.object({
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(constant.pagination.maxLimit),
    q: Schema.search(),
    entity_type: Joi.string().valid('all', 'seller', 'buyer').default('all'),
    from: Schema.dateOnly().optional().allow('', null),
    to: Schema.dateOnly().optional().allow('', null),
  }),
};

exports.controller = async (req, res, _next, db) => {
  if (!req.user?.id || isEndUser(req.user)) {
    throw new ServerError('Staff access required', 403, ErrorCode.FORBIDDEN);
  }

  const page = req.customQuery.page || constant.pagination.defaultPage;
  const limit = req.customQuery.limit || constant.pagination.defaultLimit;
  const offset = (page - 1) * limit;
  const q = (req.customQuery.q || '').trim();
  const entityType = req.customQuery.entity_type || 'all';
  const from = req.customQuery.from || null;
  const to = req.customQuery.to || null;
  const isAdmin = req.user.role === 'admin';

  const where = [];
  const params = [];

  if (entityType === 'seller') {
    where.push('f.seller_id IS NOT NULL');
  } else if (entityType === 'buyer') {
    where.push('f.buyer_id IS NOT NULL');
  }

  if (from) {
    params.push(from);
    where.push(`f.date >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    where.push(`f.date <= $${params.length}`);
  }

  if (q) {
    params.push(`%${q}%`);
    const idx = params.length;
    where.push(
      `(
        sd.company_name ILIKE $${idx}
        OR bd.company_name ILIKE $${idx}
        OR f.remark ILIKE $${idx}
        OR u.name ILIKE $${idx}
      )`
    );
  }

  if (!isAdmin) {
    params.push(req.user.id);
    where.push(`f.created_by = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const fromSql = `
    FROM follow_ups f
    LEFT JOIN new_seller_details sd ON sd.id = f.seller_id
    LEFT JOIN LATERAL (
      SELECT si.phone, si.email, si.gst_number
      FROM new_seller_information si
      WHERE si.seller_id = f.seller_id
      ORDER BY si.id
      LIMIT 1
    ) si ON TRUE
    LEFT JOIN new_buyer_details bd ON bd.id = f.buyer_id
    LEFT JOIN users u ON u.id = f.created_by
  `;

  const dataParams = [...params, limit, offset];
  const limIdx = dataParams.length - 1;
  const offIdx = dataParams.length;

  const [countRes, rowsRes] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS total ${fromSql} ${whereSql}`, params),
    db.query(
      `
      SELECT
        f.id,
        f.seller_id,
        f.buyer_id,
        f.date,
        f.remark,
        f.created_by,
        f.created_at,
        f.updated_at,
        CASE
          WHEN f.seller_id IS NOT NULL THEN 'seller'
          ELSE 'buyer'
        END AS entity_type,
        COALESCE(sd.company_name, bd.company_name) AS company_name,
        COALESCE(sd.status, bd.status, 'new') AS entity_status,
        COALESCE(si.gst_number, bd.gst_number) AS gst_number,
        COALESCE(si.phone, bd.phone) AS phone,
        COALESCE(si.email, bd.email) AS email,
        u.name AS created_by_name,
        u.email AS created_by_email
      ${fromSql}
      ${whereSql}
      ORDER BY f.date ASC, f.created_at DESC
      LIMIT $${limIdx} OFFSET $${offIdx}
      `,
      dataParams
    ),
  ]);

  return res.status(200).json({
    data: rowsRes.rows,
    total: countRes.rows[0]?.total || 0,
    page,
    limit,
  });
};
