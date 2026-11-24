const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const constant = require('@/config/constant');

exports.validationSchema = {
  query: Joi.object({
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(constant.pagination.maxLimit).default(10),
    q: Schema.search(),
    has_phone: Joi.boolean().optional(),
    no_phone: Joi.boolean().optional(),
    has_email: Joi.boolean().optional(),
    no_email: Joi.boolean().optional(),
    has_website: Joi.boolean().optional(),
    no_website: Joi.boolean().optional(),
    unique_phone: Joi.boolean().optional(),
    unique_email: Joi.boolean().optional(),
  }),
};

function isTrue(value) {
  return value === true || value === 'true';
}

function nonempty(column) {
  return `(${column} IS NOT NULL AND BTRIM(${column}) <> '')`;
}

function empty(column) {
  return `(${column} IS NULL OR BTRIM(${column}) = '')`;
}

exports.controller = async (req, res, _next, db) => {
  const page = req.customQuery.page || 1;
  const limit = req.customQuery.limit || 10;
  const offset = (page - 1) * limit;
  const q = (req.customQuery.q || '').trim();
  const hasPhone = isTrue(req.customQuery.has_phone);
  const noPhone = isTrue(req.customQuery.no_phone);
  const hasEmail = isTrue(req.customQuery.has_email);
  const noEmail = isTrue(req.customQuery.no_email);
  const hasWebsite = isTrue(req.customQuery.has_website);
  const noWebsite = isTrue(req.customQuery.no_website);
  const uniquePhone = isTrue(req.customQuery.unique_phone);
  // Default to email-wise unique unless unique phone is requested or viewing no-email rows.
  const uniqueEmailExplicit = Object.prototype.hasOwnProperty.call(req.customQuery, 'unique_email');
  const uniqueEmail = uniquePhone
    ? false
    : uniqueEmailExplicit
      ? isTrue(req.customQuery.unique_email)
      : !noEmail;

  const params = [];
  const clauses = [];

  if (q) {
    params.push(`%${q}%`);
    const idx = params.length;
    clauses.push(
      `(bl.name ILIKE $${idx} OR bl.phone ILIKE $${idx} OR bl.email ILIKE $${idx} OR bl.website ILIKE $${idx})`
    );
  }

  if (hasPhone || uniquePhone) clauses.push(nonempty('bl.phone'));
  if (noPhone && !hasPhone && !uniquePhone) clauses.push(empty('bl.phone'));

  if (hasEmail || uniqueEmail) clauses.push(nonempty('bl.email'));
  if (noEmail && !hasEmail && !uniqueEmail) clauses.push(empty('bl.email'));

  if (hasWebsite) clauses.push(nonempty('bl.website'));
  if (noWebsite && !hasWebsite) clauses.push(empty('bl.website'));

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const grain = uniquePhone ? 'phone' : uniqueEmail ? 'email' : 'lead';

  let countSql;
  let dataSql;
  let countParams = params;
  let dataParams = [...params, limit, offset];

  if (grain === 'lead') {
    countSql = `SELECT COUNT(*)::int AS total FROM buyer_lead bl ${where}`;
    dataSql = `
      SELECT
        bl.id,
        bl.sr_no,
        bl.name,
        bl.phone,
        bl.email,
        bl.website,
        bl.created_at,
        bl.updated_at
      FROM buyer_lead bl
      ${where}
      ORDER BY bl.sr_no ASC NULLS LAST, bl.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
  } else {
    const distinctExpr =
      grain === 'phone' ? `LOWER(BTRIM(bl.phone))` : `LOWER(BTRIM(bl.email))`;

    countSql = `
      SELECT COUNT(*)::int AS total FROM (
        SELECT DISTINCT ${distinctExpr}
        FROM buyer_lead bl
        ${where}
      ) t
    `;

    dataSql = `
      WITH ranked AS (
        SELECT
          bl.id,
          bl.sr_no,
          bl.name,
          bl.phone,
          bl.email,
          bl.website,
          bl.created_at,
          bl.updated_at,
          ROW_NUMBER() OVER (
            PARTITION BY ${distinctExpr}
            ORDER BY bl.sr_no ASC NULLS LAST, bl.created_at DESC
          ) AS rn
        FROM buyer_lead bl
        ${where}
      )
      SELECT
        id,
        sr_no,
        name,
        phone,
        email,
        website,
        created_at,
        updated_at
      FROM ranked
      WHERE rn = 1
      ORDER BY sr_no ASC NULLS LAST, created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
  }

  const [countRes, dataRes] = await Promise.all([
    db.query(countSql, countParams),
    db.query(dataSql, dataParams),
  ]);

  return res.status(200).json({
    data: dataRes.rows,
    total: countRes.rows[0]?.total || 0,
    page,
    limit,
  });
};
